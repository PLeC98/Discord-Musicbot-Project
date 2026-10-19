// src/rules/track-tags.ts — 파일 태그를 곡 정보로 쓰는 곡과 바뀌는 필드

import { test } from "node:test";
import assert from "node:assert/strict";
import { takesTags, tagPatch } from "../../src/rules/track-tags.ts";

const FILE = "https://files.test/a.mp3";
const direct = { title: "a", requestKey: FILE, audioUrl: FILE };
const TAGS = { title: "태그 제목", artist: "태그 가수", album: "태그 앨범" };

test("쓰는 곡: 요청한 링크가 곧 음원인 직접 링크 곡(새로 담은 곡 · 캐시 히트 · 세션 복원). 직접 지정한 음원 · 다른 음원으로 이은 곡은 아니다", () => {
  assert.equal(takesTags(direct), true, "새로 담은 곡(audioFoundBy 없음)");
  assert.equal(takesTags({ ...direct, audioFoundBy: "given" }), true, "캐시 히트");
  assert.equal(takesTags({ ...direct, audioFoundBy: "pinned" }), false, "직접 지정한 음원");
  assert.equal(takesTags({ title: "곡", requestKey: "https://www.youtube.com/watch?v=aaaaaaaaaaa", audioUrl: FILE }), false, "유튜브 요청에 직접 링크 음원(지정 · 링크 데이터)");
  assert.equal(takesTags({ title: "곡", requestKey: FILE, audioUrl: "https://files.test/b.mp3", audioFoundBy: "ledger" }), false, "다른 음원으로 이었다");
  assert.equal(takesTags({ title: "곡", requestKey: "https://www.youtube.com/watch?v=aaaaaaaaaaa", audioUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }), false, "유튜브");
  assert.equal(takesTags({ title: "곡", requestKey: FILE }), false, "음원 주소가 없다");
});

test("바뀌는 필드: 제목은 태그에 있으면 바꾸고, 가수 · 앨범은 비었을 때만. 같거나 빈 태그는 바꾸지 않는다", () => {
  assert.deepEqual(tagPatch(direct, TAGS), { title: "태그 제목", artist: "태그 가수", album: "태그 앨범" });
  assert.deepEqual(tagPatch({ ...direct, artist: "있던 가수", album: "있던 앨범" }, TAGS), { title: "태그 제목" });
  assert.deepEqual(tagPatch({ ...direct, title: "태그 제목" }, { title: "태그 제목", artist: null, album: null }), {});
  assert.deepEqual(tagPatch(direct, { title: null, artist: null, album: null }), {});
  assert.deepEqual(tagPatch({ ...direct, audioFoundBy: "pinned" }, TAGS), {}, "쓰지 않는 곡");
});
