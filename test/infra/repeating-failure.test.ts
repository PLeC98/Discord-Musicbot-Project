// src/infra/repeating-failure.ts: 연속된 같은 실패는 처음 한 번만 error, 풀리면 한 줄. 로그가 사건 수와 맞는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { repeatingFailure } from "../../src/infra/repeating-failure.ts";
import { logText, renderLogText, type LogText } from "../../src/infra/log/log-text.ts";
import { testText } from "../helpers/log-text.ts";

function recorder() {
  const lines: Array<[string, string]> = [];
  return { lines, log: { error: (line: LogText) => lines.push(["error", renderLogText(line)]), info: (line: LogText) => lines.push(["info", renderLogText(line)]) } };
}

test("줄은 문구(서술자)로 넘기고, 원인이 서술자면 문구 코드와 값이 같을 때 같은 실패로 센다", () => {
  const events: string[] = [];
  const save = repeatingFailure(
    { error: (line) => events.push(line.event), info: (line) => events.push(line.event) },
    logText("demo.label", {}, () => "작업"),
  );
  const reason = () => logText("demo.reason", { code: 5 }, () => "원인");
  save.fail(reason());
  save.fail(reason());
  save.fail(logText("demo.reason", { code: 6 }, () => "다른 원인"));
  save.ok();
  assert.deepEqual(events, ["failure.started", "failure.started", "failure.recovered"]);
});

test("같은 원인의 잇단 실패는 한 번만 남기고, 풀리면 횟수와 함께 한 줄", () => {
  const { lines, log } = recorder();
  const save = repeatingFailure(log, testText("재생 위치 저장"));
  save.ok();
  for (let i = 0; i < 165; i++) save.fail("database is locked");
  save.ok();
  save.ok();
  assert.deepEqual(lines, [
    ["error", "재생 위치 저장 실패: database is locked"],
    ["info", "재생 위치 저장 복구(실패 165회)"],
  ]);
});

test("원인이 바뀌면 새 사건으로 다시 남긴다", () => {
  const { lines, log } = recorder();
  const save = repeatingFailure(log, testText("재생 위치 저장"));
  save.fail("database is locked");
  save.fail("disk I/O error");
  assert.deepEqual(
    lines.map(([level]) => level),
    ["error", "error"],
  );
});
