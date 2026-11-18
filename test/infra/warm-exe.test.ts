// 막 받은 실행 파일을 워커 스레드에서 한 번 띄워 두기(Windows만)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { warmExecutable } from "../../src/infra/warm-exe.ts";

const windows = process.platform === "win32";

test("Windows: 워커 스레드에서 넘긴 환경으로 한 번 띄우고 끝날 때까지 기다린다", { skip: !windows }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "warm-exe-"));
  const marker = path.join(dir, "ran");
  try {
    await warmExecutable(process.execPath, ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, String(process.env.WARM_ONLY))`], 30_000, { ...process.env, WARM_ONLY: "1" });
    assert.equal(fs.readFileSync(marker, "utf8"), "1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows: 띄우지 못해도 예외 없이 끝난다(확인은 호출부의 실행이 한다)", { skip: !windows }, async () => {
  await warmExecutable(path.join(os.tmpdir(), "no-such-exe-for-warm.exe"), [], 30_000, process.env);
});

test("Windows: 시간 안에 끝나지 않으면 내리고 끝난다", { skip: !windows }, async () => {
  const started = Date.now();
  await warmExecutable(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], 300, process.env);
  assert.ok(Date.now() - started < 10_000, `${Date.now() - started}ms`);
});

test("Windows가 아니면 띄우지 않고 바로 끝난다", { skip: windows }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "warm-exe-"));
  const marker = path.join(dir, "ran");
  try {
    await warmExecutable(process.execPath, ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`], 30_000, process.env);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
