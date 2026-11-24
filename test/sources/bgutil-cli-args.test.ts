// src/sources/bgutil/cli-args.ts: install:bgutil의 인자(설정대로, 고정, 고정 해제, 봇이 넘기는 짝)

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInstallArgs } from "../../src/sources/bgutil/cli-args.ts";
import { asText, type LogText } from "../../src/infra/log/log-text.ts";

const SHA = "a".repeat(40);
const parse = (...args: string[]) => parseInstallArgs(["node", "install-bgutil.ts", ...args]);

test("인자가 없으면 설정대로, --force는 어느 것과도 같이", () => {
  assert.deepEqual(parse(), { mode: { kind: "settings" }, force: false });
  assert.deepEqual(parse("--force"), { mode: { kind: "settings" }, force: true });
  assert.deepEqual(parse("--", "--unpin", "--force"), { mode: { kind: "unpin" }, force: true }, "pnpm이 넘긴 --");
});

test("--pin은 커밋이 없으면 저장소에서 확인하고, --commit을 주면 소문자로 그 커밋", () => {
  assert.deepEqual(parse("--pin", "2.0.3"), { mode: { kind: "pin", tag: "2.0.3", commit: null }, force: false });
  assert.deepEqual(parse("--pin=2.0.3", "--commit", SHA.toUpperCase()), { mode: { kind: "pin", tag: "2.0.3", commit: SHA }, force: false });
});

test("--tag는 --commit과 함께만(봇의 설치 작업)", () => {
  assert.deepEqual(parse("--tag", "2.0.3", "--commit", SHA), { mode: { kind: "exact", tag: "2.0.3", commit: SHA }, force: false });
  assert.match(asText((parse("--tag", "2.0.3") as { error: LogText }).error), /--commit을 함께/);
});

test("틀린 조합과 값은 사유를 돌려준다", () => {
  const error = (...args: string[]) => asText((parse(...args) as { error?: LogText }).error ?? "");
  assert.match(error("--pin", "2.0.3", "--unpin"), /함께 쓸 수 없습니다/);
  assert.match(error("--pin", "2.0.3", "--tag", "2.0.3", "--commit", SHA), /함께 쓸 수 없습니다/);
  assert.match(error("--unpin", "--commit", SHA), /--unpin에는 --commit을/);
  assert.match(error("--commit", SHA), /--pin이나 --tag와 함께/);
  assert.match(error("--pin"), /태그를 넣으세요/);
  assert.match(error("--pin", "a..b"), /태그 이름이 아닙니다/);
  assert.match(error("--pin", "2.0.3", "--commit", "26475e9"), /커밋 해시 40자/);
  assert.match(error("--pinn", "2.0.3"), /모르는 인자입니다: --pinn/);
});
