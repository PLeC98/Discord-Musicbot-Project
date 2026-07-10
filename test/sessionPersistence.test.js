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
