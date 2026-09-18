"use strict";

// src/QueueWarmer.js — 대기열 앞부분을 캐시에 올린 상태로 유지하는 계약
//
// 핵심은 "언제 움직이지 않는가"다. 조작이 진행 중일 때 받기 시작하면 곧 쓸모없어질 곡을
// 계속 받게 되고(곡당 2~5초라 틱 하나로 끝나지도 않는다), 그게 이 모듈을 만든 이유의 절반이다.
//
// 협력자는 전부 주입 — 실 파일·네트워크 없이 판정만 검증한다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const QueueWarmer = require("../src/QueueWarmer");

const track = (id, extra = {}) => ({ title: id, url: `https://y/${id}`, audioSourceKey: `yt:${id}`, ...extra });

function makeWarmer({ queue = [], currentTrack = null, loop = false, cached = new Set(), busy = new Set(), fail = new Set(), guildId = "g1" } = {}) {
  const warmed = [];
  const protection = [];
  const player = { queue, currentTrack, loop, guild: { id: guildId } };

  const warmer = new QueueWarmer(player, {
    ahead: 5,
    gapMs: 0,
    intervalMs: 1000,
    keyOf: (t) => t?.audioSourceKey || null,
    isCached: (t) => cached.has(t.audioSourceKey),
    isBusy: (t) => busy.has(t.audioSourceKey),
    warm: async (t) => {
      warmed.push(t.audioSourceKey);
      if (fail.has(t.audioSourceKey)) throw new Error("boom");
      cached.add(t.audioSourceKey);
    },
    setProtection: (gid, keys) => protection.push({ gid, keys: [...keys] }),
  });

  return { warmer, player, warmed, protection, cached, busy };
}

// 틱은 비동기 루프를 깨울 뿐이므로, 루프가 끝날 때까지 마이크로태스크를 흘려보낸다.
const settle = async (n = 50) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

// ── 정숙 조건 ────────────────────────────────────────────────

test("서명이 매 틱 바뀌는 동안에는 한 곡도 시작하지 않는다", async () => {
  const { warmer, player, warmed } = makeWarmer({ queue: [track("a"), track("b")] });

  for (let i = 0; i < 5; i++) {
    player.queue.unshift(track(`x${i}`)); // 셔플/추가 연타를 흉내낸다
    warmer.tick();
    await settle();
  }

  assert.deepEqual(warmed, [], "조작이 멎기 전에는 아무것도 받지 않는다");
});

test("조작이 멎으면 다음 틱에 움직인다 (연속 두 틱 동일)", async () => {
  const { warmer, warmed } = makeWarmer({ queue: [track("a"), track("b")] });

  warmer.tick(); // 첫 관측 — 비교 대상이 없으므로 아직 움직이지 않는다
  await settle();
  assert.deepEqual(warmed, []);

  warmer.tick(); // 두 번째로 같은 서명 → 실행
  await settle();
  assert.deepEqual(warmed, ["yt:a", "yt:b"]);
});

test("같은 서명으로는 두 번 돌지 않는다", async () => {
  const { warmer, warmed } = makeWarmer({ queue: [track("a")] });

  for (let i = 0; i < 4; i++) {
    warmer.tick();
    await settle();
  }
  assert.deepEqual(warmed, ["yt:a"], "이미 반영한 서명은 다시 실행하지 않는다");
});

// ── 목표 선정 ────────────────────────────────────────────────

test("앞 N곡만 받는다", async () => {
  const queue = ["a", "b", "c", "d", "e", "f", "g"].map((id) => track(id));
  const { warmer, warmed } = makeWarmer({ queue });

  warmer.tick();
  warmer.tick();
  await settle();

  assert.deepEqual(warmed, ["yt:a", "yt:b", "yt:c", "yt:d", "yt:e"], "6번째부터는 대상이 아니다");
});

test("이미 캐시됐거나 받는 중인 곡은 건너뛴다", async () => {
  const { warmer, warmed } = makeWarmer({
    queue: [track("a"), track("b"), track("c")],
    cached: new Set(["yt:a"]),
    busy: new Set(["yt:b"]),
  });

  warmer.tick();
  warmer.tick();
  await settle();

  assert.deepEqual(warmed, ["yt:c"]);
});

test("라이브 스트림은 대상이 아니다 (끝이 없어 캐시할 수 없다)", async () => {
  const { warmer, warmed } = makeWarmer({ queue: [track("live", { isLive: true }), track("b")] });

  warmer.tick();
  warmer.tick();
  await settle();

  assert.deepEqual(warmed, ["yt:b"]);
});

test("한곡 반복 중에는 예열하지 않는다 (다음 곡이 현재 곡이다)", async () => {
  const { warmer, warmed } = makeWarmer({ queue: [track("a"), track("b")], loop: "track" });

  warmer.tick();
  warmer.tick();
  await settle();

  assert.deepEqual(warmed, []);
});

