// src/player/voiceLink.ts — 음성 연결 상태 기계. 전이 표(notes/ref-voice-link.md)의 줄마다 시험 하나.
// 음성 라이브러리의 joinVoiceChannel · entersState 는 가짜로 넘기고, 연결의 전이는 가짜 연결에 stateChange 를 쏘아 흉내 낸다.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { VoiceConnectionStatus, VoiceConnectionDisconnectReason } from "@discordjs/voice";
import type { DiscordGatewayAdapterLibraryMethods } from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import { VoiceLink, type VoiceHost, type VoiceLib } from "../../src/player/voiceLink.ts";
import { fake } from "../helpers/fake.ts";
import { inGuild, currentGuild } from "../../src/infra/guildContext.ts";
import { HOLD_MS } from "../../src/infra/voiceAdapter.ts";
import sink from "../../src/infra/log/sink.ts";

// 가짜 연결. 부순 방식 · 구독한 것 · 다시 붙은 곳을 적는다
class FakeConnection extends EventEmitter {
  // 게이트웨이로 보낸 것(참가 · 나가기)
  sent: unknown[] = [];
  state: { status: string; reason?: number; closeCode?: number; adapter?: { sendPayload(p: unknown): boolean } } = { status: VoiceConnectionStatus.Signalling, adapter: { sendPayload: (p) => (this.sent.push(p), true) } };
  joinConfig = { selfDeaf: false, selfMute: false };
  // 받아 둔 음성 서버 정보로 다시 붙은 횟수. serverInfo 가 없으면 라이브러리처럼 아무것도 하지 않는다
  reattaches = 0;
  serverInfo = true;
  configureNetworking() {
    if (!this.serverInfo) return;
    this.reattaches++;
    this.state = { ...this.state, status: VoiceConnectionStatus.Connecting };
  }
  destroyed: Array<"leave" | "stay"> = [];
  subscribed: unknown[] = [];
  rejoins: unknown[] = [];
  destroy(adapterAvailable = true) {
    this.destroyed.push(adapterAvailable ? "leave" : "stay");
    this.state = { status: VoiceConnectionStatus.Destroyed };
  }
  subscribe(p: unknown) {
    this.subscribed.push(p);
  }
  rejoin(o: unknown) {
    this.rejoins.push(o);
  }
  // 라이브러리처럼 상태를 바꾸고 알린다
  to(status: string, extra: { reason?: number; closeCode?: number } = {}) {
    const old = this.state;
    this.state = { status, ...extra };
    this.emit("stateChange", old, this.state);
  }
}

const joins: FakeConnection[] = [];
// 붙기(entersState Ready)의 결과. 시험이 바꾼다: true 면 붙고, false 면 던진다
let joinWorks: boolean[] = [];
const lib = fake<VoiceLib>({
  joinVoiceChannel: () => {
    const c = new FakeConnection();
    joins.push(c);
    return c;
  },
  entersState: async (connection: FakeConnection) => {
    const ok = joinWorks.length ? joinWorks.shift() : true;
    if (!ok) throw new Error("Ready 안 옴");
    connection.state = { status: VoiceConnectionStatus.Ready };
    return connection;
  },
});

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
// 조건이 될 때까지 기다린다(시간에 기대면 부하에 따라 흔들린다). 상한을 넘으면 실패
async function until(ok: () => boolean, what: string, limitMs = 1000) {
  const end = Date.now() + limitMs;
  while (!ok()) {
    if (Date.now() > end) assert.fail(`${what}: ${limitMs}ms 안에 되지 않았다`);
    await sleep(2);
  }
}

// 시험마다 만든 연결. 끝나면 정리해 남은 기다림 · 복구가 다음 시험에 끼어들지 않게 한다
const links: VoiceLink[] = [];

beforeEach(() => {
  joins.length = 0;
  joinWorks = [];
});
afterEach(() => {
  for (const link of links.splice(0)) link.stop();
});

