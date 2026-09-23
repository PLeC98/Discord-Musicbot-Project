"use strict";

// src/usecases/controls.js — 재생 조작 코어. 전제 조건을 같은 차례로 보고, 조작하고, 패널에 알린다.
// 플레이어는 부른 것을 적는 가짜. 권한은 진짜 판정에 가짜 멤버를 넘긴다(모더레이터는 통과, 봇과 다른 곳에 있으면 거절).

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const controls = require("../../src/usecases/controls");
const playerEvents = require("../../src/player/events");
const S = require("../../src/ui/strings");
const { controlMessage, controlApiError } = require("../../src/ui/controlMessages");

afterEach(() => playerEvents._reset());

const guild = { id: "g1", members: { me: { voice: { channel: { id: "vc1" } } } } };
const member = ({ mod = true, inVoice = true, id = "u1" } = {}) => ({ id, guild, permissions: { has: () => mod }, voice: { channel: inVoice ? { id: "vc1" } : null }, roles: { cache: new Map() } });
const DJ = { member: member() };
const OUTSIDER = { member: member({ mod: false, inVoice: false }) };
const OWNER = { owner: true };

const track = (title, extra = {}) => ({ title, ...extra });

function fakePlayer(over = {}) {
  const calls = [];
  const p = {
    calls,
    guild,
    currentTrack: track("지금"),
    queue: [track("a"), track("b")],
    previousTracks: [track("전")],
    loop: false,
    paused: false,
    volume: 50,
    isLive: false,
    isPlayStarting: false,
    sponsor: null,
    pause: () => (calls.push("pause"), true),
    resume: () => (calls.push("resume"), true),
    skip: (reason) => (calls.push(`skip${reason ? `:${reason}` : ""}`), true),
    stop: () => calls.push("stop"),
    previous: () => (calls.push("previous"), true),
    seek: async (ms, reason) => calls.push(`seek:${ms}:${reason}`),
    setVolume: (v) => (calls.push(`volume:${v}`), v),
    setLoop: (m) => calls.push(`loop:${m}`),
    hasLiveTrack: () => false,
    shuffleQueue: () => calls.push("shuffle"),
    removeFromQueue: (i) => (calls.push(`remove:${i}`), p.queue.splice(i, 1)[0]),
    moveInQueue: (f, t) => (calls.push(`move:${f}->${t}`), p.queue.splice(t, 0, p.queue.splice(f, 1)[0]), true),
    clearQueue: () => (calls.push("clear"), (p.queue = [])),
    leaveAndSave: async () => calls.push("leaveAndSave"),
    getCurrentTime: () => 65_000,
    ...over,
  };
  return p;
}

// 패널에 알린 것
function panel() {
  const seen = [];
  playerEvents.on("refresh", async () => seen.push("refresh"));
  playerEvents.on("ended", async (_p, reason) => seen.push(`ended:${reason}`));
  return seen;
}

test("공통: 플레이어가 없으면 no-player, 권한이 없으면 no-permission(권한 판정의 안내), 운영자는 권한을 건너뛴다", async () => {
  assert.deepEqual(await controls.pause(null, DJ), { ok: false, code: "no-player" });
  assert.deepEqual(await controls.pause(fakePlayer(), OUTSIDER), { ok: false, code: "no-permission", message: S.ERR_VOICE_REQUIRED });
  assert.equal((await controls.pause(fakePlayer(), OWNER)).ok, true);
});

test("멈춤: 곡이 없으면 거절, 있으면 뒤집고 패널에 알린다", async () => {
  const seen = panel();
  assert.equal((await controls.pause(fakePlayer({ currentTrack: null }), DJ)).code, "no-track");

  const playing = fakePlayer();
  assert.deepEqual(await controls.pause(playing, DJ), { ok: true, paused: true, track: playing.currentTrack });
  const paused = fakePlayer({ paused: true });
  assert.equal((await controls.pause(paused, DJ)).paused, false);
  assert.deepEqual([...playing.calls, ...paused.calls], ["pause", "resume"]);
  assert.deepEqual(seen, ["refresh", "refresh"]);

  assert.equal((await controls.pause(fakePlayer({ pause: () => false }), DJ)).code, "failed");
});

test("건너뛰기: 다음 곡이 없으면 거절(한곡 반복은 처음부터라 허용), allowEmpty 면 넘어간다. 곡 요청자는 DJ 가 아니어도 된다", async () => {
  assert.equal((await controls.skip(fakePlayer({ queue: [] }), DJ)).code, "nothing-to-skip");
  assert.equal((await controls.skip(fakePlayer({ queue: [] }), DJ, { allowEmpty: true })).ok, true);

  const looping = fakePlayer({ queue: [], loop: "track" });
  assert.deepEqual(await controls.skip(looping, DJ), { ok: true, track: looping.currentTrack, restarted: true });

  const mine = fakePlayer({ currentTrack: track("내 곡", { requestedBy: { id: "u9" } }) });
  const requester = { member: member({ mod: false, id: "u9" }) };
  assert.equal((await controls.skip(mine, requester)).ok, true);
});

