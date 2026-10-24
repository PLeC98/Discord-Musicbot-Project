// src/rules/problems.ts — 문제 코드 목록. 코드 형식 · HTTP 상태 · 값 이름의 규칙과, 목록의 코드마다 안내가 그려지는지

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROBLEMS, isCode, type Code, type Params } from "../../src/rules/problems.ts";
import { noticeFor } from "../../src/ui/text/ko/errors.ts";

const codes = Object.keys(PROBLEMS) as Code[];
const SAMPLE: Required<Params> = { max: 100, min: 1, queueCap: 50, size: 3, skipped: 7, durationMs: 185000, genre: "가요", keys: "Last.fm", channelId: "42", length: 2100, left: 2 };
/** 그 코드의 목록에 적은 값만 견본으로 채운다 */
const paramsFor = (code: Code) => {
  const spec = PROBLEMS[code];
  return Object.fromEntries(("params" in spec ? spec.params : []).map((name) => [name, SAMPLE[name]]));
};

test("코드는 소문자 케밥, 63자 이하", () => {
  for (const code of codes) assert.match(code, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, code);
  for (const code of codes) assert.ok(code.length <= 63, code);
});

test("HTTP 상태는 4xx · 5xx 이고, 제목은 영어 한 줄", () => {
  for (const [code, spec] of Object.entries(PROBLEMS)) {
    assert.ok(Number.isInteger(spec.status) && spec.status >= 400 && spec.status <= 599, code);
    assert.match(spec.title, /^[A-Z][\x20-\x7E]*[a-z]$/, code);
  }
});

test("값 이름은 RFC 9457 확장 필드 규칙(글자로 시작, 글자 · 숫자 · _, 3자 이상)을 따른다", () => {
  for (const [code, spec] of Object.entries(PROBLEMS)) for (const name of "params" in spec ? spec.params : []) assert.match(name, /^[A-Za-z][A-Za-z0-9_]{2,}$/, `${code}.${name}`);
});

test("목록에 적은 값으로 그린 안내에는 빈 값이 끼지 않는다", () => {
  for (const code of codes) {
    const { title, body = "" } = noticeFor(code, paramsFor(code));
    assert.doesNotMatch(`${title}\n${body}`, /undefined|null|NaN|\[object/, code);
  }
});

test("안내는 그 코드를 단다", () => {
  for (const code of codes) assert.equal(noticeFor(code, paramsFor(code)).code, code);
});

test("실행 중에 코드가 정해진 문제에 그 코드의 값이 빠졌으면 문장을 그리지 않고 알 수 없는 오류로, 빠진 이름을 알린다", () => {
  const missing: string[][] = [];
  assert.equal(noticeFor("queue-full", {}, undefined, (names) => missing.push(names)).code, "unknown-error");
  assert.deepEqual(missing, [["max"]]);
  assert.equal(noticeFor("queue-full", { max: 3 }).code, "queue-full");
});

test("목록에 있는 코드인지 구분한다(흐름의 코드 · 옛 이름은 아니다)", () => {
  assert.ok(isCode("queue-full"));
  for (const value of ["lookup-failed", "play-threw", "no-player", "network", "toString", "constructor"]) assert.equal(isCode(value), false, value);
});