test("현재 곡은 대상이 아니다 (재생 경로가 이미 받고 있다)", async () => {
  const { warmer, warmed } = makeWarmer({ currentTrack: track("now"), queue: [track("a")] });

  warmer.tick();
  warmer.tick();
  await settle();

  assert.deepEqual(warmed, ["yt:a"]);
});

// ── 루프 도중의 변화 ─────────────────────────────────────────

test("루프 도중 대기열이 바뀌면 멈추고, 다음 안정된 틱이 새 목표를 따른다", async () => {
  // 한 곡씩 세워 가며 본다 — gapMs=0이면 루프가 마이크로태스크만으로 끝까지 달려
  // "도중"이라는 시점 자체가 없어진다.
  const queue = [track("a"), track("b"), track("c")];
  const cached = new Set();
  const warmed = [];
  let release;

  const player = { queue, currentTrack: null, loop: false, guild: { id: "g1" } };
  const warmer = new QueueWarmer(player, {
    ahead: 5,
    gapMs: 0,
    intervalMs: 1000,
    keyOf: (t) => t?.audioSourceKey || null,
    isCached: (t) => cached.has(t.audioSourceKey),
    isBusy: () => false,
    warm: (t) => {
      warmed.push(t.audioSourceKey);
      return new Promise((resolve) => {
        release = () => {
          cached.add(t.audioSourceKey);
          resolve();
        };
      });
    },
    setProtection: () => {},
  });

  warmer.tick();
  warmer.tick(); // a를 시작하고 멈춰 선다
  await settle();
  assert.deepEqual(warmed, ["yt:a"], "첫 곡에서 대기 중");

  queue.length = 0;
  queue.push(track("z")); // 셔플로 앞부분이 통째로 바뀜
  release();
  await settle();

  assert.deepEqual(warmed, ["yt:a"], "흔들린 뒤에는 옛 목표(b, c)로 넘어가지 않는다");

  warmer.tick();
  warmer.tick();
  await settle();
  assert.deepEqual(warmed, ["yt:a", "yt:z"], "안정되면 새 목표를 받는다");
});

test("실패한 곡을 무한히 재시도하지 않는다", async () => {
  const { warmer, warmed } = makeWarmer({ queue: [track("bad"), track("ok")], fail: new Set(["yt:bad"]) });

  warmer.tick();
  warmer.tick();
  await settle(200);

  assert.equal(warmed.filter((k) => k === "yt:bad").length, 1, "이번 서명에서는 한 번만 시도한다");
  assert.ok(warmed.includes("yt:ok"), "실패가 나머지를 막지 않는다");
});

test("대기열이 움직이면 실패 기록을 버리고 다시 시도한다", async () => {
  const queue = [track("bad")];
  const { warmer, warmed } = makeWarmer({ queue, fail: new Set(["yt:bad"]) });

  warmer.tick();
  warmer.tick();
  await settle();
  assert.equal(warmed.length, 1);

  queue.unshift(track("new"));
  warmer.tick();
  warmer.tick();
  await settle();

  assert.equal(warmed.filter((k) => k === "yt:bad").length, 2, "서명이 바뀌었으므로 재시도한다");
});

// ── 퇴거 보호 ────────────────────────────────────────────────

test("보호 집합을 통째로 교체한다 — 큐에서 빠진 키는 사라진다", async () => {
  const queue = [track("a"), track("b")];
  const { warmer, protection } = makeWarmer({ queue });

  warmer.tick();
  warmer.tick();
  await settle();
  assert.deepEqual(protection.at(-1).keys, ["yt:a", "yt:b"]);

  queue.shift(); // a 제거
  warmer.tick();
  warmer.tick();
  await settle();

  assert.deepEqual(protection.at(-1).keys, ["yt:b"], "해제를 따로 부르지 않아도 빠진다");
});

test("아직 캐시되지 않은 키도 보호한다 (예열이 끝나기 전에 퇴거가 돌 수 있다)", async () => {
  const { warmer, protection } = makeWarmer({ queue: [track("a")] });

  warmer.tick();
  warmer.tick();
  await settle();

  assert.deepEqual(protection.at(-1).keys, ["yt:a"]);
});

test("키가 없는 트랙은 보호에서 빠진다 (미해석 스포티파이 — 보호할 파일이 없다)", async () => {
  const spotify = { title: "s", url: "https://open.spotify.com/track/x", audioSourceKey: null };
  const { warmer, protection } = makeWarmer({ queue: [spotify, track("b")] });

  warmer.tick();
  warmer.tick();
  await settle();

  assert.deepEqual(protection.at(-1).keys, ["yt:b"]);
});

test("stop()은 보호를 비우고 더 이상 움직이지 않는다", async () => {
  const { warmer, warmed, protection } = makeWarmer({ queue: [track("a")] });

  warmer.tick();
  warmer.stop();
  assert.deepEqual(protection.at(-1).keys, []);

  warmer.tick();
  warmer.tick();
  await settle();
  assert.deepEqual(warmed, [], "정지 후에는 틱이 들어와도 받지 않는다");
});

