// src/usecases/controls.ts — 재생 조작 코어. 전제 조건을 같은 차례로 보고, 조작하고, 패널에 알린다.
// 플레이어는 부른 것을 적는 가짜. 권한은 진짜 판정에 가짜 멤버를 넘긴다(모더레이터는 통과, 봇과 다른 곳에 있으면 거절).

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as controls from "../../src/usecases/controls.ts";
import * as playerEvents from "../../src/player/events.ts";
import * as errors from "../../src/ui/text/ko/errors.ts";
import { controlMessage } from "../../src/ui/control-messages.ts";
import sink from "../../src/infra/log/sink.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import type { Guild, GuildMember } from "discord.js";
import type { Actor } from "../../src/usecases/controls.ts";
import { Player } from "../../src/player/player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import type { Loop } from "../../src/player/track-state.ts";
import { fake, fakePlayer as asPlayer } from "../helpers/fake.ts";
import { useExampleConfig } from "../helpers/example-config.ts";
import * as genreConfig from "../../src/config/genres.ts";
import { plainText } from "../helpers/notice.ts";

useExampleConfig();

afterEach(() => playerEvents._reset());

// 권한 판정이 서버 설정(DJ 역할)을 읽는다. 임시 DB 로
const store = openTempStore("controls-");
after(() => store.close());

// 거절 까닭. 해냈으면 undefined
const codeOf = (r: object) => ("code" in r ? r.code : undefined);
// 해낸 결과의 사실. 거절이면 실패
function accepted<R extends { ok: boolean }>(r: R) {
  if (!r.ok) assert.fail(`거절됨: ${JSON.stringify(r)}`);
  return r as Extract<R, { ok: true }>;
}

const guild = fake<Guild>({ id: "g1", members: { me: { voice: { channel: { id: "vc1" } } } } });
const member = ({ mod = true, inVoice = true, id = "u1" } = {}) => fake<GuildMember>({ id, guild, permissions: { has: () => mod }, voice: { channel: inVoice ? { id: "vc1" } : null }, roles: { cache: new Map() } });
const DJ: Actor = { member: member() };
const OUTSIDER: Actor = { member: member({ mod: false, inVoice: false }) };
const OWNER: Actor = { owner: true };

const track = (title: string, extra: Partial<QueuedTrack> = {}): QueuedTrack => ({ title, pageUrl: "", requestKey: title, platform: "youtube", duration: 0, ...extra });

// 부른 것을 적는 가짜 플레이어
function fakePlayer(over: object = {}) {
  const calls: string[] = [];
  const p = {
    calls,
    guild,
    currentTrack: track("지금"),
    queue: [track("a"), track("b")],
    previousTracks: [track("전")],
    loop: false,
    paused: false,
    pauseReasons: new Set<string>(),
    volume: 50,
    isLive: false,
    isPlayStarting: false,
    sponsor: null,
    pauseFor: () => (calls.push("pause"), true),
    resumeFor: () => (calls.push("resume"), true),
    skip: (reason?: string) => (calls.push(`skip${reason ? `:${reason}` : ""}`), true),
    previous: () => (calls.push("previous"), true),
    _restartsOnPrevious: Player.prototype._restartsOnPrevious,
    seek: async (ms: number, reason: string) => calls.push(`seek:${ms}:${reason}`),
    setVolume: (v: number) => (calls.push(`volume:${v}`), v),
    setLoop: (m: unknown) => calls.push(`loop:${m}`),
    hasLiveTrack: () => false,
    shuffleQueue: () => calls.push("shuffle"),
    removeFromQueue: (i: number) => (calls.push(`remove:${i}`), p.queue.splice(i, 1)[0]),
    moveInQueue: (f: number, t: number) => (calls.push(`move:${f}->${t}`), p.queue.splice(t, 0, p.queue.splice(f, 1)[0]), true),
    clearQueue: () => (calls.push("clear"), (p.queue = [])),
    dispose: async (o: { session: string; panel?: string }) => calls.push(`dispose:${o.session}:${o.panel ?? "-"}`),
    _trackLabel: () => '"지금"',
    getCurrentTime: () => 65_000,
    ...over,
  };
  return asPlayer(p);
}

