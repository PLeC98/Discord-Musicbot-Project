"use strict";

// 오류 메시지의 ❌ 접두 규약 — src/strings.js가 단일 출처.
//
// 회귀 대상: 표시 지점마다 접두를 제각기 추측해 전용 채널은 "❌ ❌ …"로 두 번 찍고,
// handleMusicData 실패는 ❌ 없이 나가고, 대시보드 JSON에는 ❌가 새어 들어갔다.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const S = require("../src/strings");
const { toApiError } = require("../dashboard/server/middleware/requireControl");

// 실제로 흘러다니는 두 종류의 출처
const PREFIXED = "❌ 결과를 찾을 수 없습니다!"; // TrackResolver / ErrorHandler / strings
const BARE = "음악을 처리하는 중 오류가 발생했습니다."; // MusicEmbedManager._processMusic

test("withErrorMark: 접두가 없으면 붙인다", () => {
  assert.equal(S.withErrorMark(BARE), `❌ ${BARE}`);
});

test("withErrorMark: 이미 있으면 덧붙이지 않는다", () => {
  assert.equal(S.withErrorMark(PREFIXED), PREFIXED);
  assert.equal(S.withErrorMark(`  ${PREFIXED}`), `  ${PREFIXED}`, "앞 공백이 있어도 중복 금지");
});

test("withErrorMark: 멱등 — 몇 번을 통과시켜도 ❌는 하나", () => {
  const once = S.withErrorMark(BARE);
  assert.equal(S.withErrorMark(S.withErrorMark(once)), once);
  assert.equal((once.match(/❌/g) || []).length, 1);
});

test("withErrorMark: null/undefined에도 던지지 않는다", () => {
  assert.equal(S.withErrorMark(null), "❌ ");
  assert.equal(S.withErrorMark(undefined), "❌ ");
});

test("withoutErrorMark: 대시보드 JSON용으로 접두를 제거한다", () => {
  assert.equal(S.withoutErrorMark(PREFIXED), "결과를 찾을 수 없습니다!");
  assert.equal(S.withoutErrorMark(BARE), BARE, "없으면 그대로");
  assert.equal(S.withoutErrorMark(null), "");
});

test("두 헬퍼는 서로의 역", () => {
  assert.equal(S.withoutErrorMark(S.withErrorMark(BARE)), BARE);
});

test("대시보드 toApiError는 같은 규약을 쓴다 (자체 정규식 사본 금지)", () => {
  assert.equal(toApiError, S.withoutErrorMark);
});

test("공유 문자열은 전부 ❌로 시작한다 — 표시 지점이 접두를 덧붙이지 않아도 되게", () => {
  for (const [key, value] of Object.entries(S)) {
    if (!key.startsWith("ERR_")) continue;
    assert.ok(value.startsWith("❌"), `${key}: ${value}`);
    assert.equal(S.withErrorMark(value), value, `${key}가 중복 접두를 유발함`);
  }
});
