// src/ui/controlReplies.ts — 조작 결과 화면. 머리 줄 · 본문 · 작은 글씨 줄(누가 했나와 칸들), 곡에 썸네일이 있으면 머리 옆

import { test } from "node:test";
import assert from "node:assert/strict";
import * as replies from "../../src/ui/controlReplies.ts";
import { post } from "../../src/ui/frame.ts";
import { textsOf, thumbnailOf } from "../helpers/cv2.ts";

const by = "<@1>";
const track = { title: "곡", pageUrl: "https://u.test", thumbnail: "https://i.test/t.jpg" };
const shown = (c: ReturnType<typeof replies.cleared>) => textsOf(post(c));

test("비우기: 남겨 둔 지금 곡이 있으면 작은 글씨로", () => {
  assert.deepEqual(shown(replies.cleared(3, track, by)), ["### 🗑️ 대기열 비워짐\n대기열에서 3개의 노래가 제거되었습니다", "-# 👤 변경한 사람 <@1>\n-# 🎵 현재 재생 중 **[곡](https://u.test)**"]);
  assert.deepEqual(shown(replies.cleared(3, null, by)), ["### 🗑️ 대기열 비워짐\n대기열에서 3개의 노래가 제거되었습니다", "-# 👤 변경한 사람 <@1>"]);
});

test("빼기: 뺀 곡 · 남은 곡 수, 썸네일", () => {
  const c = replies.removed(track, 4, by);
  assert.deepEqual(shown(c), ["### 🗑️ 곡 제거됨\n**[곡](https://u.test)**", "-# 👤 제거한 사람 <@1>\n-# 📋 남은 대기열 4곡"]);
  assert.equal(thumbnailOf(post(c)), "https://i.test/t.jpg");
});

test("순서: 옮기기 전 · 뒤 자리와 누가", () => {
  assert.deepEqual(shown(replies.moved(track, 3, 1, by)), ["### 🔀 순서 변경됨\n**[곡](https://u.test)**", "-# 📍 이동 전 3번째\n-# 📍 이동 후 1번째\n-# 👤 변경한 사람 <@1>"]);
});

test("음량: 바뀌면 이전 → 지금, 같으면 그대로", () => {
  assert.deepEqual(shown(replies.volumeSet(80, 35, by)), ["### 🔊 볼륨이 변경되었습니다\n**80%** → **35%**", "-# 👤 변경한 사람 <@1>"]);
  assert.deepEqual(shown(replies.volumeSet(35, 35, by))[0], "### 🔊 볼륨이 변경되었습니다\n볼륨은 그대로 **35%**입니다.");
});

test("나가기: 곡이 있었으면 저장한 자리 · 대기열, 끝에 되살리는 법", () => {
  assert.deepEqual(shown(replies.left({ track, positionSec: 75, queue: 2 }, by)), ["### 👋 채널에서 나갔습니다\n**[곡](https://u.test)**", "-# 👤 실행한 사람 <@1>\n-# ⏱️ 저장된 위치 `1:15`\n-# 📋 저장된 대기열 2곡\n-# /join 으로 이전 세션을 복구할 수 있습니다."]);
  assert.deepEqual(shown(replies.left(null, by)), ["### 👋 채널에서 나갔습니다", "-# 👤 실행한 사람 <@1>\n-# /join 으로 이전 세션을 복구할 수 있습니다."]);
  assert.deepEqual(shown(replies.leftVoiceOnly()), ["👋 음성 채널에서 나갔습니다!"]);
});

test("들어오기: 들어왔다 · 이미 있다", () => {
  assert.deepEqual([shown(replies.joined()), shown(replies.alreadyJoined())], [["✅ 음성 채널에 접속했어요!"], ["✅ 이미 채널에 접속해 있어요."]]);
});
