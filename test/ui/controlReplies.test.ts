// src/ui/controlReplies.ts — 조작 결과 화면. 머리 줄 · 본문 · 작은 글씨의 누가 했나 줄, 반복 · 처음부터는 곡에 썸네일이 있으면 머리 옆(일시정지 · 건너뛰기는 붙이지 않는다)

import { test } from "node:test";
import assert from "node:assert/strict";
import * as replies from "../../src/ui/controlReplies.ts";
import { post } from "../../src/ui/frame.ts";
import { separatorsOf, textsOf, thumbnailOf } from "../helpers/cv2.ts";

const by = "<@1>";
const track = { title: "곡", pageUrl: "https://u.test", thumbnail: "https://i.test/t.jpg" };
const shown = (c: ReturnType<typeof replies.cleared>) => textsOf(post(c));
const BY = "-# 👤 요청한 사람 <@1>";

test("일시정지: 누가 했나 줄, 썸네일은 붙이지 않는다. 반복은 곡 썸네일", () => {
  const c = replies.paused(true, track, by);
  assert.deepEqual(shown(c), ["### ⏸️ 일시정지했어요!\n**[곡](https://u.test)**을 일시정지 했어요.", BY]);
  assert.equal(thumbnailOf(post(c)), null);
  assert.equal(thumbnailOf(post(replies.paused(false, track, by))), null);
  assert.equal(thumbnailOf(post(replies.loopSet("track", track, by))), "https://i.test/t.jpg");
});

test("건너뛰기: 건너뛴 곡과 누가 했나, 썸네일은 붙이지 않는다. 한 곡 반복이면 되감았다고", () => {
  const c = replies.skipped(false, track, by);
  assert.deepEqual(shown(c), ["### ⏭️ 곡을 건너뛰었어요!\n**[곡](https://u.test)**을 건너뛰었어요.", BY]);
  assert.equal(thumbnailOf(post(c)), null);
  assert.deepEqual(shown(replies.skipped(true, track, by)), ["### 🔂 곡을 되감았어요!\n한 곡 반복 중이라 지금 곡을 처음부터 다시 틀어요.", BY]);
});

test("이전 곡: 되돌아간 곡. 한 곡 반복이면 되감았다고", () => {
  assert.deepEqual(shown(replies.previous(false, track)), ["### ⏮️ 이전 곡으로 되돌렸어요!\n**[곡](https://u.test)**을 다시 재생할게요."]);
  assert.deepEqual(shown(replies.previous(true, track)), ["### 🔂 곡을 되감았어요!\n한 곡 반복 중이라 지금 곡을 처음부터 다시 틀어요."]);
});

test("정지: 버린 곡이 있을 때만 그 수를 말한다", () => {
  assert.deepEqual(shown(replies.stopped(3, by)), ["### ⏹️ 재생을 중지했어요!\n대기열에 남아있던 3곡을 버리고 채널에서 나갔어요.", BY]);
  assert.deepEqual(shown(replies.stopped(0, by)), ["### ⏹️ 재생을 중지했어요!\n채널에서 나갔어요.", BY]);
});

test("하이라이트 · 위치 이동: 옮긴 위치를 본문에", () => {
  assert.deepEqual(shown(replies.highlighted(83_000)), ["### ✨ 하이라이트로 건너 뛰었어요!\n⏱️ 위치: `1:23`"]);
  assert.deepEqual(shown(replies.seeked(90_000)), ["### ⏩ 위치를 옮겼어요!\n⏱️ 옮긴 위치: `1:30`"]);
});

test("비우기 · 빼기: 곡 수와 누가 했나", () => {
  assert.deepEqual(shown(replies.cleared(3, by)), ["### 🗑️ 대기열을 비웠어요!\n대기열에 있던 3곡을 버렸어요.", BY]);
  assert.deepEqual(shown(replies.removed(4, by)), ["### 🗑️ 선택한 곡을 버렸어요!\n대기열에 4곡이 남았어요.", BY]);
});

test("순서: 옮기기 전 · 뒤 자리와 누가", () => {
  const moved = post(replies.moved(track, 3, 1, by));
  assert.deepEqual(textsOf(moved), ["### 🔀 곡의 순서를 옮겼어요\n**[곡](https://u.test)**\n📍 기존 순번: 3번째\n📍 현재 순번: 1번째", "-# 👤 변경한 사람 <@1>"]);
  assert.equal(separatorsOf(moved), 1, "변경한 사람 줄 위에 구분선");
  assert.equal(separatorsOf(post(replies.removed(4, by))), 0, "다른 응답은 구분선이 없다");
});

test("음량: 바뀌면 이전 → 지금, 같으면 그대로", () => {
  assert.deepEqual(shown(replies.volumeSet(80, 35, by)), ["### 🔊 볼륨을 조절했어요!\n**80%** → **35%**", BY]);
  assert.deepEqual(shown(replies.volumeSet(35, 35, by))[0], "### 🔊 볼륨을 조절했어요!\n볼륨이 이미 35%라서 그대로 둘게요.");
});

test("나가기: 곡이 있었으면 저장한 곡 · 자리 · 대기열과 되살리는 법, 없으면 머리 줄만", () => {
  assert.deepEqual(shown(replies.left({ track, positionSec: 75, queue: 2 }, by)), ["### 👋 음성 채널에서 나갔어요\n재생 중이던 곡: **[곡](https://u.test)**\n⏱️ 저장한 위치 `1:15` · 📋 저장한 대기열 2곡\n`/join`으로 이어 들을 수 있어요.", BY]);
  assert.deepEqual(shown(replies.left(null, by)), ["### 👋 음성 채널에서 나갔어요", BY]);
});

test("들어오기: 들어왔다 · 이미 있다", () => {
  assert.deepEqual([shown(replies.joined()), shown(replies.alreadyJoined())], [["### ✅ 음성 채널에 접속했어요!\n언제든지 곡을 넣어 주세요."], ["### ✅ 이미 음성 채널에 있어요.\n저는 준비됐어요. 언제든지 곡을 넣어 주세요."]]);
});
