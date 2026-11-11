// src/infra/best-effort.ts: 실패해도 되는 일은 삼키되, 무엇이 왜 실패했는지 debug 한 줄로 남긴다

import { test } from "node:test";
import assert from "node:assert/strict";
import { bestEffort } from "../../src/infra/best-effort.ts";

const recorder = () => {
  const lines: string[] = [];
  return { lines, debug: (line: string) => lines.push(line) };
};

test("성공하면 아무것도 남기지 않는다", async () => {
  const log = recorder();
  await bestEffort(log, Promise.resolve(1), "패널 고치기");
  assert.deepEqual(log.lines, []);
});

test("실패는 삼키고 무엇이 왜 실패했는지 debug 한 줄로 남긴다", async () => {
  const log = recorder();
  await bestEffort(log, Promise.reject(new Error("권한 없음")), "패널 고치기");
  assert.deepEqual(log.lines, ["패널 고치기 실패: 권한 없음"]);
  await bestEffort(log, Promise.reject("글자"), "지우기");
  assert.equal(log.lines[1], "지우기 실패: 글자");
});

test("수준을 주면 그 수준으로 남긴다", async () => {
  const lines: string[] = [];
  const log = { warn: (line: string) => lines.push(`warn ${line}`), error: (line: string) => lines.push(`error ${line}`) };
  await bestEffort(log, Promise.reject(new Error("끊김")), "알림 전송", "warn");
  await bestEffort(log, Promise.reject(new Error("버그")), "기동", "error");
  assert.deepEqual(lines, ["warn 알림 전송 실패: 끊김", "error 기동 실패: 버그"]);
});
