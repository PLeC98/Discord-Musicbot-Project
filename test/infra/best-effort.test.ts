// src/infra/best-effort.ts: 실패해도 되는 일은 삼키되, 무엇이 왜 실패했는지 debug 한 줄(로그 문구)로 남긴다

import { test } from "node:test";
import assert from "node:assert/strict";
import { bestEffort } from "../../src/infra/best-effort.ts";
import { renderLogText, type LogText } from "../../src/infra/log/log-text.ts";
import { L } from "../../src/infra/log/text.ts";

const recorder = () => {
  const lines: string[] = [];
  return { lines, debug: (line: LogText) => lines.push(renderLogText(line)) };
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
  const log = { warn: (line: LogText) => lines.push(`warn ${renderLogText(line)}`), error: (line: LogText) => lines.push(`error ${renderLogText(line)}`) };
  await bestEffort(log, Promise.reject(new Error("끊김")), "알림 전송", "warn");
  await bestEffort(log, Promise.reject(new Error("버그")), "기동", "error");
  assert.deepEqual(lines, ["warn 알림 전송 실패: 끊김", "error 기동 실패: 버그"]);
});

test("오류 코드가 있으면 메시지 뒤에 붙인다", async () => {
  const lines: string[] = [];
  await bestEffort({ warn: (line: LogText) => lines.push(renderLogText(line)) }, Promise.reject(Object.assign(new Error("Missing Permissions"), { code: 50013 })), "알림 전송", "warn");
  assert.deepEqual(lines, ["알림 전송 실패: Missing Permissions (50013)"]);
});

test("실패 줄은 문구 코드 failure.bestEffortFailed이고, 작업 이름이 서술자면 값 안에 서술자로 남는다", async () => {
  const seen: LogText[] = [];
  const what = L.failure.recovered({ what: "패널", count: 2 });
  await bestEffort({ debug: (line: LogText) => seen.push(line) }, Promise.reject(new Error("끊김")), what);
  assert.deepEqual([seen[0].event, seen[0].args.what, seen[0].args.reason], ["failure.bestEffortFailed", what, "끊김"]);
});