// 패널에 알린 것
function panel() {
  const seen: string[] = [];
  playerEvents.on("refresh", async () => seen.push("refresh"));
  playerEvents.on("ended", async (_p, reason) => seen.push(`ended:${reason}`));
  return seen;
}

test("공통: 플레이어가 없으면 no-song, 권한이 없으면 권한 판정이 막은 까닭의 코드, 운영자는 권한을 건너뛴다", async () => {
  assert.deepEqual(await controls.pause(null, DJ), { ok: false, code: "no-song" });
  assert.deepEqual(await controls.pause(fakePlayer(), OUTSIDER), { ok: false, code: "must-be-in-same-voice" });
  assert.equal((await controls.pause(fakePlayer(), OWNER)).ok, true);
});

test("멈춤: 곡이 없으면 거절, 있으면 뒤집고 패널에 알린다", async () => {
  const seen = panel();
  assert.equal(codeOf(await controls.pause(fakePlayer({ currentTrack: null }), DJ)), "no-song");

  const playing = fakePlayer();
  assert.deepEqual(await controls.pause(playing, DJ), { ok: true, paused: true, track: playing.currentTrack });
  const paused = fakePlayer({ paused: true });
  assert.equal(accepted(await controls.pause(paused, DJ)).paused, false);
  assert.deepEqual([...playing.calls, ...paused.calls], ["pause", "resume"]);
  assert.deepEqual(seen, ["refresh", "refresh"]);

  assert.equal(codeOf(await controls.pause(fakePlayer({ pauseFor: () => false }), DJ)), "control-failed");
});

test("재개: 사람이 건 멈춤이 아닌 까닭(서버 음소거 · 혼자 남음)이 붙들고 있으면 그 까닭의 코드로 거절한다", async () => {
  const muted = fakePlayer({ paused: true, pauseReasons: new Set(["manual", "mute"]), resumeFor: () => (muted.pauseReasons.delete("manual"), false) });
  assert.deepEqual(await controls.pause(muted, DJ), { ok: false, code: "held-mute" });
  const alone = fakePlayer({ paused: true, pauseReasons: new Set(["manual", "alone"]), resumeFor: () => (alone.pauseReasons.delete("manual"), false) });
  assert.deepEqual(await controls.pause(alone, DJ), { ok: false, code: "held-alone" });
  assert.equal(codeOf(await controls.pause(fakePlayer({ paused: true, resumeFor: () => false }), DJ)), "control-failed", "붙든 까닭이 없으면 그냥 실패");
  assert.equal(codeOf(await controls.pause(fakePlayer({ pauseReasons: new Set(["mute"]), pauseFor: () => false }), DJ)), "control-failed", "멈추기 실패는 붙든 까닭과 상관없다");
});

test("건너뛰기: 다음 곡이 없어도 거절하지 않는다(곡 끝 처리가 대기열 소진으로 끝낸다, 한곡 반복은 처음부터). 곡 요청자는 DJ 가 아니어도 된다", async () => {
  const last = fakePlayer({ queue: [] });
  assert.deepEqual(await controls.skip(last, DJ), { ok: true, track: last.currentTrack, restarted: false });
  assert.deepEqual(last.calls, ["skip"]);
  assert.equal((await controls.skip(fakePlayer({ queue: [], autoplay: "pop" }), DJ)).ok, true);

  const looping = fakePlayer({ queue: [], loop: "track" });
  assert.deepEqual(await controls.skip(looping, DJ), { ok: true, track: looping.currentTrack, restarted: true });

  const mine = fakePlayer({ currentTrack: track("내 곡", { requestedBy: { id: "u9" } }) });
  const requester = { member: member({ mod: false, id: "u9" }) };
  assert.equal((await controls.skip(mine, requester)).ok, true);
});