// 플레이어 가짜와 음성 연결. 시험은 steps 로 무엇을 불렀는지 본다
// fetchAs: 디스코드에 채널을 물었을 때의 답(기본: 캐시에 있으면 있다). 오류면 던진다
// atDiscord: 디스코드에 봇의 음성 채널을 물었을 때의 답(기본: 캐시와 같다). 오류면 던진다
function setup({ channel = true, inChannel = "vc1" as string | null, track = true, fetchAs = null as ((id: string) => unknown) | null, atDiscord = undefined as string | null | Error | undefined } = {}) {
  const steps: string[] = [];
  const channels = new Map<string, unknown>();
  if (channel) channels.set("vc1", { id: "vc1", isVoiceBased: () => true });
  channels.set("vc2", { id: "vc2", isVoiceBased: () => true });
  const me = { voice: { channelId: inChannel } };
  const fetch = async (id: string) => {
    if (!fetchAs) return channels.get(id) ?? null;
    const r = fetchAs(id);
    if (r instanceof Error) throw r;
    return r;
  };
  const player = {
    guild: {
      id: "g1",
      name: "서버",
      channels: { cache: channels, fetch },
      voiceAdapterCreator: () => ({}),
      members: { me },
      voiceStates: { fetch: async () => (atDiscord instanceof Error ? Promise.reject(atDiscord) : { channelId: atDiscord === undefined ? me.voice.channelId : atDiscord }) },
    },
    voiceChannel: { id: "vc1", name: "음성" } as { id: string; name?: string },
    audioPlayer: { name: "audioPlayer" },
    connection: null as FakeConnection | null,
    currentTrack: track ? { title: "곡" } : null,
    async dispose(o: { reason: string; session: string; panel?: string; end?: string }) {
      steps.push(`dispose:${o.session}:${o.panel ?? "-"}:${o.end ?? "-"}`);
    },
    async onVoiceRecovered() {
      steps.push("resume");
    },
    pauseFor: (r: string) => (steps.push(`pause:${r}`), true),
    resumeFor: (r: string) => (steps.push(`resume:${r}`), true),
    movedVoiceStatus: (from: string) => steps.push(`status-moved:${from}`),
  };
  const link = new VoiceLink(fake<VoiceHost>(player), lib);
  Object.assign(link, { waitStartMs: 10, waitReadyMs: 20, recoveryRetryDelayMs: 1 });
  links.push(link);
  return { steps, player, link, me, channels, conn: () => player.connection as FakeConnection };
}

// 붙어 있는 연결 하나
async function ready(o: Parameters<typeof setup>[0] = {}) {
  const s = setup(o);
  await s.link.connect();
  return s;
}

// ── 붙기 ──

test("붙기: 새 연결을 만들어 오디오 플레이어를 구독시키고 Ready 가 되면 ready", async () => {
  const { link, conn, player } = setup();
  assert.equal(await link.connect(), true);
  assert.equal(link.state, "ready");
  assert.deepEqual(conn().subscribed, [player.audioPlayer]);
  assert.equal(link.isAlive(), true);
});

test("붙기: Ready 가 안 오면 연결을 부수고 idle 로 돌아가 던진다", async () => {
  const { link, player } = setup();
  joinWorks = [false];
  await assert.rejects(link.connect());
  assert.equal(link.state, "idle");
  assert.equal(player.connection, null);
  assert.deepEqual(joins[0].destroyed, ["leave"]);
  assert.equal(link.isAlive(), false);
});

// ── 끊김과 기다림 ──

test("끊김: 라이브러리가 스스로 다시 붙으면(Ready) 우리가 할 일은 없다", async () => {
  const { link, conn } = await ready();
  conn().to(VoiceConnectionStatus.Disconnected, { reason: VoiceConnectionDisconnectReason.EndpointRemoved });
  assert.equal(link.state, "waiting");
  conn().to(VoiceConnectionStatus.Ready);
  assert.equal(link.state, "ready");
  await sleep(40);
  assert.equal(link.state, "ready");
  assert.equal(joins.length, 1, "다시 붙이지 않았다");
});

test("끊김: 다시 붙기 시작했으면(Signalling · Connecting) Ready 까지 조금 더 기다린다", async () => {
  const { link, conn } = await ready();
  conn().to(VoiceConnectionStatus.Disconnected, { reason: VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 });
  conn().to(VoiceConnectionStatus.Connecting);
  await sleep(15);
  assert.equal(link.state, "waiting", "처음 기다림(10ms)이 지나도 다시 붙는 중이면 계속 기다린다");
  conn().to(VoiceConnectionStatus.Ready);
  assert.equal(link.state, "ready");
});