test("정지: 멈추고 레지스트리에서 빼고 끝난 패널로 알린다", async () => {
  const seen = panel();
  const p = fakePlayer();
  const players = new Map([["g1", p]]);
  const r = await controls.stop(p, DJ, players);
  assert.deepEqual(r, { ok: true, track: p.currentTrack, cleared: 2 });
  assert.equal(players.has("g1"), false);
  assert.deepEqual(seen, ["ended:stop"]);
});

test("이전 곡: 기록이 없으면 거절(한곡 반복은 허용), requireTrack 이면 곡이 없을 때 거절", async () => {
  assert.equal((await controls.previous(fakePlayer({ previousTracks: [] }), DJ)).code, "no-previous");
  assert.deepEqual(await controls.previous(fakePlayer({ previousTracks: [], loop: "track" }), DJ), { ok: true, restarted: true });
  assert.equal((await controls.previous(fakePlayer({ currentTrack: null }), DJ)).ok, true);
  assert.equal((await controls.previous(fakePlayer({ currentTrack: null }), DJ, { requireTrack: true })).code, "no-track");
});

test("위치 이동: 라이브는 거절, refuseStarting 이면 여는 중에 거절. 받아들이면 onAccepted 뒤에 옮긴다", async () => {
  assert.equal((await controls.seek(fakePlayer({ isLive: true }), DJ, 1000)).code, "live-no-seek");
  assert.equal((await controls.seek(fakePlayer({ isPlayStarting: true }), DJ, 1000, { refuseStarting: true })).code, "starting");
  assert.equal((await controls.seek(fakePlayer({ isPlayStarting: true }), DJ, 1000)).ok, true);

  const order = [];
  const p = fakePlayer({ seek: async (ms, reason) => order.push(`seek:${ms}:${reason}`) });
  await controls.seek(p, DJ, 30_000, { reason: "dashboard", onAccepted: () => order.push("accepted") });
  assert.deepEqual(order, ["accepted", "seek:30000:dashboard"]);

  const replayed = fakePlayer();
  await controls.replay(replayed, DJ);
  assert.deepEqual(replayed.calls, ["seek:0:replay"]);
});

test("하이라이트: 지점이 없으면 거절, 있으면 그 자리로(원인 highlight)", async () => {
  assert.equal((await controls.highlight(fakePlayer(), DJ)).code, "no-highlight");
  assert.equal((await controls.highlight(fakePlayer({ isLive: true, sponsor: { highlightAt: 3 } }), DJ)).code, "live-no-seek");
  const p = fakePlayer({ sponsor: { highlightAt: 42.5 } });
  assert.equal((await controls.highlight(p, DJ)).ms, 42_500);
  assert.deepEqual(p.calls, ["seek:42500:highlight"]);
});

test("음량: 0 ~ 100 정수만, 전후를 돌려준다", async () => {
  for (const bad of [-1, 101, 5.5, NaN, "50"]) assert.equal((await controls.volume(fakePlayer(), DJ, bad)).code, "bad-volume", String(bad));
  assert.deepEqual(await controls.volume(fakePlayer(), DJ, 80), { ok: true, before: 50, level: 80 });
});

test("반복: 모드 확인, 라이브가 있으면 켜기만 거절. 버튼의 다음 모드는 끔 → 한곡 → 대기열 → 끔", async () => {
  assert.equal((await controls.loop(fakePlayer(), DJ, "all")).code, "bad-loop-mode");
  const live = fakePlayer({ hasLiveTrack: () => true });
  assert.equal((await controls.loop(live, DJ, "track")).code, "live-no-loop");
  assert.equal((await controls.loop(live, DJ, false)).ok, true, "끄는 것은 언제나 통한다");
  assert.deepEqual([false, "off", "track", "queue"].map(controls.nextLoopMode), ["track", "track", "queue", false]);
});

test("섞기 · 비우기: 곡 수가 모자라면 거절", async () => {
  assert.equal((await controls.shuffle(fakePlayer({ queue: [track("a")] }), DJ)).code, "too-few-to-shuffle");
  assert.deepEqual(await controls.shuffle(fakePlayer(), DJ), { ok: true, count: 2 });
  assert.equal((await controls.clear(fakePlayer({ queue: [] }), DJ)).code, "queue-empty");
  assert.equal((await controls.clear(fakePlayer(), DJ)).count, 2);
});