test("정지: 세션을 지우고 끝난 패널(stop)로 버린다. 등록부 빼기는 버림이 한다", async () => {
  const p = fakePlayer();
  const r = await controls.stop(p, DJ);
  assert.deepEqual(r, { ok: true, track: p.currentTrack, cleared: 2 });
  assert.deepEqual(p.calls, ["dispose:remove:stop"]);
});

test("이전 곡: 기록이 없거나 틀고 있는 곡이 없으면 거절(한곡 반복 · 대기열 반복은 허용). 되돌아간 곡을 싣는다", async () => {
  // 이전 곡으로 가면 그 곡이 대기열 맨 앞에 선다(trackState.rewind). 가짜는 그 자리를 미리 채워 둔다
  const now = track("지금");
  const back = track("전");
  const rewound = (over: object) => fakePlayer({ currentTrack: now, queue: [back, track("a")], ...over });
  assert.equal(codeOf(await controls.previous(fakePlayer({ previousTracks: [] }), DJ)), "no-previous");
  assert.deepEqual(await controls.previous(rewound({ previousTracks: [], loop: "track" }), DJ), { ok: true, restarted: true, track: now }, "되감으면 지금 곡");
  assert.deepEqual(await controls.previous(rewound({ previousTracks: [], loop: "queue" }), DJ), { ok: true, restarted: false, track: back }, "대기열이 고리라 맨 끝 곡으로");
  assert.deepEqual(await controls.previous(rewound({ previousTracks: [], loop: "queue", queue: [] }), DJ), { ok: true, restarted: true, track: now }, "고리에 지금 곡뿐");
  assert.equal(codeOf(await controls.previous(fakePlayer({ currentTrack: null }), DJ)), "no-song");
});

test("위치 이동: 라이브 · 여는 중은 거절. 받아들이면 onAccepted 뒤에 옮긴다", async () => {
  assert.equal(codeOf(await controls.seek(fakePlayer({ isLive: true }), DJ, 1000)), "live-no-seek");
  assert.equal(codeOf(await controls.seek(fakePlayer({ isPlayStarting: true }), DJ, 1000)), "still-starting");

  const order: string[] = [];
  const p = fakePlayer({ seek: async (ms: number, reason: string) => order.push(`seek:${ms}:${reason}`) });
  await controls.seek(p, DJ, 30_000, { reason: "dashboard", onAccepted: () => order.push("accepted") });
  assert.deepEqual(order, ["accepted", "seek:30000:dashboard"]);

  const replayed = fakePlayer();
  await controls.replay(replayed, DJ);
  assert.deepEqual(replayed.calls, ["seek:0:replay"]);
});

test("하이라이트: 지점이 없으면 거절, 있으면 그 자리로(원인 highlight)", async () => {
  assert.equal(codeOf(await controls.highlight(fakePlayer(), DJ)), "no-highlight");
  assert.equal(codeOf(await controls.highlight(fakePlayer({ isLive: true, sponsor: { highlightAt: 3 } }), DJ)), "live-no-seek");
  const p = fakePlayer({ sponsor: { highlightAt: 42.5 } });
  assert.equal(accepted(await controls.highlight(p, DJ)).ms, 42_500);
  assert.deepEqual(p.calls, ["seek:42500:highlight"]);
});

test("음량: 0 ~ 100 정수만, 전후를 돌려준다", async () => {
  for (const bad of [-1, 101, 5.5, NaN, "50"]) assert.equal(codeOf(await controls.volume(fakePlayer(), DJ, bad)), "bad-volume", String(bad));
  assert.deepEqual(await controls.volume(fakePlayer(), DJ, 80), { ok: true, before: 50, level: 80 });
});

