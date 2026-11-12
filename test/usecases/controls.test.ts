// src/usecases/controls.ts: 재생 조작 코어. 전제 조건을 같은 순서로 보고, 조작하고, 패널에 알린다.
// 플레이어는 호출을 기록하는 가짜다. 권한 검사는 실제 판정 함수에 가짜 멤버를 넘긴다(서버 관리자는 통과, 봇과 다른 채널에 있으면 거절).

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { codedError } from "../../src/rules/error-kind.ts";
import * as controls from "../../src/usecases/controls.ts";
import * as playerEvents from "../../src/player/events.ts";
import * as errors from "../../src/ui/text/ko/errors.ts";
import { controlMessage } from "../../src/ui/control-messages.ts";
import sink from "../../src/infra/log/sink.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { Status, type Guild, type GuildMember } from "discord.js";
import type { Actor } from "../../src/usecases/controls.ts";
import { Player } from "../../src/player/player.ts";
import { PauseState } from "../../src/player/pause-state.ts";
import type { Hold } from "../../src/rules/holds.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer as asPlayer } from "../helpers/fake.ts";
import { lingeringGuild } from "../helpers/lingering-guild.ts";
import { useDefaultDocuments } from "../helpers/config-docs.ts";
import * as genreConfig from "../../src/config/genres.ts";
import * as guildSettings from "../../src/store/guild-settings.ts";
import { plainText } from "../helpers/notice.ts";
import * as staySeats from "../../src/store/stay-seats.ts";

useDefaultDocuments();

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

const guild = fake<Guild>({ id: "g1", name: "서버", members: { me: { voice: { channel: { id: "vc1" } } } }, roles: { cache: new Map([["dj", { id: "dj" }]]) } });
const member = ({ mod = true, inVoice = true, id = "u1" } = {}) => fake<GuildMember>({ id, user: { tag: `사람 ${id}` }, guild, permissions: { has: () => mod }, voice: { channel: inVoice ? { id: "vc1" } : null }, roles: { cache: new Map() } });
const DJ: Actor = { member: member() };

// DJ 역할을 정해 둔 동안(정하지 않으면 모든 멤버가 DJ 다). 역할이 없는 멤버는 DJ 가 아니다
async function withDjRole(run: () => Promise<void>) {
  guildSettings.setDjRoles("g1", ["dj"]);
  try {
    await run();
  } finally {
    guildSettings.clearDjRoles("g1");
  }
}
const OUTSIDER: Actor = { member: member({ mod: false, inVoice: false }) };

const track = (title: string, extra: Partial<QueuedTrack> = {}): QueuedTrack => ({ title, pageUrl: "", requestKey: title, platform: "youtube", duration: 0, ...extra });

// 부른 것을 적는 가짜 플레이어. 멈춤은 진짜 상태 모듈(오디오는 재생 중인 가짜). user, holds 로 처음 상태를 준다
function fakePlayer({ user = false, holds = [] as Hold[], ...over }: { user?: boolean; holds?: Hold[] } & { [K in keyof Player]?: unknown } = {}) {
  const calls: string[] = [];
  const audio = { state: { status: "playing" }, pause: () => true, unpause: () => true };
  const pause = new PauseState(
    () => audio as never,
    (change) => change.user !== undefined && calls.push(change.user ? "pause" : "resume"),
  );
  pause.setHolds(holds);
  if (user) pause.setUser(true);
  calls.length = 0;
  const p = {
    guild,
    currentTrack: track("지금"),
    queue: [track("a"), track("b")],
    previousTracks: [track("전")],
    loop: false,
    pause,
    get paused() {
      return pause.silent;
    },
    volume: 50,
    isLive: false,
    isPlayStarting: false,
    sponsor: null,
    skip: (reason?: string) => (calls.push(`skip${reason ? `:${reason}` : ""}`), true),
    previous: () => (calls.push("previous"), true),
    _restartsOnPrevious: Player.prototype._restartsOnPrevious,
    seek: async (ms: number, reason: string) => calls.push(`seek:${ms}:${reason}`),
    setVolume: (v: number) => (calls.push(`volume:${v}`), v),
    setLoop: (m: unknown) => calls.push(`loop:${m}`),
    hasLiveTrack: () => false,
    shuffleQueue: () => calls.push("shuffle"),
    removeFromQueue: (tracks: QueuedTrack[]) => {
      const gone = new Set(tracks);
      const at = p.queue.flatMap((t: QueuedTrack, i: number) => (gone.has(t) ? [i] : []));
      if (at.length) calls.push(`remove:${at.join(",")}`);
      const removed = p.queue.filter((t: QueuedTrack) => gone.has(t));
      p.queue = p.queue.filter((t: QueuedTrack) => !gone.has(t));
      return removed;
    },
    moveInQueue: (f: number, t: number) => (calls.push(`move:${f}->${t}`), p.queue.splice(t, 0, p.queue.splice(f, 1)[0]), true),
    clearQueue: () => (calls.push("clear"), (p.queue = [])),
    dispose: async (o: { session: string; panel?: string }) => calls.push(`dispose:${o.session}:${o.panel ?? "-"}`),
    _trackLabel: () => '"지금"',
    getCurrentTime: () => 65_000,
  };
  // 테스트가 준 필드로 덮는다(키는 매개변수 타입이 진짜 플레이어의 것만 받는다)
  Object.assign(p, over);
  return asPlayer(p, { calls });
}

