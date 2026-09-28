// src/player/voiceLink.ts — 음성 연결 상태 기계. 전이 표(notes/ref-voice-link.md)의 줄마다 시험 하나.
// 음성 라이브러리의 joinVoiceChannel · entersState 는 가짜로 넘기고, 연결의 전이는 가짜 연결에 stateChange 를 쏘아 흉내 낸다.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { VoiceConnectionStatus, VoiceConnectionDisconnectReason } from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import { VoiceLink, type VoiceHost, type VoiceLib } from "../../src/player/voiceLink.ts";
import { fake } from "../helpers/fake.ts";

// 가짜 연결. 부순 방식 · 구독한 것 · 다시 붙은 곳을 적는다
class FakeConnection extends EventEmitter {
  state: { status: string; reason?: number; closeCode?: number } = { status: VoiceConnectionStatus.Signalling };
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
function setup({ channel = true, inChannel = "vc1" as string | null, track = true } = {}) {
  const steps: string[] = [];
  const channels = new Map<string, unknown>();
  if (channel) channels.set("vc1", { id: "vc1", isVoiceBased: () => true });
  channels.set("vc2", { id: "vc2", isVoiceBased: () => true });
  const me = { voice: { channelId: inChannel } };
  const player = {
    guild: { id: "g1", name: "서버", channels: { cache: channels }, voiceAdapterCreator: () => ({}), members: { me } },
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
  assert.equal(joins.length, 2, "새로 붙었다");
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

test("다시 붙일 때 옛 연결은 리스너를 떼고 부순다. 옛 연결이 늦게 알린 것은 보지 않는다", async () => {
  const { link, conn } = await ready();
  const old = conn();
  link.recover("시험");
  await until(() => link.state === "ready", "다시 붙기");
  assert.deepEqual(old.destroyed, ["leave"]);
  assert.equal(old.listenerCount("stateChange"), 0);
  old.emit("stateChange", { status: "ready" }, { status: VoiceConnectionStatus.Destroyed });
  await sleep(10);
  assert.equal(joins.length, 2, "옛 연결의 부서짐으로 또 다시 붙이지 않는다");
});

test("복구는 한 번에 하나. 복구 중에 또 부르면 아무것도 안 한다", async () => {
  const { link } = await ready();
  joinWorks = [false, false, true];
  link.recover("하나");
  link.recover("둘");
  await until(() => link.state === "ready", "다시 붙기");
  assert.equal(link.recoveryAttempts, 3, "한 복구가 세 번 시도했다(두 번째 부름이 새로 시작하지 않았다)");
  assert.equal(joins.length, 4, "처음 연결 하나 + 시도 셋");
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
  assert.deepEqual(kicked.steps, ["dispose:remove:disconnected:forced-disconnect"]);
  kicked.conn().to(VoiceConnectionStatus.Disconnected, { reason: VoiceConnectionDisconnectReason.WebSocketClose, closeCode: 4014 });
  assert.equal(kicked.link.state, "closed");

  const gone = await ready();
  gone.channels.delete("vc1");
  gone.link.onBotState(state("vc1"), state(null));
  assert.deepEqual(gone.steps, ["dispose:remove:-:channel-gone"]);
});

test("봇이 옮겨졌다: 다시 붙지 않고 기록만 맞춘다. 곧바로 원래 채널로 되돌아오면 목적지로 한 번 다시 옮긴다", async () => {
  const { link, player, conn } = await ready();
  const vc2 = fake<VoiceBasedChannel>({ id: "vc2" });
  assert.equal(link.onBotState(state("vc1"), state("vc2", { channel: vc2 })).moved, true);
  assert.equal(player.voiceChannel.id, "vc2");
  assert.deepEqual(conn().rejoins, []);

  const back = fake<VoiceBasedChannel>({ id: "vc1" });
  link.onBotState(state("vc2"), state("vc1", { channel: back }));
  assert.deepEqual(conn().rejoins, [{ channelId: "vc2", selfDeaf: false, selfMute: false }]);
  assert.equal(joins.length, 1, "새 연결을 만들지 않는다");
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