// ── 서명 ─────────────────────────────────────────────────────

test("순서만 바뀌어도 서명이 달라진다", () => {
  const a = track("a");
  const b = track("b");
  const { warmer, player } = makeWarmer({ queue: [a, b] });

  const before = warmer.signature();
  player.queue = [b, a];
  assert.notEqual(warmer.signature(), before, "같은 곡 집합이라도 순서가 다르면 다른 서명");
});

test("대기열이 같아도 현재 곡이 바뀌면 서명이 달라진다 (이전곡 경로)", () => {
  const { warmer, player } = makeWarmer({ currentTrack: track("now"), queue: [track("a")] });

  const before = warmer.signature();
  player.currentTrack = track("other");
  assert.notEqual(warmer.signature(), before);
});

// ── 늦게 정해지는 캐시 키 (스포티파이) ───────────────────────
// 실사용 회귀: 스포티파이 재생목록에서 2번째 곡부터 전부 두 번씩 받았다.
// 키가 곧 파일 경로인데 그 키가 다운로드 '안'에서 정해져, 첫 번째는 URL 해시 경로로 저장되고
// 키가 생긴 다음 틱에는 키 경로가 비어 있어 또 받았다.

test("키가 늦게 정해져도 지문은 흔들리지 않는다", () => {
  const spotify = { title: "s", url: "https://open.spotify.com/track/x", audioSourceKey: null };
  const { warmer } = makeWarmer({ queue: [spotify] });

  const before = warmer.signature();
  spotify.audioSourceKey = "yt:resolved"; // 받는 도중에 동등물이 정해졌다
  assert.equal(warmer.signature(), before, "대기열은 그대로이므로 지문도 그대로여야 한다");
});

test("키가 정해지면 다음 틱에 다시 받지 않는다", async () => {
  const spotify = { title: "s", url: "https://open.spotify.com/track/x", audioSourceKey: null };
  const cached = new Set();
  const warmed = [];

  const player = { queue: [spotify], currentTrack: null, loop: false, guild: { id: "g1" } };
  const warmer = new QueueWarmer(player, {
    ahead: 5,
    gapMs: 0,
    intervalMs: 1000,
    keyOf: (t) => t?.audioSourceKey || null,
    // 파일 경로는 키에서 나온다 — 키가 없으면 URL 해시로 갈라진다(실제 trackFilePath와 같은 규칙)
    isCached: (t) => cached.has(t.audioSourceKey || t.url),
    isBusy: () => false,
    warm: async (t) => {
      warmed.push(t.url);
      t.audioSourceKey = "yt:resolved"; // warm이 받기 전에 키를 확정한다
      cached.add(t.audioSourceKey);
    },
    setProtection: () => {},
  });

  warmer.tick();
  warmer.tick();
  await settle();

  warmer.tick();
  warmer.tick();
  await settle();

  assert.deepEqual(warmed, ["https://open.spotify.com/track/x"], "두 번 받지 않는다");
});

// ── 내려간 영상을 고른 자동재생 곡 ────────────────────────────────────────

// 회귀 대상: 자동재생이 이미 내려간 영상을 고르면 예열이 실패하고, 그 곡이 대기열에 남아
// 재생 차례에 스트림도 실패한다. 대기열이 비어 버려 봇이 그대로 멈췄다.
// 우리가 고른 곡이니 사용자에게 알릴 일이 아니라, 조용히 빼고 다른 곡을 고른다.
test("영상이 내려간 자동재생 곡은 대기열에서 빼고 다시 고른다", async () => {
  const gone = track("dead", { autoplay: true, youtubeUrl: "https://www.youtube.com/watch?v=BYlcTa9SQXs" });
  const { warmer, player } = makeWarmer({ queue: [gone, track("ok")] });

  let refilled = 0;
  player.ensureAutoplayNext = async () => refilled++;

  // yt-dlp가 내는 것과 같은 모양의 오류
  warmer.warm = async () => {
    throw new Error("ERROR: [youtube] BYlcTa9SQXs: Video unavailable");
  };

  warmer.tick(); // 첫 관측
  await settle();
  warmer.tick(); // 서명이 같아야 움직인다
  await settle();

  assert.equal(player.queue.includes(gone), false, "대기열에 남아 있으면 재생 차례에 또 실패한다");
  assert.equal(refilled, 1, "뺀 자리를 메워야 한다");
  assert.equal(require("../src/autoplayRoute")._dead.has("BYlcTa9SQXs"), true, "다음 뽑기에서 또 고르면 안 된다");
});

test("사용자가 넣은 곡은 빼지 않는다 — 없어졌다는 것을 알아야 한다", async () => {
  const mine = track("mine", { youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa" });
  const { warmer, player } = makeWarmer({ queue: [mine] });
  warmer.warm = async () => {
    throw new Error("ERROR: [youtube] aaaaaaaaaaa: Video unavailable");
  };

  warmer.tick();
  await settle();
  warmer.tick();
  await settle();

  assert.equal(player.queue.includes(mine), true);
});
