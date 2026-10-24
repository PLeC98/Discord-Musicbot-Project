// 잇단 같은 실패는 처음 한 번만 error, 풀리면 한 줄. 로그가 사건 수와 맞는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { repeatingFailure } from "../../src/infra/repeating-failure.ts";

function recorder() {
  const lines: Array<[string, string]> = [];
  return { lines, log: { error: (line: string) => lines.push(["error", line]), info: (line: string) => lines.push(["info", line]) } };
}

test("같은 까닭의 잇단 실패는 한 번만 남기고, 풀리면 횟수와 함께 한 줄", () => {
  const { lines, log } = recorder();
  const save = repeatingFailure(log, "재생 위치 저장");
  save.ok();
  for (let i = 0; i < 165; i++) save.fail("database is locked");
  save.ok();
  save.ok();
  assert.deepEqual(lines, [
    ["error", "재생 위치 저장 실패: database is locked"],
    ["info", "재생 위치 저장: 다시 됩니다(잇단 실패 165회 뒤)"],
  ]);
});

test("까닭이 바뀌면 새 사건으로 다시 남긴다", () => {
  const { lines, log } = recorder();
  const save = repeatingFailure(log, "재생 위치 저장");
  save.fail("database is locked");
  save.fail("disk I/O error");
  assert.deepEqual(
    lines.map(([level]) => level),
    ["error", "error"],
  );
});
