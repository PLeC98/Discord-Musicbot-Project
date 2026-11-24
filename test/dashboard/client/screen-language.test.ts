// dashboard/src/composables/screen-language: 시작할 때 따를 값(계정, 브라우저 기억, 이번 로그인 화면에서 고른 것)과 고른 값으로 화면 언어를 정하는 순서

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve, startChoice } from "../../../dashboard/src/composables/screen-language.ts";
import { TEST_LANGUAGE } from "../../../src/rules/languages.ts";

const KO = { tag: "ko", name: "한국어" } as const;
const PSEUDO = { tag: TEST_LANGUAGE, name: "Pseudo" } as const;

test("로그인 전: 브라우저 기억, 없으면 자동. 계정에 옮기지 않는다", () => {
  assert.deepEqual(startChoice({ account: undefined, stored: TEST_LANGUAGE, picked: true }), { choice: TEST_LANGUAGE, toAccount: null });
  assert.deepEqual(startChoice({ account: undefined, stored: null, picked: false }), { choice: "auto", toAccount: null });
});

test("로그인 뒤: 계정 값이 우선한다(언어, 직접 고른 자동)", () => {
  assert.deepEqual(startChoice({ account: "ko", stored: TEST_LANGUAGE, picked: true }), { choice: "ko", toAccount: null });
  assert.deepEqual(startChoice({ account: "auto", stored: TEST_LANGUAGE, picked: true }), { choice: "auto", toAccount: null });
});

test("정한 적 없는 계정: 이번 로그인 화면에서 고른 언어만 계정에 옮긴다. 예전부터 기억한 값과 직접 고른 자동은 옮기지 않는다", () => {
  assert.deepEqual(startChoice({ account: null, stored: TEST_LANGUAGE, picked: true }), { choice: TEST_LANGUAGE, toAccount: TEST_LANGUAGE });
  assert.deepEqual(startChoice({ account: null, stored: TEST_LANGUAGE, picked: false }), { choice: "auto", toAccount: null });
  assert.deepEqual(startChoice({ account: null, stored: "auto", picked: true }), { choice: "auto", toAccount: null });
});

test("화면 언어: 고른 언어가 목록에 있으면 그 언어, 없으면 자동(브라우저 언어 → 봇 기본 언어 → 기준 언어)", () => {
  const both = [KO, PSEUDO];
  assert.equal(resolve(TEST_LANGUAGE, ["en-US"], both, "ko"), TEST_LANGUAGE);
  assert.equal(resolve(TEST_LANGUAGE, ["en-US"], [KO], "ko"), "ko", "테스트 언어를 끈 뒤");
  assert.equal(resolve("auto", ["ko-KR", "en"], both, TEST_LANGUAGE), "ko", "브라우저 언어의 언어 부분");
  assert.equal(resolve("auto", ["en-US"], both, TEST_LANGUAGE), TEST_LANGUAGE, "봇 기본 언어");
  assert.equal(resolve("auto", ["en-US"], [KO], TEST_LANGUAGE), "ko", "봇 기본 언어를 쓸 수 없으면 기준 언어");
});