test("끊김이 연달아 와도 기다림은 하나다(B-85)", async () => {
  const { link, conn } = await ready();
  conn().to(VoiceConnectionStatus.Disconnected, { reason: VoiceConnectionDisconnectReason.EndpointRemoved });
  const timer = link.waitTimer;
  conn().to(VoiceConnectionStatus.Disconnected, { reason: VoiceConnectionDisconnectReason.EndpointRemoved });
  assert.equal(link.waitTimer, timer, "새 기다림을 걸지 않는다");
  assert.equal(conn().listenerCount("stateChange"), 1, "리스너가 쌓이지 않는다");
});

test("끊김: 수동 해제면 아무것도 안 한다", async () => {
  const { link, conn } = await ready();
  conn().to(VoiceConnectionStatus.Disconnected, { reason: VoiceConnectionDisconnectReason.Manual });
  assert.equal(link.state, "ready");
});

test("기다려도 다시 붙지 않으면: 봇이 채널에 있으면 재생 중이 아니어도 우리가 다시 붙인다", async () => {
  const { link, conn, steps } = await ready({ track: false });
  conn().to(VoiceConnectionStatus.Disconnected, { reason: VoiceConnectionDisconnectReason.AdapterUnavailable });
  await until(() => steps.length > 0, "다시 붙어 이어 틀기");
  assert.equal(link.state, "ready");
  assert.equal(conn().reattaches, 1, "받아 둔 음성 서버 정보로 다시 붙었다");
  assert.deepEqual(steps, ["resume"]);
});

test("기다려도 다시 붙지 않았는데 봇이 채널에 없으면(퇴장 알림이 늦음) 강제 퇴장으로 버린다", async () => {
  const { link, conn, me, steps } = await ready();
  me.voice.channelId = null;
  conn().to(VoiceConnectionStatus.Disconnected, { reason: VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 });
  await until(() => steps.length > 0, "버리기");
  assert.deepEqual(steps, ["dispose:remove:disconnected:forced-disconnect"]);
  assert.equal(link.state, "closed");
  assert.equal(joins.length, 1, "다시 붙지 않았다");
});

// ── 우리가 다시 붙이기 ──

test("부서짐 · 오류: 붙어 있다가 부서지거나 오류가 나면 다시 붙이고 끊긴 위치에서 이어 튼다", async () => {
  const broken = await ready();
  broken.conn().to(VoiceConnectionStatus.Destroyed);
  await until(() => broken.steps.length > 0, "이어 틀기");
  assert.equal(broken.link.state, "ready");
  assert.deepEqual(broken.steps, ["resume"]);

  const failing = await ready();
  failing.conn().emit("error", new Error("Cannot perform IP discovery - socket closed"));
  await until(() => failing.steps.length > 0, "이어 틀기");
  assert.deepEqual(failing.steps, ["resume"]);
});

test("네트워크 오류는 오류 줄 없이 복구 시작 줄이 까닭과 함께 남긴다. 중간 시도의 실패는 debug", async () => {
  const { link, conn } = await ready();
  joinWorks = [false, true];
  const from = sink.buffer.length;
  conn().emit("error", Object.assign(new Error("getaddrinfo ENOTFOUND x.discord.media"), { code: "ENOTFOUND" }));
  await until(() => link.state === "ready", "다시 붙기");
  const lines = sink.buffer.slice(from).filter((e) => e.level !== "debug");
  assert.deepEqual(
    lines.map((e) => e.level),
    ["warn", "info"],
    "복구 시작 · 복구 완료만",
  );
  assert.ok(lines[0].text.includes("네트워크 오류(getaddrinfo ENOTFOUND"));
});

test("다시 붙이기: 디스코드가 봇을 이 채널에 있다고 보거나 묻지 못하면, 새 참가 없이 받아 둔 음성 서버 정보로 다시 붙는다(같은 채널 참가에는 답이 없다)", async () => {
  for (const atDiscord of ["vc1", Object.assign(new Error("getaddrinfo ENOTFOUND discord.com"), { code: "ENOTFOUND" })]) {
    joins.length = 0;
    const { link, conn } = await ready({ atDiscord });
    const old = conn();
    link.recover("시험");
    await until(() => link.state === "ready", "다시 붙기");
    assert.equal(conn(), old, "같은 연결");
    assert.equal(old.reattaches, 1);
    assert.deepEqual(old.destroyed, [], "나감을 보내지 않는다");
    assert.equal(joins.length, 1, "새로 참가하지 않는다");
  }
});

