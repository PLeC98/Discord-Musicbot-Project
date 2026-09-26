// 등록부 로그의 호출 위치. 등록부 파일의 프레임은 건너뛰고 부른 쪽의 "파일:줄"을 찍는다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { caller, callerOf } from "../../src/player/registry.ts";

const SELF = "F:/bot/src/player/registry.ts";

test("등록부 파일의 프레임을 건너뛰고 부른 쪽을 찍는다(Windows 경로)", () => {
  const stack = ["Error", String.raw`    at callerOf (F:\bot\src\player\registry.ts:20:5)`, String.raw`    at PlayerRegistry.set (F:\bot\src\player\registry.ts:40:9)`, String.raw`    at run (F:\bot\commands\join.ts:41:3)`].join("\n");
  assert.equal(callerOf(stack, SELF), "commands/join.ts:41");
});

test("file:/// 주소 모양의 프레임도 같다", () => {
  const stack = ["Error", "    at PlayerRegistry.delete (file:///F:/bot/src/player/registry.ts:48:9)", "    at file:///F:/bot/src/player/idleLeave.ts:121:9"].join("\n");
  assert.equal(callerOf(stack, SELF), "player/idleLeave.ts:121");
});

test("실제로 부르면 이 시험 파일의 줄을 돌려준다", () => {
  assert.match(caller(), /^player\/registryCaller\.test\.ts:\d+$/);
});