test("음량: 잇달아 바꾸면 소리는 바로, 로그 한 줄과 패널 고치기는 멈춘 뒤 한 번", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const lines: string[] = [];
  sink.addDestination((rec) => String(rec.msg).startsWith("볼륨:") && lines.push(String(rec.msg)));
  const seen = panel();
  const p = fakePlayer();
  p.setVolume = (v: number) => (p.calls.push(`volume:${v}`), (p.volume = v));

  for (const level of [60, 70, 80]) await controls.volume(p, DJ, level);
  assert.deepEqual(p.calls, ["volume:60", "volume:70", "volume:80"]);
  assert.deepEqual(seen, []);
  assert.deepEqual(lines, []);

  t.mock.timers.tick(controls.VOLUME_SETTLE_MS);
  await new Promise(setImmediate);
  assert.deepEqual(seen, ["refresh"]);
  assert.deepEqual(lines, ["볼륨: 50% → 80%"]);
});

test("음량: 멈춘 뒤 settled 를 처음 값 → 마지막 값으로 한 번 부른다. 처음 값으로 돌아왔으면 부르지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const shown: string[] = [];
  const settled = (from: number, to: number) => shown.push(`${from}→${to}`);
  const p = fakePlayer();
  p.setVolume = (v: number) => (p.volume = v);

  await controls.volume(p, DJ, 60, { settled });
  await controls.volume(p, DJ, 70, { settled });
  t.mock.timers.tick(controls.VOLUME_SETTLE_MS - 1);
  assert.deepEqual(shown, []);
  await controls.volume(p, DJ, 80, { settled });
  t.mock.timers.tick(controls.VOLUME_SETTLE_MS);
  assert.deepEqual(shown, ["50→80"]);

  await controls.volume(p, DJ, 90, { settled });
  await controls.volume(p, DJ, 80, { settled });
  t.mock.timers.tick(controls.VOLUME_SETTLE_MS);
  assert.deepEqual(shown, ["50→80"], "제자리면 부르지 않는다");
});

test("반복: 모드 확인, 라이브가 있으면 켜기만 거절. 버튼의 다음 모드는 끔 → 한곡 → 대기열 → 끔", async () => {
  assert.equal(codeOf(await controls.loop(fakePlayer(), DJ, "all")), "bad-loop-mode");
  const live = fakePlayer({ hasLiveTrack: () => true });
  assert.equal(codeOf(await controls.loop(live, DJ, "track")), "live-no-loop");
  assert.equal((await controls.loop(live, DJ, false)).ok, true, "끄는 것은 언제나 통한다");
  const modes: Array<Loop | "off"> = [false, "off", "track", "queue"];
  assert.deepEqual(modes.map(controls.nextLoopMode), ["track", "track", "queue", false]);
});

test("섞기 · 비우기: 곡 수가 모자라면 거절", async () => {
  assert.equal(codeOf(await controls.shuffle(fakePlayer({ queue: [track("a")] }), DJ)), "too-few-to-shuffle");
  assert.deepEqual(await controls.shuffle(fakePlayer(), DJ), { ok: true, count: 2 });
  assert.equal(codeOf(await controls.clear(fakePlayer({ queue: [] }), DJ)), "queue-empty");
  assert.equal(accepted(await controls.clear(fakePlayer(), DJ)).count, 2);
});

test("빼기: 빈 대기열 · 범위 밖 거절, 권한은 그 곡을 보고(넣은 사람은 DJ 가 아니어도 뺀다)", async () => {
  assert.equal(codeOf(await controls.remove(fakePlayer({ queue: [] }), DJ, 0)), "queue-empty");
  assert.deepEqual(await controls.remove(fakePlayer(), DJ, 5), { ok: false, code: "bad-position", size: 2 });
  const p = fakePlayer({ queue: [track("남의 곡"), track("내 곡", { requestedBy: { id: "u9" } })] });
  const requester = { member: member({ mod: false, id: "u9" }) };
  assert.equal(codeOf(await controls.remove(p, OUTSIDER, 0)), "must-be-in-same-voice");
  assert.equal(accepted(await controls.remove(p, requester, 1)).track?.title, "내 곡");
});