test("다시 붙이기: 디스코드가 봇을 채널에서 뺐거나 받아 둔 정보가 없으면, 옛 연결을 리스너를 떼고 나감 없이 부순 뒤 새로 참가한다. 옛 연결이 늦게 알린 것은 보지 않는다", async () => {
  for (const variant of ["빠짐", "정보 없음"]) {
    const { link, conn } = await ready(variant === "빠짐" ? { atDiscord: null } : {});
    const old = conn();
    old.serverInfo = variant !== "정보 없음";
    link.recover("시험");
    await until(() => link.state === "ready", "다시 붙기");
    assert.notEqual(conn(), old, variant);
    assert.deepEqual(old.destroyed, ["stay"], `${variant}: 나감을 보내면 디스코드가 봇을 채널에서 뺀다`);
    assert.equal(old.listenerCount("stateChange"), 0);
    old.emit("stateChange", { status: "ready" }, { status: VoiceConnectionStatus.Destroyed });
    await sleep(10);
    assert.equal(joins.length, 2, "옛 연결의 부서짐으로 또 다시 붙이지 않는다");
    joins.length = 0;
  }
});

test("다시 붙이기: 디스코드에 닿는데도 받아 둔 정보로 못 붙으면(정보가 낡음) 남은 시도는 새로 참가한다. 닿지 못해 실패한 것은 세지 않는다. 다음 복구는 다시 받아 둔 정보부터", async () => {
  joins.length = 0;
  const known = await ready({ atDiscord: "vc1" });
  const old = known.conn();
  joinWorks = [false, true];
  known.link.recover("시험");
  await until(() => known.link.state === "ready", "다시 붙기");
  assert.equal(old.reattaches, 1);
  assert.equal(joins.length, 2, "두 번째 시도는 새로 참가");
  assert.equal(known.link.reattachRefused, true);

  known.link.recover("다음");
  await until(() => known.link.state === "ready", "다시 붙기");
  assert.equal(known.conn().reattaches, 1, "새 복구는 받아 둔 정보부터");

  joins.length = 0;
  const offline = await ready({ atDiscord: Object.assign(new Error("getaddrinfo ENOTFOUND discord.com"), { code: "ENOTFOUND" }) });
  joinWorks = [false, true];
  offline.link.recover("시험");
  await until(() => offline.link.state === "ready", "다시 붙기");
  assert.equal(offline.conn().reattaches, 2, "닿지 못해 실패한 것은 정보를 버릴 까닭이 아니다");
  assert.equal(joins.length, 1);
});

test("복구는 한 번에 하나. 복구 중에 또 부르면 아무것도 안 한다", async () => {
  const { link } = await ready();
  joinWorks = [false, false, true];
  link.recover("하나");
  link.recover("둘");
  await until(() => link.state === "ready", "다시 붙기");
  assert.equal(link.recoveryAttempts, 3, "한 복구가 세 번 시도했다(두 번째 부름이 새로 시작하지 않았다)");
  assert.equal(joins.length, 3, "처음 연결 + 새 참가 둘(첫 시도는 받아 둔 정보로)");
  assert.equal(link.state, "ready");
});

test("다섯 번 모두 실패하면 세션을 저장하고 버린다(B-18 안 E)", async () => {
  const { link, steps } = await ready();
  joinWorks = [false, false, false, false, false];
  link.recover("시험");
  await until(() => steps.length > 0, "포기하고 버리기");
  assert.deepEqual(steps, ["dispose:save:disconnected:voice-lost"]);
  assert.equal(link.state, "closed");
  assert.equal(link.isAlive(), false);
});

test("복구 중에 채널이 사라졌으면 채널 사라짐으로 버린다", async () => {
  const { link, channels, steps } = await ready();
  channels.delete("vc1");
  link.recover("시험");
  await until(() => steps.length > 0, "버리기");
  assert.deepEqual(steps, ["dispose:remove:-:channel-gone"]);
});

test("복구 중에 정리하면 늦게 돌아온 성공이 상태를 건드리지 않는다", async () => {
  const { link, steps } = await ready();
  link.recover("시험");
  link.release("종료");
  await sleep(10);
  assert.equal(link.state, "closed");
  assert.deepEqual(steps, []);
});

