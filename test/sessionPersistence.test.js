"use strict";

// src/SessionPersistence.js — 트랙 직렬화/복원 (세션 저장·/join 복구의 기반)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const SessionPersistence = require("../src/SessionPersistence");

function makeSP(memberCache = new Map()) {
  return new SessionPersistence({ guild: { members: { cache: memberCache } } });
}

const FULL_TRACK = {
  id: "vid1",
  title: "노래 제목",
  url: "https://youtube.com/watch?v=vid1",
  duration: 185,
  thumbnail: "https://img/1.jpg",
  artist: "가수",
  album: "앨범",
  platform: "youtube",
  uploader: "채널",
  youtubeUrl: "https://youtube.com/watch?v=vid1",
  isLive: false,
  addedAt: 1720000000000,
  requestedBy: { id: "u1", tag: "user#1" },
};

test("serializeTrack: null → null", () => {
  assert.equal(makeSP().serializeTrack(null), null);
  assert.equal(makeSP().deserializeTrack(null), null);
});

test("직렬화 → 복원 라운드트립: 필드 보존", () => {
  const sp = makeSP();
  const restored = sp.deserializeTrack(sp.serializeTrack(FULL_TRACK));

  for (const key of ["id", "title", "url", "duration", "thumbnail", "artist", "album", "platform", "uploader", "youtubeUrl", "addedAt"]) {
    assert.deepEqual(restored[key], FULL_TRACK[key], key);
  }
  assert.equal(restored.isLive, false);
});

test("요청자: 직렬화 시 id/tag 추출, 복원 시 폴백 객체 생성", () => {
  const sp = makeSP();
  const data = sp.serializeTrack(FULL_TRACK);
  assert.equal(data.requesterId, "u1");
  assert.equal(data.requesterTag, "user#1");

  const restored = sp.deserializeTrack(data);
  assert.deepEqual(restored.requestedBy, { id: "u1", tag: "user#1" }, "캐시 미스 시 {id,tag} 폴백");
});

test("요청자: 길드 멤버 캐시에 있으면 실제 멤버 객체로 복원", () => {
  const cachedMember = { id: "u1", tag: "user#1", displayName: "유저" };
  const sp = makeSP(new Map([["u1", cachedMember]]));
  const restored = sp.deserializeTrack(sp.serializeTrack(FULL_TRACK));
  assert.equal(restored.requestedBy, cachedMember);
});

test("duration: 문자열은 숫자로 정규화", () => {
  const sp = makeSP();
  const data = sp.serializeTrack({ ...FULL_TRACK, duration: "185" });
  assert.equal(data.duration, 185);
});

test("isLive: track.live 별칭도 인식, 복원 시 불리언 강제", () => {
  const sp = makeSP();
  const data = sp.serializeTrack({ ...FULL_TRACK, isLive: undefined, live: 1 });
  const restored = sp.deserializeTrack(data);
  assert.equal(restored.isLive, true);
});

test("요청자 없는 트랙: requesterId null, 복원 후 requestedBy 없음", () => {
  const sp = makeSP();
  const { requestedBy, ...anonymous } = FULL_TRACK;
  const data = sp.serializeTrack(anonymous);
  assert.equal(data.requesterId, null);
  const restored = sp.deserializeTrack(data);
  assert.equal(restored.requestedBy, undefined);
});

// 복원 시 일시정지 유지

function makeRestorePlayer() {
  return {
    guild: { id: "g1", members: { cache: new Map() } },
    pauseReasons: new Set(),
    preloadedStreams: new Map(),
    preloadingQueue: [],
    queue: [],
    previousTracks: [],
    downloadedFiles: new Set(),
    currentDownloadedFile: null,
    volume: 100,
    connection: { state: {} }, // 연결 재수립 경로 생략
    textChannel: null,
    paused: false,
    calls: [],
    async play(_, ms) {
      // play()는 시작 직후 pauseReasons를 보고 즉시 일시정지 — 그 시점의 사유 유무를 기록
      this.calls.push(["play", ms, this.pauseReasons.has("manual")]);
    },
    pauseFor(reason) {
      this.pauseReasons.add(reason);
      this.paused = true;
      this.calls.push(["pauseFor", reason]);
    },
  };
}

function makeState(overrides = {}) {
  return {
    guildId: "g1",
    currentTrack: { title: "곡", url: "https://y/1", duration: 100 },
    queue: [],
    volume: 80,
    playbackPositionMs: 30000,
    paused: false,
    pauseReasons: [],
    ...overrides,
  };
}

async function restore(state) {
  const player = makeRestorePlayer();
  const sp = new SessionPersistence(player);
  await sp.restoreFromState(state);
  sp.cancelStateSave(); // scheduleStatePersist("restored") 타이머 정리
  return player;
}

test("복원: 수동 일시정지 세션은 멈춘 상태로 (L-01 회귀 — 구 코드는 무조건 자동 재생)", async () => {
  const player = await restore(makeState({ paused: true, pauseReasons: ["manual"] }));
  assert.deepEqual(player.calls[0], ["play", 30000, true], "play 시작 시점에 이미 manual 사유가 걸려 즉시 일시정지");
  assert.equal(player.paused, true, "paused 플래그 동기화");
  assert.ok(player.pauseReasons.has("manual"));
});

test("복원: 상황성 사유(alone/mute)만이면 재적용하지 않음 — 복원 시점 상황은 다를 수 있음", async () => {
  const player = await restore(makeState({ paused: true, pauseReasons: ["alone"] }));
  assert.equal(player.paused, false);
  assert.equal(player.pauseReasons.size, 0);
});

test("복원: 사유 없는 paused(레거시 세션)는 수동으로 간주", async () => {
  const player = await restore(makeState({ paused: true, pauseReasons: [] }));
  assert.equal(player.paused, true);
});

test("복원: 재생 중이던 세션은 그대로 재생", async () => {
  const player = await restore(makeState());
  assert.deepEqual(player.calls, [["play", 30000, false]]);
  assert.equal(player.paused, false);
});
