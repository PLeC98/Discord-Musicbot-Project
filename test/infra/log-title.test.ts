// src/infra/log/title.ts — 로그에 적는 곡 제목

import { test } from "node:test";
import assert from "node:assert/strict";
import { logTitle } from "../../src/infra/log/title.ts";

test("제목이 없으면 그렇다고 적는다(null 을 글자로 찍지 않는다)", () => {
  assert.deepEqual(["곡", null, undefined].map(logTitle), ["곡", "(제목 없음)", "(제목 없음)"]);
});