// ── 게이트웨이: 봇 자신의 음성 상태 ──

const state = (channelId: string | null, extra: object = {}) => ({ channelId, serverMute: false, serverDeaf: false, suppress: false, channel: null, ...extra });

test("봇이 채널에서 빠졌다: 채널이 있으면 강제 퇴장, 없으면 채널 사라짐. 끝난 뒤에는 늦은 끊김을 보지 않는다", async () => {
  const kicked = await ready();
  assert.deepEqual(kicked.link.onBotState(state("vc1"), state(null)), { left: true, moved: false, muteChanged: false });
  await until(() => kicked.steps.length > 0, "버리기");
  assert.deepEqual(kicked.steps, ["dispose:remove:disconnected:forced-disconnect"]);
  kicked.conn().to(VoiceConnectionStatus.Disconnected, { reason: VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 });
  assert.equal(kicked.link.state, "closed");

  const gone = await ready();
  gone.channels.delete("vc1");
  gone.link.onBotState(state("vc1"), state(null));
  await until(() => gone.steps.length > 0, "버리기");
  assert.deepEqual(gone.steps, ["dispose:remove:-:channel-gone"]);
});

test("채널 삭제 알림보다 빠짐 알림이 먼저 와 캐시에 채널이 남아 있어도, 디스코드가 없다고(10003) 하면 채널 사라짐이다. 묻지 못하면 강제 퇴장", async () => {
  const deleted = await ready({ fetchAs: () => Object.assign(new Error("Unknown Channel"), { code: 10003 }) });
  deleted.link.onBotState(state("vc1"), state(null));
  await until(() => deleted.steps.length > 0, "버리기");
  assert.deepEqual(deleted.steps, ["dispose:remove:-:channel-gone"]);

  const offline = await ready({ fetchAs: () => Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) });
  offline.link.onBotState(state("vc1"), state(null));
  await until(() => offline.steps.length > 0, "버리기");
  assert.deepEqual(offline.steps, ["dispose:remove:disconnected:forced-disconnect"]);
});

test("다시 붙이는 중에 봇이 채널에서 빠졌다는 알림은 쫓겨난 것이 아니다(게이트웨이가 끊겼던 것). 복구를 이어 간다", async () => {
  const { link, conn, steps } = await ready();
  conn().to(VoiceConnectionStatus.Disconnected, { reason: VoiceConnectionDisconnectReason.AdapterUnavailable });
  assert.equal(link.state, "waiting");
  assert.deepEqual(link.onBotState(state("vc1"), state(null)), { left: false, moved: false, muteChanged: false });
  await until(() => steps.length > 0, "다시 붙어 이어 틀기");
  assert.deepEqual(steps, ["resume"]);
  assert.equal(link.state, "ready");
});

// 답 없는 참가 하나. atDiscord 는 디스코드가 보는 봇의 음성 채널(REST). 오류면 던진다
function stuckJoin(atDiscord: string | null | Error) {
  const s = setup();
  s.player.guild = { ...s.player.guild, voiceStates: { fetch: async () => (atDiscord instanceof Error ? Promise.reject(atDiscord) : { channelId: atDiscord }) } } as never;
  const c = new FakeConnection();
  s.player.connection = c;
  s.link.state = "joining";
  return { ...s, c };
}
const LEAVE = { op: 4, d: { guild_id: "g1", channel_id: null, self_deaf: false, self_mute: false } };

test("참가 요청에 답이 없으면 처음에는 다시 보낸다. 다시 보내도 답이 없고 디스코드가 봇이 그 채널에 있다고 하면 게이트웨이로 나갔다가 다시 참가한다", async () => {
  const s = stuckJoin("vc1");
  await s.link._unstick(s.c as never, "vc1", 0);
  assert.deepEqual(s.c.sent, [], "처음에는 나가지 않는다(끊긴 동안 보낸 요청이 사라졌을 수 있다)");
  assert.equal(s.c.rejoins.length, 1);
  assert.ok(s.link.stuckTimer, "다시 지켜본다");

  await s.link._unstick(s.c as never, "vc1", 1);
  assert.deepEqual(s.c.sent, [LEAVE]);
  assert.equal(s.c.rejoins.length, 2, "나감 뒤에 다시 참가");

  // 그 나감 알림 한 번은 쫓겨난 것이 아니다. 그 뒤의 빠짐은 쫓겨난 것
  assert.deepEqual(s.link.onBotState(state("vc1"), state(null)), { left: false, moved: false, muteChanged: false });
  await sleep(10);
  assert.deepEqual(s.steps, [], "버리지 않는다");
  assert.equal(s.link.state, "joining");
  s.link.onBotState(state("vc1"), state(null));
  await until(() => s.steps.length > 0, "버리기");
  assert.deepEqual(s.steps, ["dispose:remove:disconnected:forced-disconnect"]);
});

