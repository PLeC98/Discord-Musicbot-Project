// src/infra/process-priority.ts: Windows 에서 기동 때 봇을 "보통보다 높음"으로 올리고, 올랐는지는 다시 읽은 값으로 판단한다.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { raiseSelf, selfRaised, describe } from "../../src/infra/process-priority.ts";

const { PRIORITY_ABOVE_NORMAL, PRIORITY_BELOW_NORMAL, PRIORITY_HIGH, PRIORITY_NORMAL } = os.constants.priority;

// 우선순위를 값 하나로 가진 가짜. obey 가 false 면 바꾸라는 호출이 성공해도 값이 그대로다(우선순위를 제한한 Job Object)
function fakeOs(start: number, { obey = true, fail = "" } = {}) {
  let now = start;
  const calls: number[] = [];
  return {
    calls,
    getPriority: () => now,
    setPriority: (_pid: number, value?: number) => {
      calls.push(value ?? NaN);
      if (fail) throw new Error(fail);
      if (obey) now = value ?? now;
    },
  };
}

afterEach(() => {
  raiseSelf("linux", fakeOs(PRIORITY_NORMAL));
});

test("Windows 에서 보통으로 뜬 봇을 보통보다 높음으로 올린다", () => {
  const sys = fakeOs(PRIORITY_NORMAL);
  const result = raiseSelf("win32", sys);
  assert.deepEqual(sys.calls, [PRIORITY_ABOVE_NORMAL]);
  assert.deepEqual(result, { before: PRIORITY_NORMAL, after: PRIORITY_ABOVE_NORMAL, raised: true });
  assert.equal(selfRaised(), true);
  assert.deepEqual(describe(result, "win32"), [{ level: "info", text: "프로세스 우선순위: 보통보다 높음(보통에서 올림)" }]);
});

test("호출이 성공해도 값이 그대로면 오르지 않은 것으로 보고 경고한다", () => {
  const result = raiseSelf("win32", fakeOs(PRIORITY_NORMAL, { obey: false }));
  assert.equal(result.raised, false);
  assert.equal(selfRaised(), false);
  const [line, ...rest] = describe(result, "win32");
  assert.equal(line?.level, "warn");
  assert.match(line?.text ?? "", /올리지 못함\(현재 보통\)/);
  assert.deepEqual(rest, []);
});

test("우선순위를 올리다 오류가 나면 기동을 멈추지 않고 까닭을 경고에 싣는다", () => {
  const result = raiseSelf("win32", fakeOs(PRIORITY_NORMAL, { fail: "access denied" }));
  assert.equal(result.raised, false);
  assert.match(describe(result, "win32")[0]?.text ?? "", /올리지 못함\(현재 보통, access denied\)/);
});

test("더 높은 우선순위로 뜬 봇의 우선순위는 낮추지 않는다", () => {
  const sys = fakeOs(PRIORITY_HIGH);
  const result = raiseSelf("win32", sys);
  assert.deepEqual(sys.calls, []);
  assert.equal(result.raised, true);
  assert.deepEqual(describe(result, "win32"), [{ level: "info", text: "프로세스 우선순위: 높음" }]);
});

test("보통보다 낮게 뜬 봇의 CPU 우선순위를 올리고, I/O 와 메모리 우선순위는 낮을 수 있다고 경고한다", () => {
  const result = raiseSelf("win32", fakeOs(PRIORITY_BELOW_NORMAL));
  assert.equal(result.raised, true);
  const lines = describe(result, "win32");
  assert.deepEqual(
    lines.map((line) => line.level),
    ["info", "warn"],
  );
  assert.equal(lines[0]?.text, "프로세스 우선순위: 보통보다 높음(보통보다 낮음에서 올림)");
  assert.match(lines[1]?.text ?? "", /Priority를 4로/);
});

test("Windows 가 아니면 우선순위를 바꾸지 않고 읽은 값만 남긴다", () => {
  const sys = fakeOs(5);
  const result = raiseSelf("linux", sys);
  assert.deepEqual(sys.calls, []);
  assert.equal(result.raised, false);
  assert.deepEqual(describe(result, "linux"), [{ level: "info", text: "프로세스 우선순위: nice 5" }]);
});