test("빼기: 빈 대기열 · 범위 밖 거절, 권한은 그 곡을 보고(넣은 사람은 DJ 가 아니어도 뺀다)", async () => {
  assert.equal((await controls.remove(fakePlayer({ queue: [] }), DJ, 0)).code, "queue-empty");
  assert.deepEqual(await controls.remove(fakePlayer(), DJ, 5), { ok: false, code: "bad-position", size: 2 });
  const p = fakePlayer({ queue: [track("남의 곡"), track("내 곡", { requestedBy: { id: "u9" } })] });
  const requester = { member: member({ mod: false, id: "u9" }) };
  assert.equal((await controls.remove(p, OUTSIDER, 0)).code, "no-permission");
  assert.equal((await controls.remove(p, requester, 1)).track.title, "내 곡");
});

test("옮기기: 두 곡 미만 · 범위 밖 · 같은 자리 거절(allowSame 이면 통과)", async () => {
  assert.equal((await controls.move(fakePlayer({ queue: [track("a")] }), DJ, 0, 0)).code, "too-few-to-move");
  assert.equal((await controls.move(fakePlayer(), DJ, 0, 2)).code, "bad-position");
  assert.equal((await controls.move(fakePlayer(), DJ, 1, 1)).code, "same-position");
  assert.equal((await controls.move(fakePlayer(), DJ, 1, 1, { allowSame: true })).ok, true);
  const p = fakePlayer();
  assert.equal((await controls.move(p, DJ, 1, 0)).track.title, "b");
  assert.deepEqual(p.calls, ["move:1->0"]);
});

test("점프: 그 곡을 맨 앞으로 옮기고 jump 로 넘긴다. 못 넘기면 되돌린다", async () => {
  const p = fakePlayer();
  assert.equal((await controls.jump(p, DJ, 1)).track.title, "b");
  assert.deepEqual(p.calls, ["move:1->0", "skip:jump"]);

  const stuck = fakePlayer({ skip: () => false });
  assert.equal((await controls.jump(stuck, DJ, 1)).code, "failed");
  assert.deepEqual(
    stuck.queue.map((t) => t.title),
    ["a", "b"],
    "자리를 되돌린다",
  );
  assert.equal((await controls.jump(fakePlayer(), DJ, 9)).code, "bad-position");
});

test("나가기: 권한부터 본다. 플레이어가 있으면 저장하고 빼고 알리고, 없어도 봇이 음성에 있으면 나간다", async () => {
  const players = new Map();
  assert.equal((await controls.leave(guild, OUTSIDER, players)).code, "no-permission");

  const seen = panel();
  const p = fakePlayer();
  players.set("g1", p);
  const r = await controls.leave(guild, DJ, players);
  assert.deepEqual(r, { ok: true, left: "player", track: p.currentTrack, saved: { queue: 2, positionSec: 65 } });
  assert.equal(players.has("g1"), false);
  assert.deepEqual(seen, ["ended:leave"]);

  let disconnected = 0;
  const lingering = { id: "g2", members: { me: { voice: { channel: { id: "vc1" }, disconnect: async () => disconnected++ } } } };
  assert.deepEqual(await controls.leave(lingering, OWNER, players), { ok: true, left: "voice-only" });
  assert.equal(disconnected, 1);
  assert.equal((await controls.leave({ id: "g3", members: { me: {} } }, OWNER, players)).code, "no-player");
});

test("패널을 못 고쳐도 조작은 된 것이다", async () => {
  playerEvents.on("refresh", async () => {
    throw new Error("패널 실패");
  });
  assert.equal((await controls.shuffle(fakePlayer(), DJ)).ok, true);
});

test("문장: 권한은 판정의 안내 그대로, 나머지는 코드별 문장. 대시보드는 ❌ 를 떼고 상태 코드를 붙인다", () => {
  assert.equal(controlMessage({ code: "no-permission", message: S.ERR_NOT_AUTHORIZED }), S.ERR_NOT_AUTHORIZED);
  assert.equal(controlMessage({ code: "bad-position", size: 3 }), "❌ 대기열에 3개의 곡만 있습니다. (1 ~ 3 범위로 입력하세요)");
  assert.equal(controlMessage({ code: "알 수 없음" }), "❌ 작업이 실패했습니다!");
  assert.deepEqual(controlApiError({ code: "no-track" }), { status: 409, error: S.withoutErrorMark(S.ERR_NO_SONG_PLAYING) });
  assert.equal(controlApiError({ code: "no-permission", message: S.ERR_NOT_AUTHORIZED }).status, 403);
  assert.equal(controlApiError({ code: "bad-volume" }).status, 400);
});
