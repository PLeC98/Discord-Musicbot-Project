// src/ui/queue-display.ts: 대기열을 보여 주는 곳들의 공통 생김새.
//
// `/queue`와 대기열 버튼이 같은 줄을 쓰고, 재생 패널과 /queue 편집이 같은 메뉴 항목을 쓴다(각자 만들면 한쪽만 고쳐 표시가 달라진다).
// 줄 만드는 규칙은 여기서 잠근다.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EDIT_SEPARATOR, JUMP_SEPARATOR, editParts, entryLine, entryLines, jumpParts, menuEntries } from "../../src/ui/queue-display.ts";
import { descriptionOf } from "../../src/ui/menu-fit.ts";
import { useUploaded } from "../../src/ui/icons.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { textFor } from "../../src/ui/text/index.ts";
const KO = textFor("ko");

afterEach(() => useUploaded(new Map()));

// 메뉴에 보이는 설명(칸을 합쳐 디스코드 상한에 맞춘 것)
const jumpDescription = (track: QueuedTrack) => descriptionOf(jumpParts(track), JUMP_SEPARATOR);
const editDescription = (track: QueuedTrack) => descriptionOf(editParts(track), EDIT_SEPARATOR);

const song = (over: Partial<QueuedTrack> = {}): QueuedTrack => ({ title: "곡", pageUrl: "https://y/1", requestKey: "https://y/1", platform: "youtube", artist: "가수", duration: 100, ...over });

test("대기열 줄: 제목이 링크 라벨을 닫지 못하고, 링크를 뗀 줄에서는 제목의 링크 문법이 이스케이프된다", () => {
  const evil = song({ title: "x](https://evil.example) [y", artist: undefined, duration: 0 });
  assert.equal(entryLine(KO, evil, 1), "`1` **[x]​(https://evil.example) [y](https://y/1)**");
  const plain = entryLine(KO, song({ title: "[클릭](https://evil.example)" }), 1, { link: false });
  assert.ok(!/(^|[^\\])\[[^\]]*\]\(/.test(plain), plain);
});

test("대기열 줄: 아래 줄은 아티스트 · 요청자(멘션) · 시작까지, 적을 것이 없으면 한 줄", () => {
  assert.equal(entryLine(KO, song({ requestedBy: { id: "u1" } }), 3, { startsIn: 200 }), "`3` **[곡](https://y/1)** · 1:40\n-# 가수 · <@u1> · 약 3분 뒤");
  assert.equal(entryLine(KO, song({ artist: undefined }), 2), "`2` **[곡](https://y/1)** · 1:40");
  assert.equal(entryLine(KO, song({ title: null, artist: "*별*" }), 2), "`2` **[알 수 없는 곡](https://y/1)** · 1:40\n-# \\*별\\*");
});

test("대기열 줄: 라이브는 길이 자리에 🔴LIVE, 길이를 모르면 길이를 적지 않는다", () => {
  assert.equal(entryLine(KO, song({ isLive: true, duration: 0, artist: undefined }), 1), "`1` **[곡](https://y/1)** · 🔴LIVE");
  assert.equal(entryLine(KO, song({ duration: 0, artist: undefined }), 1), "`1` **[곡](https://y/1)**");
});

test("대기열 줄: 자동재생 곡은 자동재생 아이콘과 이름으로. 장르 이모지를 쓰지 않는다. 앱 이모지를 맞추면 그것", () => {
  const line = () => entryLine(KO, song({ autoplay: true, requestedBy: { id: "bot" } }), 1);
  assert.equal(line(), "`1` **[곡](https://y/1)** · 1:40\n-# 가수 · 📻 자동재생");
  useUploaded(new Map([["autoplay", { id: "7", animated: false }]]));
  assert.equal(line(), "`1` **[곡](https://y/1)** · 1:40\n-# 가수 · <:autoplay:7> 자동재생");
});

test("대기열 줄: 제목은 60자, 아티스트는 40자에서 잘라 ...을 붙인다(끝 표시까지)", () => {
  const line = entryLine(KO, song({ title: "a".repeat(80), artist: "b".repeat(50) }), 1);
  assert.ok(line.includes(`[${"a".repeat(57)}...]`), line);
  assert.ok(line.includes(`-# ${"b".repeat(37)}...`), line);
  assert.ok(entryLine(KO, song({ title: "a".repeat(60) }), 1).includes(`[${"a".repeat(60)}]`), "60자는 그대로");
});

