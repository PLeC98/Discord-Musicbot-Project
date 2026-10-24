// src/app/exit-codes.ts — 기동 실패의 종료 코드. 고치기 전에는 다시 시작해도 같은 실패(78)와 잠시 뒤 다시 시작하면 되는 실패(75)를 구분한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EXIT, failedStartCode } from "../../src/app/exit-codes.ts";

test("기동 전 확인이 멈췄거나 토큰 · 인텐트가 틀리면 설정 문제(78), 디스코드 5xx · 네트워크는 일시적(75)", () => {
  assert.equal(failedStartCode(new Error("ffmpeg 없음"), true), EXIT.badSetup);
  assert.equal(failedStartCode(Object.assign(new Error("An invalid token was provided."), { code: "TokenInvalid" }), false), EXIT.badSetup);
  assert.equal(failedStartCode(Object.assign(new Error("Used disallowed intents"), { code: "DisallowedIntents" }), false), EXIT.badSetup);
  assert.equal(failedStartCode(Object.assign(new Error("Internal Server Error"), { status: 500 }), false), EXIT.transient);
  assert.equal(failedStartCode(Object.assign(new Error("socket"), { code: "ECONNRESET" }), false), EXIT.transient);
  assert.equal(failedStartCode("문자열", false), EXIT.transient);
  assert.deepEqual(EXIT, { stopped: 0, globalFlood: 3, restart: 4, transient: 75, badSetup: 78 });
});