// 패널에 알린 것
function panel() {
  const seen: string[] = [];
  playerEvents.on("refresh", async () => seen.push("refresh"));
  playerEvents.on("ended", async (_p, reason) => seen.push(`ended:${reason}`));
  return seen;
}

test("공통: 플레이어가 없으면 no-song, 권한이 없으면 권한 판정이 막은 까닭의 코드", async () => {
  assert.deepEqual(await controls.pause(null, DJ), { ok: false, code: "no-song" });
  assert.deepEqual(await controls.pause(fakePlayer(), OUTSIDER), { ok: false, code: "must-be-in-same-voice" });
});

test("멈춤: 곡이 없으면 거절, 있으면 사람의 멈춤을 뒤집고 패널에 알린다", async () => {
  const seen = panel();
  assert.equal(codeOf(await controls.pause(fakePlayer({ currentTrack: null }), DJ)), "no-song");

  const playing = fakePlayer();
  assert.deepEqual(await controls.pause(playing, DJ), { ok: true, userPaused: true, heldBy: null, track: playing.currentTrack });
  const paused = fakePlayer({ user: true });
  assert.equal(accepted(await controls.pause(paused, DJ)).userPaused, false);
  assert.deepEqual([...playing.calls, ...paused.calls], ["pause", "resume"]);
  assert.deepEqual(seen, ["refresh", "refresh"]);
});