test("답 없는 참가: 봇이 그 채널에 없으면(10065 · 다른 채널) 나가지 않고 참가만 다시 보낸다. 디스코드에 묻지 못하면(네트워크) 아무것도 보내지 않고 기다린다", async () => {
  for (const at of [Object.assign(new Error("Unknown Voice State"), { code: 10065 }), "vc2"]) {
    const s = stuckJoin(at);
    await s.link._unstick(s.c as never, "vc1", 1);
    assert.deepEqual(s.c.sent, []);
    assert.equal(s.c.rejoins.length, 1);
  }
  const offline = stuckJoin(Object.assign(new Error("getaddrinfo ENOTFOUND discord.com"), { code: "ENOTFOUND" }));
  await offline.link._unstick(offline.c as never, "vc1", 1);
  assert.deepEqual(offline.c.sent, []);
  assert.deepEqual(offline.c.rejoins, []);
  assert.ok(offline.link.stuckTimer, "다시 지켜본다");

  const ready = stuckJoin("vc1");
  ready.c.state = { status: VoiceConnectionStatus.Ready };
  await ready.link._unstick(ready.c as never, "vc1", 1);
  assert.deepEqual(ready.c.rejoins, [], "붙었으면 할 일이 없다");

  // 묻는 사이에 붙었다
  const meanwhile = stuckJoin("vc1");
  meanwhile.player.guild = { ...meanwhile.player.guild, voiceStates: { fetch: async () => ((meanwhile.c.state = { status: VoiceConnectionStatus.Ready }), { channelId: "vc1" }) } } as never;
  await meanwhile.link._unstick(meanwhile.c as never, "vc1", 1);
  assert.deepEqual([meanwhile.c.sent, meanwhile.c.rejoins], [[], []]);

  // 게이트웨이가 나감을 받지 못했다. 나간 것으로 치지 않고 다시 지켜본다
  const unsent = stuckJoin("vc1");
  unsent.c.state = { status: VoiceConnectionStatus.Signalling, adapter: { sendPayload: () => false } };
  await unsent.link._unstick(unsent.c as never, "vc1", 1);
  assert.deepEqual(unsent.c.rejoins, []);
  assert.equal(unsent.link.selfLeave, null);
  assert.ok(unsent.link.stuckTimer);
});

test("멈추면(플레이어를 버림) 답 없는 참가를 지켜보던 것도 멈춘다", () => {
  const s = stuckJoin("vc1");
  s.link._armUnstick(s.c as never, "vc1", 0);
  s.link.stop();
  assert.equal(s.link.stuckTimer, null);
});

test("붙기가 끝나면 스스로 나간 표시를 지운다(늦게 온 진짜 빠짐을 넘기지 않게)", async () => {
  const { link } = setup();
  link.selfLeave = "vc1";
  await link.connect();
  assert.equal(link.selfLeave, null);
});

test("봇이 옮겨졌다: 다시 붙지 않고 기록만 맞춘다. 곧바로 원래 채널로 되돌아오면 목적지로 한 번 다시 옮긴다", async () => {
  const { link, player, conn, steps } = await ready();
  const vc2 = fake<VoiceBasedChannel>({ id: "vc2" });
  assert.equal(link.onBotState(state("vc1"), state("vc2", { channel: vc2 })).moved, true);
  assert.equal(player.voiceChannel.id, "vc2");
  assert.deepEqual(conn().rejoins, []);
  assert.deepEqual(steps, ["status-moved:vc1"], "옛 채널의 상태를 지우고 새 채널에 쓴다");

  const back = fake<VoiceBasedChannel>({ id: "vc1" });
  link.lastPlainJoin = { channelId: "vc1", at: Date.now() }; // 라이브러리가 옛 채널로 고치지 않은 참가 요청을 보냈다(어댑터가 늦었다)
  link.onBotState(state("vc2"), state("vc1", { channel: back }));
  assert.deepEqual(conn().rejoins, [{ channelId: "vc2", selfDeaf: false, selfMute: false }]);
  assert.equal(joins.length, 1, "새 연결을 만들지 않는다");
  assert.deepEqual(steps, ["status-moved:vc1"], "되돌림은 이동이 아니다. 목적지로 다시 옮겨진 알림이 맞춘다");
});