test("옮기기: 두 곡 미만 · 범위 밖 · 같은 자리 거절", async () => {
  assert.equal(codeOf(await controls.move(fakePlayer({ queue: [track("a")] }), DJ, 0, 0)), "too-few-to-move");
  assert.equal(codeOf(await controls.move(fakePlayer(), DJ, 0, 2)), "bad-position");
  assert.equal(codeOf(await controls.move(fakePlayer(), DJ, 1, 1)), "same-position");
  const p = fakePlayer();
  assert.equal(accepted(await controls.move(p, DJ, 1, 0)).track.title, "b");
  assert.deepEqual(p.calls, ["move:1->0"]);
});

// 줄 번호를 단 곡(track-state 가 들어올 때 찍는 열거되지 않는 칸과 같게)
const entered = (title: string, entry: number, extra: Partial<QueuedTrack> = {}) => Object.defineProperty(track(title, extra), "entry", { value: entry, enumerable: false });

test("지금 곡 확인(onTrack): 지금 곡이 그 줄이 아니면 건너뛰기 · 이전 · 이동 · 처음부터 · 하이라이트를 하지 않는다", async () => {
  const now = entered("지금", 7);
  const of = (over: object = {}) => fakePlayer({ currentTrack: now, sponsor: { highlightAt: 30 }, ...over });
  const changed: Array<[string, (p: ReturnType<typeof fakePlayer>) => Promise<object>]> = [
    ["skip", (p) => controls.skip(p, DJ, { onTrack: 6 })],
    ["previous", (p) => controls.previous(p, DJ, { onTrack: 6 })],
    ["seek", (p) => controls.seek(p, DJ, 1000, { onTrack: 6 })],
    ["replay", (p) => controls.replay(p, DJ, { onTrack: 6 })],
    ["highlight", (p) => controls.highlight(p, DJ, { onTrack: 6 })],
  ];
  for (const [name, run] of changed) {
    const p = of();
    assert.equal(codeOf(await run(p)), "track-changed", name);
    assert.deepEqual(p.calls, [], `${name}: 아무것도 안 했다`);
  }
  // 바뀐 곡에 하이라이트가 없어도 "곡이 바뀌었다"가 먼저다
  assert.equal(codeOf(await controls.highlight(of({ sponsor: null }), DJ, { onTrack: 6 })), "track-changed");
  const p = of();
  accepted(await controls.skip(p, DJ, { onTrack: 7 }));
  accepted(await controls.highlight(p, DJ, { onTrack: 7 }));
  accepted(await controls.skip(of(), DJ));
  assert.deepEqual(p.calls, ["skip", "seek:30000:highlight"]);
});

test("줄 번호로 빼기: 보던 순번이 밀려도 그 곡을 뺀다. 그 사이 빠졌으면 entry-gone, 권한은 그 곡을 보고", async () => {
  const p = fakePlayer({ queue: [entered("새로 들어온 곡", 9), entered("a", 1), entered("b", 2)] });
  assert.equal(accepted(await controls.removeEntry(p, DJ, 2)).track?.title, "b");
  assert.deepEqual(p.calls, ["remove:2"]);
  assert.equal(codeOf(await controls.removeEntry(p, DJ, 2)), "entry-gone");

  // 권한을 기다리는 사이 그 곡이 빠지면 다른 곡을 빼지 않고 거절한다
  const racing = fakePlayer({ queue: [entered("a", 1), entered("b", 2), entered("c", 3)] });
  queueMicrotask(() => racing.queue.splice(0, 1));
  assert.equal(codeOf(await controls.removeEntry(racing, DJ, 1)), "entry-gone");
  assert.deepEqual(racing.calls, [], "아무것도 빼지 않았다");

  const mine = fakePlayer({ queue: [entered("남의 곡", 1), entered("내 곡", 2, { requestedBy: { id: "u9" } })] });
  const requester = { member: member({ mod: false, id: "u9" }) };
  assert.equal(codeOf(await controls.removeEntry(mine, OUTSIDER, 2)), "must-be-in-same-voice");
  assert.equal(accepted(await controls.removeEntry(mine, requester, 2)).track?.title, "내 곡");
});