test("대기열 줄들: 상한을 넘으면 주소가 긴 곡부터 링크를 뗀다", () => {
  const tracks = [song({ pageUrl: `https://y/${"x".repeat(500)}` }), song({ pageUrl: "https://y/short" })];
  const all = entryLines(KO, { tracks, max: 4000 });
  assert.equal((all.match(/\]\(https/g) ?? []).length, 2);
  const cut = entryLines(KO, { tracks, max: 300 });
  assert.ok(cut.length <= 300, `${cut.length}자`);
  assert.ok(cut.includes("(https://y/short)") && !cut.includes("xxxx"), cut);
  assert.ok(entryLines(KO, { tracks, first: 11, max: 4000 }).startsWith("`11`"), "번호는 first 부터");
});

// 셀렉트 메뉴 설명은 멘션, 앱 이모지를 렌더링하지 않는다(글자 그대로 보인다). 이름과 유니코드를 쓴다.
test("점프 설명: 아티스트 | 길이 | 요청자 이름. 자동재생 곡은 앱 이모지를 맞춰도 유니코드", () => {
  assert.equal(jumpDescription(song({ requestedBy: { id: "u1", username: "요청자" } })), "가수 | 1:40 | 요청자");
  useUploaded(new Map([["autoplay", { id: "7", animated: false }]]));
  assert.equal(jumpDescription(song({ autoplay: true })), "가수 | 1:40 | 📻");
});

test("점프 설명: 라이브는 길이 위치에 🔴LIVE, 시작 전이면 예정된 라이브", () => {
  assert.equal(jumpDescription(song({ isLive: true, duration: 0, requestedBy: { id: "u1", username: "요청자" } })), "가수 | 🔴LIVE | 요청자");
  assert.equal(jumpDescription(song({ artist: undefined, isLive: true, duration: 0 })), "🔴LIVE");
  assert.equal(jumpDescription(song({ isLive: true, liveStatus: "is_upcoming", duration: 0 })), "가수 | 예정된 라이브");
});

// 복원된 곡은 세션에 id만 남아 이름을 모른다. 멘션을 원본 그대로 보이느니 적지 않는다.
test("점프 설명: 이름을 모르면 요청자를 적지 않는다", () => {
  assert.equal(jumpDescription(song({ requestedBy: { id: "u1" } })), "가수 | 1:40");
});

test("점프 설명: 아티스트가 없으면 나머지만, 아무것도 없으면 undefined", () => {
  assert.equal(jumpDescription(song({ artist: undefined, autoplay: true })), "1:40 | 📻");
  assert.equal(jumpDescription(song({ artist: undefined, duration: 0 })), undefined);
});

// 디스코드는 설명이 100자를 넘으면 메뉴 자체를 거부한다. 길이는 지키고, 아티스트와 요청자 가운데 긴 쪽부터 같은 수위까지 줄인다.
test("점프 설명: 100자를 넘지 않는다. 짧은 요청자는 그대로", () => {
  const long = jumpDescription(song({ artist: "가".repeat(300), requestedBy: { id: "u1", username: "아주긴이름".repeat(4) } }));
  assert.ok(long, "설명이 있다");
  assert.ok(long.length <= 100, `${long.length}자`);
  assert.ok(long.endsWith("| 1:40 | 아주긴이름아주긴이름아주긴이름아주긴이름"), "뒤쪽 정보는 남는다");
  assert.ok(long.includes("…"), "아티스트가 잘렸음을 보인다");
});

test("편집 메뉴 설명: 아티스트 · 길이. 100자를 넘으면 아티스트부터 줄인다", () => {
  assert.equal(editDescription(song({ requestedBy: { id: "u1", username: "요청자" } })), "가수 · 1:40");
  assert.equal(editDescription(song({ artist: undefined, isLive: true, duration: 0 })), "🔴LIVE");
  const long = editDescription(song({ artist: "가".repeat(300) }));
  assert.ok(long && long.length <= 100 && long.endsWith("… · 1:40"), long);
});

const entry = (track: QueuedTrack, value: number) => Object.defineProperty(track, "entry", { value, enumerable: false });

test("메뉴 항목: 번호. 제목(화면 폭 66까지), 값은 대기열 ID, ID가 없거나 겹치면 뺀다. 고른 곡은 기본값", () => {
  const tracks = [entry(song({ title: "가" }), 7), song({ title: "ID 없음" }), entry(song({ title: "나".repeat(200) }), 9), entry(song({ title: "겹침" }), 7)];
  const entries = menuEntries(KO, tracks, { first: 11, parts: editParts, picked: 9 });
  assert.deepEqual(
    entries.map((one) => [one.label, one.value, one.picked]),
    [
      ["11. 가", "entry:7", false],
      [`13. ${"나".repeat(30)}…`, "entry:9", true],
    ],
  );
  assert.equal(descriptionOf(entries[0].parts, EDIT_SEPARATOR), "가수 · 1:40");
});
