// src/ui/queue-display.ts — 대기열을 보여 주는 곳들의 공통 생김새.
//
// `/queue`와 대기열 버튼이 거의 같은 임베드를 각자 만들고 있었다(한쪽만 고치면 표시가 달라진다).
// 줄 만드는 일을 이 모듈로 모았으므로, 규칙은 여기서 잠근다.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { queueLine, jumpDescription } from "../../src/ui/queue-display.ts";
import { useUploaded } from "../../src/ui/icons.ts";
import type { QueuedTrack } from "../../src/player/track.ts";

afterEach(() => useUploaded(new Map()));

const song = (over: Partial<QueuedTrack> = {}): QueuedTrack => ({ title: "곡", pageUrl: "https://y/1", requestKey: "https://y/1", platform: "youtube", artist: "가수", duration: 100, ...over });

test("대기열 줄: 요청자는 멘션으로", () => {
  const line = queueLine(song({ requestedBy: { id: "u1" } }), 3);
  assert.equal(line, "`3.` **[곡](https://y/1)** | <@u1>\n");
});

test("대기열 줄: 자동재생 곡은 자동재생 아이콘으로 — 장르 이모지를 쓰지 않는다. 앱 이모지를 맞추면 그것", () => {
  const line = () => queueLine(song({ autoplay: true, requestedBy: { id: "bot" } }), 1);
  assert.equal(line(), "`1.` **[곡](https://y/1)** | 🎲\n");
  useUploaded(new Map([["autoplay", { id: "7", animated: false }]]));
  assert.equal(line(), "`1.` **[곡](https://y/1)** | <:autoplay:7>\n");
});

test("대기열 줄: 요청자를 모르면 제목만", () => {
  assert.equal(queueLine(song(), 2), "`2.` **[곡](https://y/1)**\n");
});

test("대기열 줄: 제목이 없으면 알 수 없는 곡", () => {
  assert.equal(queueLine(song({ title: null }), 2), "`2.` **[알 수 없는 곡](https://y/1)**\n");
});

// 셀렉트 메뉴 설명은 멘션 · 앱 이모지를 렌더링하지 않는다(글자 그대로 보인다) — 이름과 유니코드를 쓴다.
test("점프 설명: 아티스트 | 길이 | 요청자 이름. 자동재생 곡은 앱 이모지를 맞춰도 유니코드", () => {
  assert.equal(jumpDescription(song({ requestedBy: { id: "u1", username: "PLeC" } })), "가수 | 1:40 | PLeC");
  useUploaded(new Map([["autoplay", { id: "7", animated: false }]]));
  assert.equal(jumpDescription(song({ autoplay: true })), "가수 | 1:40 | 🎲");
});

test("점프 설명: 라이브는 길이 위치에 🔴LIVE", () => {
  assert.equal(jumpDescription(song({ isLive: true, duration: 0, requestedBy: { id: "u1", username: "PLeC" } })), "가수 | 🔴LIVE | PLeC");
  assert.equal(jumpDescription(song({ artist: undefined, isLive: true, duration: 0 })), "🔴LIVE");
});

// 복원된 곡은 세션에 id만 남아 이름을 모른다 — 멘션을 원본 그대로 보이느니 적지 않는다.
test("점프 설명: 이름을 모르면 요청자를 적지 않는다", () => {
  assert.equal(jumpDescription(song({ requestedBy: { id: "u1" } })), "가수 | 1:40");
});

test("점프 설명: 아티스트가 없으면 나머지만, 아무것도 없으면 undefined", () => {
  assert.equal(jumpDescription(song({ artist: undefined, autoplay: true })), "1:40 | 🎲");
  assert.equal(jumpDescription(song({ artist: undefined, duration: 0 })), undefined);
});

// 디스코드는 설명이 100자를 넘으면 메뉴 자체를 거부한다 — 길이·요청자를 지키고 아티스트부터 줄인다.
test("점프 설명: 100자를 넘지 않는다", () => {
  const long = jumpDescription(song({ artist: "가".repeat(300), requestedBy: { id: "u1", username: "아주긴이름".repeat(4) } }));
  assert.ok(long, "설명이 있다");
  assert.ok(long.length <= 100, `${long.length}자`);
  assert.ok(long.endsWith("| 1:40 | 아주긴이름아주긴이름아주긴이름아주긴이름"), "뒤쪽 정보는 남는다");
  assert.ok(long.includes("…"), "아티스트가 잘렸음을 보인다");
});

test("대기열 한 줄의 제목은 60자에서 잘라 ...을 붙인다(끝 표시까지 60자)", () => {
  const line = queueLine(song({ title: "a".repeat(80) }), 1);
  assert.ok(line.includes(`[${"a".repeat(57)}...]`), line);
  assert.ok(queueLine(song({ title: "a".repeat(60) }), 1).includes(`[${"a".repeat(60)}]`), "60자는 그대로");
});
