import { test } from "node:test";
import assert from "node:assert/strict";
import { bestEffort } from "../../src/infra/bestEffort.ts";

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
