"use strict";

// 자동재생 미리 뽑기(B-50) — src/MusicPlayer.js · src/trackState.js
//
// 곡이 끝난 뒤에야 검색을 시작하면 그만큼 소리가 빈다. 곡이 시작될 때 다음 곡을 미리 대기열에 둬야
// QueueWarmer가 평소처럼 받아 두고 전환이 즉시가 된다.
//
// play()가 이것을 await 하지 않고 부르므로(재생 시작을 늦추면 안 된다), 고르는 동안 대기열이
// 변할 수 있다. 그 사이 사용자가 곡을 넣었으면 미리 뽑기는 취소해야 하고, 겹쳐 불려도 한 곡만 들어가야 한다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const MusicPlayer = require("../src/MusicPlayer");
const trackState = require("../src/trackState");

const ensureAutoplayNext = MusicPlayer.prototype.ensureAutoplayNext;
const setAutoplay = MusicPlayer.prototype.setAutoplay;

const user = (title) => ({ title, url: `https://y/${title}` });
const auto = (title) => ({ title, url: `https://y/${title}`, autoplay: true });
const titles = (arr) => arr.map((t) => t.title);

function makePlayer({ autoplay = "pop", current = user("현재곡"), queue = [], loop = false, pick } = {}) {
  const calls = { picks: 0 };
  return {
    calls,
    autoplay,
    loop,
    queue,
    currentTrack: current,
    previousTracks: [],
    guild: { id: "g1" },
    scheduleStatePersist() {},
    // 프로토타입을 잇지 않는 목이므로, 코드가 부르는 헬퍼는 여기 옮겨 붙인다
    _canPrefetchAutoplay: MusicPlayer.prototype._canPrefetchAutoplay,
    async pickAutoplayTrack() {
      calls.picks++;
      return pick ? await pick.call(this) : auto(`자동${calls.picks}`);
    },
  };
}

// ── trackState: 자동재생 곡의 자리 ────────────────────────────────────────

test("사용자 곡은 미리 뽑아 둔 자동재생 곡 앞에 선다", () => {
  const p = { queue: [user("내곡1"), auto("자동")] };
  trackState.enqueueAheadOfAutoplay(p, [user("내곡2")]);
  assert.deepEqual(titles(p.queue), ["내곡1", "내곡2", "자동"]);
});

test("자동재생 곡이 없으면 평소대로 뒤에 붙인다", () => {
  const p = { queue: [user("내곡1")] };
  trackState.enqueueAheadOfAutoplay(p, [user("내곡2")]);
  assert.deepEqual(titles(p.queue), ["내곡1", "내곡2"]);
});

test("정리는 자동재생 곡만 — 사용자 곡은 남는다", () => {
  const p = { queue: [auto("자동1"), user("내곡"), auto("자동2")] };
  assert.equal(trackState.dropAutoplay(p), 2);
  assert.deepEqual(titles(p.queue), ["내곡"]);
});

// ── 미리 뽑기 조건 ────────────────────────────────────────────────────────

test("곡이 돌고 대기열이 비어 있으면 한 곡을 미리 넣는다", async () => {
  const p = makePlayer();
  assert.equal(await ensureAutoplayNext.call(p), true);
  assert.deepEqual(titles(p.queue), ["자동1"]);
  assert.equal(p.queue[0].autoplay, true, "표시가 붙어야 대기열 표시·정리에서 가른다");
});

test("미리 뽑지 않는 경우: 대기열이 차 있음 · 현재곡 없음 · 한곡 반복 · 자동재생 꺼짐", async () => {
  const cases = [makePlayer({ queue: [user("대기중")] }), makePlayer({ current: null }), makePlayer({ loop: "track" }), makePlayer({ autoplay: false })];

  for (const p of cases) {
    assert.equal(await ensureAutoplayNext.call(p), false);
    assert.equal(p.calls.picks, 0, "조건을 먼저 보고 검색을 아끼다");
  }
});

// ── 고르는 동안 대기열이 변하는 경우 ──────────────────────────────────────

test("고르는 사이 사용자가 곡을 넣으면 미리 뽑기를 취소한다", async () => {
  const p = makePlayer({
    async pick() {
      this.queue.push(user("방금 넣은 곡")); // 검색이 도는 동안 벌어지는 일
      return auto("늦게 도착");
    },
  });

  assert.equal(await ensureAutoplayNext.call(p), false);
  assert.deepEqual(titles(p.queue), ["방금 넣은 곡"], "사용자 곡을 밀어내지 않는다");
});

test("겹쳐 불려도 한 곡만 들어간다", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const p = makePlayer({
    async pick() {
      await gate;
      return auto("자동");
    },
  });

  const first = ensureAutoplayNext.call(p);
  const second = ensureAutoplayNext.call(p); // play()가 연달아 부르는 상황
  release();

  assert.deepEqual(await Promise.all([first, second]), [true, false]);
  assert.equal(p.calls.picks, 1);
  assert.deepEqual(titles(p.queue), ["자동"]);
});

// ── 끄기·장르 변경 ────────────────────────────────────────────────────────

test("자동재생을 끄면 미리 뽑아 둔 곡만 빠진다", () => {
  const p = makePlayer({ queue: [user("내곡"), auto("자동")] });
  p.ensureAutoplayNext = async () => true;

  setAutoplay.call(p, false);

  assert.equal(p.autoplay, false);
  assert.deepEqual(titles(p.queue), ["내곡"]);
});

test("장르를 바꾸면 이전 장르로 뽑아 둔 곡을 버리고 다시 뽑는다", () => {
  const p = makePlayer({ autoplay: "pop", queue: [auto("팝곡")] });
  let refetched = 0;
  p.ensureAutoplayNext = async () => {
    refetched++;
    return true;
  };

  setAutoplay.call(p, "jazz");

  assert.equal(p.autoplay, "jazz");
  assert.deepEqual(titles(p.queue), []);
  assert.equal(refetched, 1);
});