test("억제 사유(서버 음소거, 스테이지 청중, 혼자 남음)로 멈춰 있어도 사람의 멈춤만 뒤집는다. 거절하지 않는다", async () => {
  // 억제로 멈춘 채 누르면 일시정지한다: 소리는 이미 멈춰 있고, 사유가 풀려도 멈춘 채로
  const muted = fakePlayer({ holds: ["mute"] });
  assert.deepEqual(await controls.pause(muted, DJ), { ok: true, userPaused: true, heldBy: "mute", track: muted.currentTrack });
  muted.pause.setHolds([]);
  assert.equal(muted.paused, true, "음소거가 풀려도 멈춘 채");

  // 일시정지를 풀면 사유가 남아 있는 동안은 조용하고, 사유가 풀리면 이어 튼다
  const alone = fakePlayer({ user: true, holds: ["alone"] });
  assert.deepEqual(await controls.pause(alone, DJ), { ok: true, userPaused: false, heldBy: "alone", track: alone.currentTrack });
  assert.equal(alone.paused, true);
  alone.pause.setHolds([]);
  assert.equal(alone.paused, false);

  assert.equal(accepted(await controls.pause(fakePlayer({ holds: ["alone", "stage"] }), DJ)).heldBy, "stage", "여럿이면 보여 줄 첫째");
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

test("정지: 세션을 삭제하고 끝난 패널(stop)로 버린다. 레지스트리 빼기는 버림이 한다", async () => {
  const p = fakePlayer();
  const r = await controls.stop(p, DJ);
  assert.deepEqual(r, { ok: true, track: p.currentTrack, cleared: 2, stayed: false });
  assert.deepEqual(p.calls, ["dispose:remove:stop"]);
});

test("이전 곡: 기록이 없거나 틀고 있는 곡이 없으면 거절(한곡 반복, 대기열 반복은 허용). 되돌아간 곡을 싣는다", async () => {
  // 이전 곡으로 가면 그 곡이 대기열 맨 앞에 선다(trackState.rewind). 가짜는 그 위치를 미리 채워 둔다
  const now = track("지금");
  const back = track("전");
  const rewound = (over: object) => fakePlayer({ currentTrack: now, queue: [back, track("a")], ...over });
  assert.equal(codeOf(await controls.previous(fakePlayer({ previousTracks: [] }), DJ)), "no-previous");
  assert.deepEqual(await controls.previous(rewound({ previousTracks: [], loop: "track" }), DJ), { ok: true, restarted: true, track: now }, "되감으면 지금 곡");
  assert.deepEqual(await controls.previous(rewound({ previousTracks: [], loop: "queue" }), DJ), { ok: true, restarted: false, track: back }, "대기열이 고리라 맨 끝 곡으로");
  assert.deepEqual(await controls.previous(rewound({ previousTracks: [], loop: "queue", queue: [] }), DJ), { ok: true, restarted: true, track: now }, "고리에 지금 곡뿐");
  assert.equal(codeOf(await controls.previous(fakePlayer({ currentTrack: null }), DJ)), "no-song");
});

test("위치 이동: 라이브, 여는 중은 거절. 받아들이면 onAccepted 뒤에 옮긴다", async () => {
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

test("하이라이트: 지점이 없으면 거절, 있으면 그 위치로(원인 highlight)", async () => {
  assert.equal(codeOf(await controls.highlight(fakePlayer(), DJ)), "no-highlight");
  assert.equal(codeOf(await controls.highlight(fakePlayer({ isLive: true, sponsor: { highlightAt: 3 } }), DJ)), "live-no-seek");
  const p = fakePlayer({ sponsor: { highlightAt: 42.5 } });
  assert.equal(accepted(await controls.highlight(p, DJ)).ms, 42_500);
  assert.deepEqual(p.calls, ["seek:42500:highlight"]);
});

test("볼륨: 0 ~ 100 정수만, 전후를 돌려준다", async () => {
  for (const bad of [-1, 101, 5.5, NaN, "50"]) assert.equal(codeOf(await controls.volume(fakePlayer(), DJ, bad)), "bad-volume", String(bad));
  assert.deepEqual(await controls.volume(fakePlayer(), DJ, 80), { ok: true, before: 50, level: 80 });
});

test("볼륨: 잇달아 바꾸면 소리는 바로, 로그 한 줄과 패널 고치기는 멈춘 뒤 한 번", async (t) => {
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

test("볼륨: 멈춘 뒤 settled 를 처음 값 → 마지막 값으로 한 번 부른다. 처음 값으로 돌아왔으면 부르지 않는다", async (t) => {
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

test("볼륨: 멈춘 뒤 서버 볼륨으로 저장해, 정지했다가 다시 틀 때 그 볼륨으로 시작한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await guildSettings.saveVolume("g1", 100); // 앞 테스트가 남긴 값
  const p = fakePlayer();
  p.setVolume = (v: number) => (p.volume = v);

  await controls.volume(p, DJ, 35);
  assert.equal(guildSettings.resolveVolume("g1"), 100, "멈추기 전에는 저장하지 않는다");
  t.mock.timers.tick(controls.VOLUME_SETTLE_MS);
  await new Promise(setImmediate);
  guildSettings.forgetCache();
  assert.equal(guildSettings.resolveVolume("g1"), 35);
  await guildSettings.saveVolume("g1", 100);
});

test("반복: 모드 확인, 라이브가 있으면 켜기만 거절", async () => {
  assert.equal(codeOf(await controls.loop(fakePlayer(), DJ, "all")), "bad-loop-mode");
  const live = fakePlayer({ hasLiveTrack: () => true });
  assert.equal(codeOf(await controls.loop(live, DJ, "track")), "live-no-loop");
  assert.equal((await controls.loop(live, DJ, false)).ok, true, "끄는 것은 언제나 통한다");
});

test("섞기, 비우기: 곡 수가 모자라면 거절", async () => {
  assert.equal(codeOf(await controls.shuffle(fakePlayer({ queue: [track("a")] }), DJ)), "too-few-to-shuffle");
  assert.deepEqual(await controls.shuffle(fakePlayer(), DJ), { ok: true, count: 2 });
  assert.equal(codeOf(await controls.clear(fakePlayer({ queue: [] }), DJ)), "queue-empty");
  assert.equal(accepted(await controls.clear(fakePlayer(), DJ)).count, 2);
});

test("빼기: 빈 대기열, 범위 밖 거절, 권한은 그 곡을 보고(넣은 사람은 DJ 가 아니어도 뺀다)", async () => {
  assert.equal(codeOf(await controls.remove(fakePlayer({ queue: [] }), DJ, 0)), "queue-empty");
  assert.deepEqual(await controls.remove(fakePlayer(), DJ, 5), { ok: false, code: "bad-position", size: 2 });
  const p = fakePlayer({ queue: [track("남의 곡"), track("내 곡", { requestedBy: { id: "u9" } })] });
  const requester = { member: member({ mod: false, id: "u9" }) };
  assert.equal(codeOf(await controls.remove(p, OUTSIDER, 0)), "must-be-in-same-voice");
  assert.equal(accepted(await controls.remove(p, requester, 1)).removed[0].title, "내 곡");

  // 권한을 기다리는 사이 앞 곡이 빠져도 권한을 본 그 곡을 뺀다. 그 곡이 빠졌으면 다른 곡을 빼지 않고 거절한다
  const shifted = fakePlayer({ queue: [track("a"), track("b"), track("c")] });
  queueMicrotask(() => shifted.queue.splice(0, 1));
  assert.equal(accepted(await controls.remove(shifted, DJ, 1)).removed[0].title, "b");
  const gone = fakePlayer({ queue: [track("a"), track("b"), track("c")] });
  queueMicrotask(() => gone.queue.splice(1, 1));
  assert.equal(codeOf(await controls.remove(gone, DJ, 1)), "entry-gone");
  assert.deepEqual(gone.calls, [], "아무것도 빼지 않았다");
});

test("구간 빼기(/remove 번호 끝번호): 둘 다 넣고 거꾸로 줘도 된다, 범위 밖은 거절. 넣은 사람은 구간이 모두 자기 곡일 때만", async () => {
  const titles = (r: Awaited<ReturnType<typeof controls.remove>>) => accepted(r).removed.map((t: QueuedTrack) => t.title);
  const five = () => fakePlayer({ queue: ["a", "b", "c", "d", "e"].map((t) => track(t)) });
  const p = five();
  assert.deepEqual(titles(await controls.remove(p, DJ, 1, 3)), ["b", "c", "d"]);
  assert.deepEqual([p.calls, accepted(await controls.remove(five(), DJ, 3, 1)).left], [["remove:1,2,3"], 2]);
  assert.deepEqual(await controls.remove(five(), DJ, 1, 5), { ok: false, code: "bad-position", size: 5 });

  const requester = { member: member({ mod: false, id: "u9" }) };
  const mine = (extra: Partial<QueuedTrack> = {}) => track("내 곡", { requestedBy: { id: "u9" }, ...extra });
  const mixed = fakePlayer({ queue: [mine(), track("남의 곡"), mine()] });
  await withDjRole(async () => {
    assert.equal(codeOf(await controls.remove(mixed, requester, 0, 2)), "must-dj");
    assert.deepEqual(mixed.calls, [], "한 곡이라도 남의 곡이면 아무것도 빼지 않는다");
    assert.deepEqual(titles(await controls.remove(mixed, requester, 2, 2)), ["내 곡"]);
  });
});

test("옮기기: 두 곡 미만, 범위 밖, 같은 위치 거절", async () => {
  assert.equal(codeOf(await controls.move(fakePlayer({ queue: [track("a")] }), DJ, 0, 0)), "too-few-to-move");
  assert.equal(codeOf(await controls.move(fakePlayer(), DJ, 0, 2)), "bad-position");
  assert.equal(codeOf(await controls.move(fakePlayer(), DJ, 1, 1)), "same-position");
  const p = fakePlayer();
  assert.equal(accepted(await controls.move(p, DJ, 1, 0)).track.title, "b");
  assert.deepEqual(p.calls, ["move:1->0"]);
});

// 대기열 ID를 단 곡(track-state 가 들어올 때 찍는 열거되지 않는 필드와 같게)
const entered = (title: string, entry: number, extra: Partial<QueuedTrack> = {}) => Object.defineProperty(track(title, extra), "entry", { value: entry, enumerable: false });

test("지금 곡 확인(onTrack): 지금 곡이 그 줄이 아니면 건너뛰기, 이전, 이동, 처음부터, 하이라이트를 하지 않는다", async () => {
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

test("대기열 ID로 빼기: 보던 순번이 밀려도 그 곡을 뺀다. 그 사이 다 빠졌으면 entry-gone, 권한은 그 곡을 보고", async () => {
  const p = fakePlayer({ queue: [entered("새로 들어온 곡", 9), entered("a", 1), entered("b", 2)] });
  assert.equal(accepted(await controls.removeEntries(p, DJ, [2])).removed[0].title, "b");
  assert.deepEqual(p.calls, ["remove:2"]);
  assert.equal(codeOf(await controls.removeEntries(p, DJ, [2])), "entry-gone");

  // 권한을 기다리는 사이 그 곡이 빠지면 다른 곡을 빼지 않고 거절한다
  const racing = fakePlayer({ queue: [entered("a", 1), entered("b", 2), entered("c", 3)] });
  queueMicrotask(() => racing.queue.splice(0, 1));
  assert.equal(codeOf(await controls.removeEntries(racing, DJ, [1])), "entry-gone");
  assert.deepEqual(racing.calls, [], "아무것도 빼지 않았다");

  const mine = fakePlayer({ queue: [entered("남의 곡", 1), entered("내 곡", 2, { requestedBy: { id: "u9" } })] });
  const requester = { member: member({ mod: false, id: "u9" }) };
  assert.equal(codeOf(await controls.removeEntries(mine, OUTSIDER, [2])), "must-be-in-same-voice");
  assert.equal(accepted(await controls.removeEntries(mine, requester, [2])).removed[0].title, "내 곡");
});

test("대기열 ID로 여러 곡 빼기: 대기열 차례로 빼고 없는 ID 는 건너뛴다. 넣은 사람은 모두 자기 곡일 때만(하나라도 남의 곡이면 모두 거절)", async () => {
  const p = fakePlayer({ queue: [entered("a", 1), entered("b", 2), entered("c", 3), entered("d", 4)] });
  const r = accepted(await controls.removeEntries(p, DJ, [4, 99, 2]));
  assert.deepEqual([r.removed.map((t: QueuedTrack) => t.title), r.left, p.calls], [["b", "d"], 2, ["remove:1,3"]]);

  const requester = { member: member({ mod: false, id: "u9" }) };
  const own = { requestedBy: { id: "u9" } };
  const mixed = fakePlayer({ queue: [entered("내 곡", 1, own), entered("남의 곡", 2), entered("내 곡 2", 3, own)] });
  await withDjRole(async () => {
    assert.equal(codeOf(await controls.removeEntries(mixed, requester, [1, 2])), "must-dj");
    assert.deepEqual(mixed.calls, [], "아무것도 빼지 않았다");
    assert.deepEqual(
      accepted(await controls.removeEntries(mixed, requester, [1, 3])).removed.map((t: QueuedTrack) => t.title),
      ["내 곡", "내 곡 2"],
    );
  });
});

test("대기열 ID로 옮기기: 그 곡 앞으로(null 이면 맨 끝). 그 사이 빠졌으면 entry-gone, 제자리면 same-position", async () => {
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

test("점프: 대기열 ID 의 곡을 맨 앞으로 옮기고 jump 로 넘긴다. 못 넘기면 되돌린다", async () => {
  const p = fakePlayer({ queue: [entered("a", 1), entered("b", 2)] });
  assert.equal(accepted(await controls.jump(p, DJ, 2)).track.title, "b");
  assert.deepEqual(p.calls, ["move:1->0", "skip:jump"]);

  const stuck = fakePlayer({ queue: [entered("a", 1), entered("b", 2)], skip: () => false });
  assert.equal(codeOf(await controls.jump(stuck, DJ, 2)), "switch-failed");
  assert.deepEqual(
    stuck.queue.map((t) => t.title),
    ["a", "b"],
    "자리를 되돌린다",
  );
});

test("점프: 메뉴를 그린 뒤 앞 곡이 빠져도 선택한 곡으로 간다. 없는 ID, 권한을 기다린 사이 빠진 곡은 entry-gone", async () => {
  const shifted = fakePlayer({ queue: [entered("b", 2), entered("c", 3)] });
  assert.equal(accepted(await controls.jump(shifted, DJ, 3)).track.title, "c", "번호(2)가 아니라 ID 로 찾는다");
  assert.deepEqual(shifted.calls, ["move:1->0", "skip:jump"]);

  assert.equal(codeOf(await controls.jump(fakePlayer({ queue: [entered("a", 1)] }), DJ, 9)), "entry-gone");

  const racing = fakePlayer({ queue: [entered("a", 1), entered("b", 2)] });
  queueMicrotask(() => racing.queue.splice(1, 1));
  assert.equal(codeOf(await controls.jump(racing, DJ, 2)), "entry-gone");
  assert.deepEqual(racing.calls, [], "넘기지 않는다");
});

test("나가기: 권한부터 본다. 플레이어가 있으면 저장하고 빼고 알리고, 없어도 봇이 음성에 있으면 나간다", async () => {
  const players = new Map<string, Player>();
  assert.equal(codeOf(await controls.leave(guild, OUTSIDER, players)), "must-be-in-same-voice");

  const p = fakePlayer();
  players.set("g1", p);
  const r = await controls.leave(guild, DJ, players);
  assert.deepEqual(r, { ok: true, left: "player", track: p.currentTrack, saved: { queue: 2, positionSec: 65 }, stayOff: false });
  assert.deepEqual(p.calls, ["dispose:save:leave"], "세션을 저장하고 끝난 패널(leave)로 버린다");

  let disconnected = 0;
  // 샤드가 끊겨 있으면 게이트웨이 없이 REST 로 나간다(게이트웨이 경로는 아래 테스트)
  const lingering = fake<Guild>({ id: "g2", shard: { status: Status.Disconnected }, members: { me: { voice: { channel: { id: "vc1" }, channelId: "vc1", disconnect: async () => disconnected++ } } } });
  assert.deepEqual(await controls.leave(lingering, DJ, players), { ok: true, left: "voice-only", stayOff: false });
  assert.equal(disconnected, 1);
  assert.equal(codeOf(await controls.leave(fake<Guild>({ id: "g3", members: { me: {} } }), DJ, players)), "no-song");
});

test("패널을 못 고쳐도 조작은 된 것이다", async () => {
  playerEvents.on("refresh", async () => {
    throw new Error("패널 실패");
  });
  assert.equal((await controls.shuffle(fakePlayer(), DJ)).ok, true);
});

test("자동재생: 권한부터. DJ 계층이고 봇이 쉬면 소환할 수 있어야 한다", async () => {
  const [genre] = Object.keys(genreConfig.genres().genres);
  assert.deepEqual(await controls.autoplayBlocked(OUTSIDER), { ok: false, code: "must-be-in-same-voice" });
  assert.equal(await controls.autoplayBlocked(DJ), null);

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

test("자동재생 켜기: 모르는 장르는 거절. 플레이어가 없으면 그때 만들고, 틀고 있지 않으면 응답한 뒤 첫 곡을 선택한다", async () => {
  const [genre] = Object.keys(genreConfig.genres().genres);
  const seen = panel();
  assert.deepEqual(await controls.autoplay(null, DJ, "없는장르", { create: () => assert.fail("거절하면 만들지 않는다") }), { ok: false, code: "unknown-genre", genre: "없는장르" });
  assert.equal(plainText(controlMessage({ code: "unknown-genre", genre: "없는장르" })), "알 수 없는 장르예요!\n그 사이 장르 목록이 변경되어 `없는장르`는 없어졌어요. 장르를 다시 선택해 주세요.");

  // 음성에 먼저 붙고 나서 켠다(첫 곡을 넣는 것은 DB 에 쓴다. 붙지 못했을 때 앞 플레이어가 남긴 세션을 건드리지 않게)
  const order: string[] = [];
  const made = fakePlayer({ currentTrack: null, connection: null, voice: { connect: async () => order.push("connect") }, setAutoplay: (g: unknown) => order.push(`set:${g}`), handleAutoplay: async () => order.push("first") });
  const r = await controls.autoplay(null, DJ, genre, { create: () => (order.push("create"), made), onAccepted: () => order.push("answer") });
  assert.deepEqual(r, { ok: true, genre, started: true });
  assert.deepEqual(order, ["create", "connect", `set:${genre}`, "answer", "first"]);

  // 붙지 못하면 켜지 않고 플레이어를 버린다. 세션은 건드리지 않는다(keep)
  const disposed: unknown[] = [];
  const stranded = fakePlayer({
    currentTrack: null,
    connection: null,
    voice: {
      connect: async () => {
        throw new Error("붙지 못함");
      },
    },
    setAutoplay: () => assert.fail("켜지 않는다"),
    handleAutoplay: async () => assert.fail("뽑지 않는다"),
    dispose: async (o: unknown) => disposed.push(o),
  });
  assert.deepEqual(await controls.autoplay(null, DJ, genre, { create: () => stranded }), { ok: false, code: "voice-failed" });
  assert.deepEqual(disposed, [{ reason: "음성 채널 접속 실패", session: "keep", end: "connect-failed" }]);
  // 종료 중이라 붙지 않았으면 bot-shutting-down 으로 거절한다
  const stopping = fakePlayer({ currentTrack: null, connection: null, voice: { connect: async () => Promise.reject(codedError("bot-shutting-down", "종료 중")) }, setAutoplay: () => assert.fail("켜지 않는다"), dispose: async (o: (typeof disposed)[number]) => void disposed.push(o) });
  assert.deepEqual(await controls.autoplay(null, DJ, genre, { create: () => stopping }), { ok: false, code: "bot-shutting-down" });
  assert.equal(disposed.length, 2);

  // 틀고 있으면 지금 곡이 끝난 뒤에 이어진다. 선택하지 않고 패널만 갱신한다
  const playing = fakePlayer({ setAutoplay: () => {}, handleAutoplay: async () => assert.fail("뽑지 않는다") });
  assert.deepEqual(await controls.autoplay(playing, DJ, genre, { create: () => assert.fail("있으면 만들지 않는다") }), { ok: true, genre, started: false });
  assert.deepEqual(seen, ["refresh"]);
});

test("안내: 코드와 값의 안내", () => {
  assert.deepEqual(controlMessage({ code: "must-dj" }), errors.notice("must-dj"));
  assert.equal(plainText(controlMessage({ code: "bad-position", size: 3 })), "그 번호의 곡은 존재하지 않아요!\n대기열에는 3곡만 있어요. 1~3 사이로 적어 주세요.");
});

test("상주 모드: 정지는 대기열만 비우고 채널에 남는다(재생 준비 중이면 거절). 나가기는 DJ 조작이라 상주 모드까지 끄고(켜고 끄는 권한과 같다), 거절하면 상주 모드는 유지된다", async () => {
  staySeats.set("g1", "vc1", "u1");
  try {
    const p = fakePlayer({ voiceChannel: { id: "vc1" }, stopStaying: async () => void p.calls.push("stop-staying") });
    assert.deepEqual(await controls.stop(p, DJ), { ok: true, track: p.currentTrack, cleared: 2, stayed: true });
    assert.deepEqual(p.calls, ["stop-staying"]);
    assert.equal(codeOf(await controls.stop(fakePlayer({ voiceChannel: { id: "vc1" }, isPlayStarting: true }), DJ)), "still-starting", "여는 곡이 정지 뒤에 틀어지지 않게");
    const elsewhere = fakePlayer({ voiceChannel: { id: "vc2" } });
    await controls.stop(elsewhere, DJ);
    assert.deepEqual(elsewhere.calls, ["dispose:remove:stop"], "자리가 아닌 채널이면 보통의 정지");

    const players = new Map<string, Player>([["g1", fakePlayer({ voiceChannel: { id: "vc1" } })]]);
    assert.equal(codeOf(await controls.leave(guild, OUTSIDER, players)), "must-be-in-same-voice");
    assert.ok(staySeats.seatOf("g1"), "거절하면 자리는 그대로");
    assert.equal(accepted(await controls.leave(guild, { member: member({ mod: false }) }, players)).stayOff, true, "서버 관리 권한이 없는 DJ도");
    assert.equal(staySeats.seatOf("g1"), null);
  } finally {
    staySeats.clear("g1");
  }
});

test("상주 모드: 플레이어도 없고 봇이 음성 채널에도 없으면(상주 채널 재접속 대기 중) 나가기는 상주 모드만 끈다고 답한다", async () => {
  const away = fake<Guild>({ id: "g1", name: "서버", members: { me: { voice: { channel: null } } } });
  const someone = fake<GuildMember>({ id: "u1", user: { tag: "사람" }, guild: away, permissions: { has: () => false }, voice: { channel: null }, roles: { cache: new Map() } });
  const players = new Map<string, Player>();
  staySeats.set("g1", "vc1", "u1");
  try {
    assert.deepEqual(await controls.leave(away, { member: someone }, players), { ok: true, left: "seat-only", stayOff: true });
    assert.equal(staySeats.seatOf("g1"), null);
    assert.equal(codeOf(await controls.leave(away, { member: someone }, players)), "no-song", "상주 모드도 꺼져 있으면 no-song");
  } finally {
    staySeats.clear("g1");
  }
});

test("멈춤: 휴면 중인 곡이면 ▶ 가 멈춤을 풀고 스트림을 다시 연다(기다리지 않고 답한다)", async () => {
  let woke = 0;
  const p = fakePlayer({ user: true, resting: true, wake: async () => void (woke += 1) });
  const r = accepted(await controls.pause(p, DJ));
  assert.equal(r.userPaused, false);
  assert.equal(woke, 1);
});

test("자동재생: 권한 판정 뒤 중단되면(go가 예외를 던짐, 대시보드 세션 종료) 플레이어를 만들지도 설정을 바꾸지도 않는다", async () => {
  const ended = () => {
    throw new Error("세션이 끝났다");
  };
  const [genre] = Object.keys(genreConfig.genres().genres);
  const p = fakePlayer({ setAutoplay: () => assert.fail("바꾸지 않는다") });
  await assert.rejects(controls.autoplay(p, DJ, false, { go: ended }), /세션이 끝났다/);
  await assert.rejects(controls.autoplay(null, DJ, genre, { create: () => assert.fail("만들지 않는다"), go: ended }), /세션이 끝났다/);
});

// 풀기 전에는 끝나지 않는 promise. 느린 패널 REST, 정리를 흉내 낸다
function held() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
// 돌아온 결과, 아직 기다리는 중이면 "waiting"
const raced = async <T>(work: Promise<T>) =>
  Promise.race([
    work,
    settle()
      .then(settle)
      .then(() => "waiting" as const),
  ]);

test("조작은 패널 갱신을 기다리지 않고 돌아온다(응답이 패널 REST 를 기다리지 않게). 갱신이 실패해도 처리되지 않은 거부가 없다", async () => {
  const gate = held();
  const off = playerEvents.on("refresh", () => gate.promise);
  try {
    const runs: Array<[string, () => Promise<{ ok: boolean }>]> = [
      ["멈춤", () => controls.pause(fakePlayer(), DJ)],
      ["넘기기", () => controls.skip(fakePlayer(), DJ)],
      ["반복", () => controls.loop(fakePlayer(), DJ, "queue")],
      ["섞기", () => controls.shuffle(fakePlayer({ queue: [track("a"), track("b"), track("c")] }), DJ)],
      ["빼기", () => controls.remove(fakePlayer(), DJ, 0)],
      ["옮기기", () => controls.move(fakePlayer(), DJ, 0, 1)],
      ["대기열 ID 로 빼기", () => controls.removeEntries(fakePlayer({ queue: [entered("a", 1)] }), DJ, [1])],
      ["대기열 ID 로 옮기기", () => controls.moveEntry(fakePlayer({ queue: [entered("a", 1), entered("b", 2)] }), DJ, 1, null)],
      ["비우기", () => controls.clear(fakePlayer(), DJ)],
      ["자동재생 끄기", () => controls.autoplay(fakePlayer({ autoplay: "kpop", setAutoplay: () => {} }), DJ, false)],
    ];
    for (const [name, run] of runs) {
      const r = await raced(run());
      assert.notEqual(r, "waiting", `${name}: 패널 갱신을 기다리지 않는다`);
      assert.equal(r !== "waiting" && r.ok, true, `${name}: 받아들인 조작이어야 이 테스트가 뜻이 있다`);
    }
  } finally {
    off();
    gate.release();
  }

  const rejected: unknown[] = [];
  const onRejection = (error: unknown) => void rejected.push(error);
  process.on("unhandledRejection", onRejection);
  const failing = playerEvents.on("refresh", async () => {
    throw new Error("REST 실패");
  });
  try {
    await controls.loop(fakePlayer(), DJ, "track");
    await settle();
    await settle();
    assert.deepEqual(rejected, []);
  } finally {
    failing();
    process.off("unhandledRejection", onRejection);
  }
});

test("정지, 나가기: 정리를 시작한 뒤 onAccepted 로 답하고 정리가 끝난 뒤 돌아온다. 답이 던져도 정리는 끝까지 하고 그 오류를 올린다", async () => {
  const order: string[] = [];
  const slow = (gate: { promise: Promise<void> }) =>
    fakePlayer({
      dispose: (o: { session: string }) => {
        order.push(`dispose:${o.session}`);
        return gate.promise.then(() => void order.push("disposed"));
      },
    });

  const gate = held();
  const p = slow(gate);
  const stopping = controls.stop(p, DJ, { onAccepted: (facts) => void order.push(`accepted:${facts.cleared}`) });
  await settle();
  assert.deepEqual(order, ["dispose:remove", "accepted:2"], "정리를 먼저 시작하고 답한다");
  assert.equal(await raced(stopping), "waiting", "정리가 끝나기 전에는 돌아오지 않는다");
  gate.release();
  assert.deepEqual(await stopping, { ok: true, track: p.currentTrack, cleared: 2, stayed: false });
  assert.equal(order.at(-1), "disposed");

  order.length = 0;
  const failing = held();
  const broken = controls.stop(slow(failing), DJ, {
    onAccepted: () => {
      throw new Error("응답 실패");
    },
  });
  await settle();
  failing.release();
  await assert.rejects(broken, /응답 실패/);
  assert.deepEqual(order, ["dispose:remove", "disposed"], "답이 실패해도 정리는 끝난다");

  order.length = 0;
  const leaving = held();
  const lp = slow(leaving);
  const players = new Map<string, Player>([["g1", lp]]);
  const left = controls.leave(guild, DJ, players, { onAccepted: (facts) => void order.push(`accepted:${facts.left}`) });
  await settle();
  assert.deepEqual(order, ["dispose:save", "accepted:player"]);
  leaving.release();
  assert.equal(accepted(await left).left, "player");
});

test("상주 모드 정지: 대기열 비우기를 시작한 뒤 답하고, 끝난 패널을 기다리는 사이 끝난 패널 그리기가 실패해도 처리되지 않은 거부 없이 warn 으로 남긴다", async () => {
  staySeats.set("g1", "vc1", "u1");
  const rejected: unknown[] = [];
  const onRejection = (error: unknown) => void rejected.push(error);
  process.on("unhandledRejection", onRejection);
  try {
    const order: string[] = [];
    const gate = held();
    const p = fakePlayer({
      voiceChannel: { id: "vc1" },
      stopStaying: () => {
        order.push("stop-staying");
        return gate.promise.then(() => Promise.reject(new Error("끝난 패널 실패")));
      },
    });
    const from = sink.buffer.length;
    const stopping = controls.stop(p, DJ, {
      onAccepted: async () => {
        order.push("accepted");
        gate.release();
        await settle();
        await settle();
      },
    });
    assert.deepEqual(await stopping, { ok: true, track: p.currentTrack, cleared: 2, stayed: true });
    assert.deepEqual(order, ["stop-staying", "accepted"]);
    assert.deepEqual(rejected, []);
    assert.ok(sink.buffer.slice(from).some((e) => e.level === "warn" && e.text.includes("끝난 패널 실패")));
  } finally {
    process.off("unhandledRejection", onRejection);
    staySeats.clear("g1");
  }
});

test("멈춤(▶): 실패로 일시정지해 둔 곡이면 onAccepted 로 먼저 답한 뒤 다시 연다. 답한 사이 곡이 바뀌면 track-changed, 정리되면 no-song. 보통 곡은 onAccepted 를 부르지 않는다", async () => {
  const order: string[] = [];
  const parked = (over: object = {}) => fakePlayer({ parked: true, retryParked: async () => void order.push("retry"), ...over });

  const p = parked();
  const r = await controls.pause(p, DJ, { onAccepted: () => void order.push("accepted") });
  assert.equal(accepted(r).track, p.currentTrack);
  assert.deepEqual(order, ["accepted", "retry"]);

  order.length = 0;
  const changed = parked();
  const r2 = await controls.pause(changed, DJ, { onAccepted: () => void (changed.currentTrack = track("다른 곡")) });
  assert.equal(codeOf(r2), "track-changed");
  assert.deepEqual(order, [], "다시 열지 않는다");

  const gone = parked();
  const r3 = await controls.pause(gone, DJ, { onAccepted: () => void (gone.currentTrack = null) });
  assert.equal(codeOf(r3), "no-song");
  assert.deepEqual(order, []);

  const plain = fakePlayer();
  await controls.pause(plain, DJ, { onAccepted: () => assert.fail("보통 곡은 곧바로 답한다") });
});

test("자동재생 켜기: 답(onAccepted)이 던져도 켠 자동재생은 첫 곡을 선택하고 답의 오류를 올린다. 둘 다 던지면 첫 곡의 오류는 warn 으로 남긴다", async () => {
  const [genre] = Object.keys(genreConfig.genres().genres);
  const order: string[] = [];
  const idle = (first: () => Promise<void>) => fakePlayer({ currentTrack: null, connection: {}, setAutoplay: () => {}, handleAutoplay: first });
  const answerFails = () => {
    throw new Error("답 실패");
  };
  await assert.rejects(
    controls.autoplay(
      idle(async () => void order.push("first")),
      DJ,
      genre,
      { onAccepted: answerFails },
    ),
    /답 실패/,
  );
  assert.deepEqual(order, ["first"], "봇이 음성에 붙은 채 아무것도 틀지 않는 일이 없다");

  const from = sink.buffer.length;
  const both = idle(async () => {
    throw new Error("첫 곡 실패");
  });
  await assert.rejects(controls.autoplay(both, DJ, genre, { onAccepted: answerFails }), /답 실패/);
  assert.ok(sink.buffer.slice(from).some((e) => e.level === "warn" && e.text.includes("첫 곡 실패")));

  await assert.rejects(
    controls.autoplay(
      idle(async () => Promise.reject(new Error("첫 곡 실패"))),
      DJ,
      genre,
    ),
    /첫 곡 실패/,
    "답이 멀쩡하면 첫 곡의 오류는 그대로 올린다",
  );
});

test("나가기(음성에만 남음): 먼저 답하고 나간다(어떻게 나가는지는 player/voice-leave 테스트)", async () => {
  const { guild, order } = lingeringGuild();
  const r = await controls.leave(guild, DJ, new Map(), { onLeaving: () => void order.push("answer") });
  assert.deepEqual(r, { ok: true, left: "voice-only", stayOff: false });
  assert.deepEqual(order, ["answer", "fetch:@me:true:false", "op4:vc1", "op4:null"], "나가기 전에 답한다");
});

test("나가기(음성에만 남음): 이미 나가 있었으면(40032) 나간 것, 못 나가면 leave-failed", async () => {
  const gone = lingeringGuild({ ready: false, restError: Object.assign(new Error("Target user is not connected to voice"), { code: 40032 }) });
  assert.deepEqual(await controls.leave(gone.guild, DJ, new Map()), { ok: true, left: "voice-only", stayOff: false });
  const stuck = lingeringGuild({ ready: false, restError: Object.assign(new Error("Missing Permissions"), { code: 50013 }) });
  assert.equal(codeOf(await controls.leave(stuck.guild, DJ, new Map())), "leave-failed");
});

test("나가기(음성에만 남음): 기다리는 사이 플레이어가 생기면(그사이 /join, /play) leave-superseded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { guild, order } = lingeringGuild({ takeOver: false });
  const players = new Map<string, Player>();
  const leaving = controls.leave(guild, DJ, players);
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  players.set("g9", fakePlayer());
  t.mock.timers.tick(1500);
  assert.equal(codeOf(await leaving), "leave-superseded");
  assert.deepEqual(order, ["fetch:@me:true:false", "op4:vc1"], "새로 붙은 연결을 쫓아내지 않는다");
});