test("줄 번호로 옮기기: 그 줄 앞으로(null 이면 맨 끝). 그 사이 빠졌으면 entry-gone, 제자리면 same-position", async () => {
  const queue = () => [entered("a", 1), entered("b", 2), entered("c", 3)];
  const titles = (p: ReturnType<typeof fakePlayer>) => p.queue.map((t: QueuedTrack) => t.title).join("");
  const front = fakePlayer({ queue: queue() });
  accepted(await controls.moveEntry(front, DJ, 3, 1));
  assert.equal(titles(front), "cab");
  const back = fakePlayer({ queue: queue() });
  accepted(await controls.moveEntry(back, DJ, 1, 3));
  assert.equal(titles(back), "bac", "뒤쪽 줄 앞으로");
  const end = fakePlayer({ queue: queue() });
  accepted(await controls.moveEntry(end, DJ, 1, null));
  assert.equal(titles(end), "bca");
  assert.equal(codeOf(await controls.moveEntry(fakePlayer({ queue: queue() }), DJ, 9, 1)), "entry-gone");
  assert.equal(codeOf(await controls.moveEntry(fakePlayer({ queue: queue() }), DJ, 1, 9)), "entry-gone");
  assert.equal(codeOf(await controls.moveEntry(fakePlayer({ queue: queue() }), DJ, 1, 2)), "same-position", "바로 뒤 줄 앞은 제자리");
  assert.equal(codeOf(await controls.moveEntry(fakePlayer({ queue: queue() }), DJ, 3, null)), "same-position");
  assert.equal(codeOf(await controls.moveEntry(fakePlayer({ queue: [entered("a", 1)] }), DJ, 1, null)), "too-few-to-move");
  assert.equal(codeOf(await controls.moveEntry(fakePlayer({ queue: queue() }), OUTSIDER, 1, 3)), "must-be-in-same-voice");
});

test("점프: 그 곡을 맨 앞으로 옮기고 jump 로 넘긴다. 못 넘기면 되돌린다", async () => {
  const p = fakePlayer();
  assert.equal(accepted(await controls.jump(p, DJ, 1)).track.title, "b");
  assert.deepEqual(p.calls, ["move:1->0", "skip:jump"]);

  const stuck = fakePlayer({ skip: () => false });
  assert.equal(codeOf(await controls.jump(stuck, DJ, 1)), "switch-failed");
  assert.deepEqual(
    stuck.queue.map((t) => t.title),
    ["a", "b"],
    "자리를 되돌린다",
  );
  assert.equal(codeOf(await controls.jump(fakePlayer(), DJ, 9)), "bad-position");
});

test("나가기: 권한부터 본다. 플레이어가 있으면 저장하고 빼고 알리고, 없어도 봇이 음성에 있으면 나간다", async () => {
  const players = new Map<string, Player>();
  assert.equal(codeOf(await controls.leave(guild, OUTSIDER, players)), "must-be-in-same-voice");

  const p = fakePlayer();
  players.set("g1", p);
  const r = await controls.leave(guild, DJ, players);
  assert.deepEqual(r, { ok: true, left: "player", track: p.currentTrack, saved: { queue: 2, positionSec: 65 } });
  assert.deepEqual(p.calls, ["dispose:save:leave"], "세션을 저장하고 끝난 패널(leave)로 버린다");

  let disconnected = 0;
  const lingering = fake<Guild>({ id: "g2", members: { me: { voice: { channel: { id: "vc1" }, disconnect: async () => disconnected++ } } } });
  assert.deepEqual(await controls.leave(lingering, OWNER, players), { ok: true, left: "voice-only" });
  assert.equal(disconnected, 1);
  assert.equal(codeOf(await controls.leave(fake<Guild>({ id: "g3", members: { me: {} } }), OWNER, players)), "no-song");
});

test("패널을 못 고쳐도 조작은 된 것이다", async () => {
  playerEvents.on("refresh", async () => {
    throw new Error("패널 실패");
  });
  assert.equal((await controls.shuffle(fakePlayer(), DJ)).ok, true);
});