test("사람이 빠르게 되돌린 이동은 그대로 따른다(고치지 않은 참가 요청이 나가지 않았다)", async () => {
  const { link, player, conn } = await ready();
  link.onBotState(state("vc1"), state("vc2", { channel: fake<VoiceBasedChannel>({ id: "vc2" }) }));
  link.lastPlainJoin = null; // 어댑터가 라이브러리의 옛 요청을 고쳐 보냈거나 요청이 없었다
  link.onBotState(state("vc2"), state("vc1", { channel: fake<VoiceBasedChannel>({ id: "vc1" }) }));
  assert.deepEqual(conn().rejoins, []);
  assert.equal(player.voiceChannel.id, "vc1");
});

test("어댑터가 고치지 않고 내보낸 참가 요청만 되돌림 판단에 적는다", (t) => {
  const { link, player } = setup();
  let gateway: DiscordGatewayAdapterLibraryMethods | null = null;
  (player.guild as { voiceAdapterCreator: unknown }).voiceAdapterCreator = (methods: DiscordGatewayAdapterLibraryMethods) => ((gateway = methods), { sendPayload: () => true, destroy() {} });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const adapter = link._adapterCreator()({ onVoiceStateUpdate() {}, onVoiceServerUpdate() {}, destroy() {} });
  const join = (channelId: string) => ({ op: 4, d: { guild_id: "g1", channel_id: channelId } });

  adapter.sendPayload(join("vc1"));
  t.mock.timers.tick(HOLD_MS);
  assert.equal(link.lastPlainJoin?.channelId, "vc1");

  link.lastPlainJoin = null;
  adapter.sendPayload(join("vc1"));
  gateway!.onVoiceStateUpdate({ channel_id: "vc2" } as never);
  t.mock.timers.tick(HOLD_MS);
  assert.equal(link.lastPlainJoin, null);
});

test("서버 음소거 · 무대 발언권 없음이면 mute 로 멈추고, 풀리면 푼다", async () => {
  const { link, steps } = await ready();
  assert.equal(link.onBotState(state("vc1"), state("vc1", { serverMute: true })).muteChanged, true);
  assert.equal(link.onBotState(state("vc1", { suppress: true }), state("vc1")).muteChanged, true);
  assert.equal(link.onBotState(state("vc1"), state("vc1")).muteChanged, false);
  assert.deepEqual(steps, ["pause:mute", "resume:mute"]);
});

// ── 정리 ──

test("release: 나감 메시지 없이 부수고 닫는다. disconnect: 나감 메시지를 보내며 부순다", async () => {
  const stay = await ready();
  const c = stay.conn();
  stay.link.release("종료");
  assert.deepEqual(c.destroyed, ["stay"]);
  assert.equal(c.listenerCount("stateChange"), 0);
  assert.equal(stay.link.state, "closed");

  const leave = await ready();
  const d = leave.conn();
  leave.link.disconnect("나가기");
  assert.deepEqual(d.destroyed, ["leave"]);
  assert.equal(leave.link.isAlive(), false);
});

test("연결의 전이 · 오류는 누가 쏘든 이 서버의 문맥에서 돈다", async () => {
  const seen: Array<string | null> = [];
  const { player } = setup();
  class Probe extends VoiceLink {
    _onStateChange() {
      seen.push(currentGuild());
    }
    _onError() {
      seen.push(currentGuild());
    }
  }
  const link = new Probe(fake<VoiceHost>(player), lib);
  links.push(link);
  await link.connect();
  const c = player.connection as FakeConnection;
  inGuild("g-other", () => {
    c.to(VoiceConnectionStatus.Connecting);
    c.emit("error", new Error("오류"));
  });
  assert.deepEqual(seen, ["g1", "g1"]);
});
