// src/infra/fatal-report.ts: 치명적 오류 진단 보고서를 켜되 환경 변수(.env의 비밀값)와 네트워크 인터페이스는 빼고, 폴더가 없으면 만든다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { enableFatalReport } from "../../src/infra/fatal-report.ts";

const blank = () => ({ directory: "", excludeEnv: false, excludeNetwork: false, reportOnFatalError: false });

test("보고서를 켜고 환경 변수와 네트워크 인터페이스를 뺀다. 없는 폴더는 만든다", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fatal-report-")), "logs");
  const report = blank();
  try {
    assert.equal(enableFatalReport(dir, report), null);
    assert.deepEqual(report, { directory: dir, excludeEnv: true, excludeNetwork: true, reportOnFatalError: true });
    assert.ok(fs.statSync(dir).isDirectory());
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test("폴더를 만들지 못하면 이유를 돌려주고 보고서를 켜지 않는다", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fatal-report-")), "a-file");
  fs.writeFileSync(file, "");
  const report = blank();
  try {
    assert.ok(enableFatalReport(path.join(file, "logs"), report));
    assert.deepEqual(report, blank());
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});