test("자동재생: 권한부터. DJ 계층이고 봇이 쉬면 소환할 수 있어야 한다. 운영자는 건너뛴다", async () => {
  const [genre] = Object.keys(genreConfig.genres().genres);
  assert.deepEqual(await controls.autoplayBlocked(OUTSIDER), { ok: false, code: "must-be-in-same-voice" });
  assert.equal(await controls.autoplayBlocked(DJ), null);
  assert.equal(await controls.autoplayBlocked(OWNER), null);

  // 봇이 쉬는데 부른 사람이 음성에 없으면 소환할 곳이 없다. 플레이어가 있어도 같다
  const idleGuild = fake<Guild>({ id: "g1", members: { me: { voice: { channel: null } } } });
  const away: Actor = { member: fake<GuildMember>({ id: "u1", guild: idleGuild, permissions: { has: () => true }, voice: { channel: null }, roles: { cache: new Map() } }) };
  const p = fakePlayer({ setAutoplay: () => assert.fail("바꾸지 않는다") });
  assert.deepEqual(await controls.autoplay(p, away, genre), { ok: false, code: "must-be-in-voice" });
});

test("자동재생 끄기: 플레이어가 없으면 거절. 끄고 응답한 뒤 패널에 알린다", async () => {
  const seen = panel();
  assert.deepEqual(await controls.autoplay(null, DJ, false, { create: () => assert.fail("끌 때는 만들지 않는다") }), { ok: false, code: "no-song" });

  const order: string[] = [];
  const p = fakePlayer({ autoplay: "가요", setAutoplay: (g: unknown) => order.push(`set:${g}`) });
  assert.deepEqual(await controls.autoplay(p, DJ, false, { onAccepted: () => order.push("answer") }), { ok: true, genre: false, started: false });
  assert.deepEqual(order, ["set:false", "answer"]);
  assert.deepEqual(seen, ["refresh"]);
});

test("자동재생 켜기: 모르는 장르는 거절. 플레이어가 없으면 그때 만들고, 틀고 있지 않으면 응답한 뒤 첫 곡을 뽑는다", async () => {
  const [genre] = Object.keys(genreConfig.genres().genres);
  const seen = panel();
  assert.deepEqual(await controls.autoplay(null, DJ, "없는장르", { create: () => assert.fail("거절하면 만들지 않는다") }), { ok: false, code: "unknown-genre", genre: "없는장르" });
  assert.equal(plainText(controlMessage({ code: "unknown-genre", genre: "없는장르" })), "알 수 없는 장르예요!\n그 사이 장르 목록이 변경되어 `없는장르`는 없어졌어요. 장르를 다시 선택해 주세요.");

  const order: string[] = [];
  const made = fakePlayer({ currentTrack: null, setAutoplay: (g: unknown) => order.push(`set:${g}`), handleAutoplay: async () => order.push("first") });
  const r = await controls.autoplay(null, DJ, genre, { create: () => (order.push("create"), made), onAccepted: () => order.push("answer") });
  assert.deepEqual(r, { ok: true, genre, started: true });
  assert.deepEqual(order, ["create", `set:${genre}`, "answer", "first"]);

  // 틀고 있으면 지금 곡이 끝난 뒤에 이어진다. 뽑지 않고 패널만 고친다
  const playing = fakePlayer({ setAutoplay: () => {}, handleAutoplay: async () => assert.fail("뽑지 않는다") });
  assert.deepEqual(await controls.autoplay(playing, DJ, genre, { create: () => assert.fail("있으면 만들지 않는다") }), { ok: true, genre, started: false });
  assert.deepEqual(seen, ["refresh"]);
});

test("안내: 코드와 값의 안내", () => {
  assert.deepEqual(controlMessage({ code: "must-dj" }), errors.notice("must-dj"));
  assert.equal(plainText(controlMessage({ code: "bad-position", size: 3 })), "그 번호의 곡은 존재하지 않아요!\n대기열에는 3곡만 있어요. 1~3 사이로 적어 주세요.");
});
