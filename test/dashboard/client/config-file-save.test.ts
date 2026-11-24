// dashboard/src/composables/config-file.ts의 저장 실패: 설정 검사에 걸린 문제(config-invalid)만 편집기의 문제 목록에, 저장 실패의 원인(errors[].rule)은 알림의 상세로

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useConfigFile } from "../../../dashboard/src/composables/config-file.ts";
import { toasts, dismiss } from "../../../dashboard/src/composables/toasts.ts";
import { problemBody } from "../../../src/dashboard/contract/problem.ts";
import { plain, rule } from "../../../src/rules/rule-problem.ts";

afterEach(() => {
  for (const one of [...toasts]) dismiss(one.id);
});

/** 쓰기가 그 문제 응답으로 거절되는 편집기 */
function editorRejecting(body: ReturnType<typeof problemBody>) {
  let data: Record<string, unknown> = { a: 1 };
  // 컴포넌트 밖에서 만들어 onUnmounted 경고가 난다(이 테스트와 상관없다)
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    return useConfigFile({
      tab: "test",
      savedNote: () => "",
      payload: () => data,
      apply: (next) => (data = next),
      read: async () => ({ a: 1 }),
      write: async () => Promise.reject(Object.assign(new Error("rejected"), { isAxiosError: true, response: { status: body.status, data: body } })),
    });
  } finally {
    console.warn = warn;
  }
}

test("저장 실패의 원인은 문제 목록이 아니라 알림의 상세로 보인다", async () => {
  const file = editorRejecting(problemBody("config-save-failed", {}, { errors: [{ code: "config-save-failed", rule: plain("SQLITE_FULL: database or disk is full") }] }));
  await file.fetch();
  assert.equal(await file.save(), false);
  assert.deepEqual(file.serverProblems.value, []);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].detail, "SQLITE_FULL: database or disk is full");
});

test("메시지 없는 오류의 원인은 보는 사람의 언어로 그린 문장이다", async () => {
  const file = editorRejecting(problemBody("config-save-failed", {}, { errors: [{ code: "config-save-failed", rule: rule("error-code", { code: "EIO" }) }] }));
  await file.fetch();
  await file.save();
  assert.equal(toasts[0].detail, "오류 코드 EIO");
});

test("설정 검사에 걸린 문제는 편집기의 문제 목록에 들고 알림은 띄우지 않는다", async () => {
  const file = editorRejecting(
    problemBody(
      "config-invalid",
      {},
      {
        errors: [
          { code: "config-invalid", rule: plain("가") },
          { code: "config-invalid", rule: plain("나") },
        ],
      },
    ),
  );
  await file.fetch();
  await file.save();
  assert.deepEqual(file.serverProblems.value, ["가", "나"]);
  assert.equal(toasts.length, 0);
});
