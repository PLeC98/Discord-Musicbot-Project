// src/rules/controls.ts — 이전 · 다음 곡 버튼과 넣은 사람의 조작. 서버 판정과 디스코드 패널 · 대시보드가 같이 쓴다

import { test } from "node:test";
import assert from "node:assert/strict";
import { canGoBack, canGoNext, ownTrackDenied } from "../../src/rules/controls.ts";

test("이전 곡: 기록이 있거나 반복 중이면", () => {
  assert.equal(canGoBack({ history: 0, loop: false }), false);
  assert.equal(canGoBack({ history: 1, loop: false }), true);
  assert.equal(canGoBack({ history: 0, loop: "track" }), true);
  assert.equal(canGoBack({ history: 0, loop: "queue" }), true);
});

test("다음 곡: 대기열 · 한 곡 반복 · 자동재생 중 하나면", () => {
  assert.equal(canGoNext({ queue: 0, loop: false, autoplay: false }), false);
  assert.equal(canGoNext({ queue: 0, loop: "queue", autoplay: false }), false, "대기열 반복이라도 대기열이 비면 넘길 곳이 없다");
  assert.equal(canGoNext({ queue: 2, loop: false, autoplay: false }), true);
  assert.equal(canGoNext({ queue: 0, loop: "track", autoplay: false }), true);
  assert.equal(canGoNext({ queue: 0, loop: false, autoplay: "록" }), true, "자동재생은 켠 장르 이름이다");
});

test("넣은 사람의 조작: 조작 권한이 되면 통과, 넣은 사람이면 재적 규칙의 까닭, 아니면 조작 권한의 까닭", () => {
  const voiceOk = () => null;
  const voiceBad = () => "must-be-in-same-voice";
  assert.equal(ownTrackDenied({ control: null, requester: false, voice: voiceBad }), null);
  assert.equal(ownTrackDenied({ control: "must-dj", requester: true, voice: voiceOk }), null);
  assert.equal(ownTrackDenied({ control: "must-dj", requester: true, voice: voiceBad }), "must-be-in-same-voice");
  assert.equal(ownTrackDenied({ control: "must-dj", requester: false, voice: voiceOk }), "must-dj");
});
