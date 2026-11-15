// src/infra/process-priority.ts: 기동 때 봇 우선순위를 한 단계 올리고(올랐는지는 다시 읽은 값으로 판단한다), 자식은 올리기 전의 우선순위로 돌린다.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { raiseSelf, childPriority, settleChild, describe } from "../../src/infra/process-priority.ts";

const { PRIORITY_ABOVE_NORMAL, PRIORITY_BELOW_NORMAL, PRIORITY_HIGH, PRIORITY_NORMAL } = os.constants.priority;

// 우선순위를 값 하나로 가진 가짜. obey 가 false 면 바꾸라는 호출이 성공해도 값이 그대로다(우선순위를 제한한 Job Object)
function fakeOs(start: number, { obey = true, fail = null as object | null } = {}) {
  let now = start;
  const calls: Array<[number, number]> = [];
  return {
    calls,
    getPriority: () => now,
    setPriority: (pid: number, value?: number) => {
      calls.push([pid, value ?? NaN]);
      if (fail) throw Object.assign(new Error("A system error occurred"), fail);
      if (obey && pid === 0) now = value ?? now;
    },
  };
}

afterEach(() => {
  raiseSelf(process.platform, fakeOs(PRIORITY_NORMAL, { obey: false }));
});

test("Windows 에서 보통으로 뜬 봇을 보통보다 높음으로 올린다", () => {
  const sys = fakeOs(PRIORITY_NORMAL);
  const result = raiseSelf("win32", sys);
  assert.deepEqual(sys.calls, [[0, PRIORITY_ABOVE_NORMAL]]);
  assert.deepEqual(result, { platform: "win32", before: PRIORITY_NORMAL, after: PRIORITY_ABOVE_NORMAL, raised: true });
  assert.deepEqual(describe(result), [{ level: "info", text: "프로세스 우선순위: 보통보다 높음(보통에서 올림)" }]);
});

test("호출이 성공해도 값이 그대로면 오르지 않은 것으로 보고 경고한다", () => {
  const result = raiseSelf("win32", fakeOs(PRIORITY_NORMAL, { obey: false }));
  assert.equal(result.raised, false);
  const [line, ...rest] = describe(result);
  assert.equal(line?.level, "warn");
  assert.match(line?.text ?? "", /올리지 못함\(현재 보통\)/);
  assert.deepEqual(rest, []);
});

test("우선순위를 올리다 오류가 나면 기동을 멈추지 않고 까닭을 경고에 싣는다", () => {
  const result = raiseSelf("win32", fakeOs(PRIORITY_NORMAL, { fail: { info: { code: "EACCES" } } }));
  assert.equal(result.raised, false);
  assert.match(describe(result)[0]?.text ?? "", /올리지 못함\(현재 보통, EACCES\)/);
});

test("더 높은 우선순위로 뜬 봇의 우선순위는 낮추지 않는다", () => {
  const sys = fakeOs(PRIORITY_HIGH);
  const result = raiseSelf("win32", sys);
  assert.deepEqual(sys.calls, []);
  assert.equal(result.raised, true);
  assert.deepEqual(describe(result), [{ level: "info", text: "프로세스 우선순위: 높음" }]);
});

test("보통보다 낮게 뜬 봇의 CPU 우선순위를 올리고, I/O 와 메모리 우선순위는 낮을 수 있다고 경고한다", () => {
  const result = raiseSelf("win32", fakeOs(PRIORITY_BELOW_NORMAL));
  assert.equal(result.raised, true);
  const lines = describe(result);
  assert.deepEqual(
    lines.map((line) => line.level),
    ["info", "warn"],
  );
  assert.equal(lines[0]?.text, "프로세스 우선순위: 보통보다 높음(보통보다 낮음에서 올림)");
  assert.match(lines[1]?.text ?? "", /Priority를 4로/);
});

test("유닉스에서 올릴 권한이 있으면 nice -7 로 올린다", () => {
  const sys = fakeOs(PRIORITY_NORMAL);
  const result = raiseSelf("linux", sys);
  assert.deepEqual(sys.calls, [[0, PRIORITY_ABOVE_NORMAL]]);
  assert.equal(result.raised, true);
  assert.deepEqual(describe(result), [{ level: "info", text: "프로세스 우선순위: nice -7(nice 0에서 올림)" }]);
});

test("유닉스에서 올릴 권한이 없으면 경고 없이 그대로 돈다", () => {
  const result = raiseSelf("linux", fakeOs(5, { fail: { info: { code: "EACCES" } } }));
  assert.equal(result.raised, false);
  assert.deepEqual(describe(result), [{ level: "info", text: "프로세스 우선순위: nice 5(올리지 못함, EACCES)" }]);
});

test("Windows: 봇 우선순위가 올라 있으면 자식을 그대로 두고, 못 올렸으면 yt-dlp 만 낮춘다", () => {
  raiseSelf("win32", fakeOs(PRIORITY_NORMAL));
  assert.equal(childPriority(true), null);
  assert.equal(childPriority(false), null);
  raiseSelf("win32", fakeOs(PRIORITY_NORMAL, { obey: false }));
  assert.equal(childPriority(true), PRIORITY_BELOW_NORMAL);
  assert.equal(childPriority(false), null);
});

test("유닉스: 올린 값을 물려받은 자식을 올리기 전의 값으로 되돌리고, yt-dlp 는 nice 10 보다 높은 우선순위로 두지 않는다", () => {
  raiseSelf("linux", fakeOs(PRIORITY_NORMAL));
  assert.equal(childPriority(false), PRIORITY_NORMAL);
  assert.equal(childPriority(true), 10);
  raiseSelf("linux", fakeOs(15));
  assert.equal(childPriority(false), 15);
  assert.equal(childPriority(true), 15);
});

test("유닉스: 봇 우선순위를 올리지 못했으면 yt-dlp 만 nice 10 으로 낮추고, 우선순위가 이미 그보다 낮으면 그대로 둔다", () => {
  const denied = { fail: { info: { code: "EACCES" } } };
  raiseSelf("linux", fakeOs(PRIORITY_NORMAL, denied));
  assert.equal(childPriority(false), null);
  assert.equal(childPriority(true), 10);
  raiseSelf("linux", fakeOs(15, denied));
  assert.equal(childPriority(true), null);
});

test("자식의 우선순위는 바꿀 때만 그 pid 로 setPriority 를 부른다", () => {
  raiseSelf("linux", fakeOs(PRIORITY_NORMAL));
  const sys = fakeOs(PRIORITY_ABOVE_NORMAL);
  settleChild(4321, false, sys);
  settleChild(4322, true, sys);
  assert.deepEqual(sys.calls, [
    [4321, PRIORITY_NORMAL],
    [4322, 10],
  ]);
  raiseSelf("win32", fakeOs(PRIORITY_NORMAL));
  const untouched = fakeOs(PRIORITY_ABOVE_NORMAL);
  settleChild(4323, true, untouched);
  assert.deepEqual(untouched.calls, []);
});
