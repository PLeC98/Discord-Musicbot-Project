// src/app/startup-prepare.ts: 화면 빌드가 없거나 오래됐으면 기동할 때 빌드한다. 최신 상태이거나 개발 모드이거나 빌드 도구가 없으면 건너뛰고, 실패해도 기동을 막지 않는다.
// 진짜 Vite 대신 빌드 정보를 남기는 가짜 vite.js를 임시 저장소에 둔다

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDashboardIfStale, type DashboardPaths } from "../../src/app/startup-prepare.ts";
import { _resetJobs } from "../../src/infra/script-job.ts";
import { withConfig } from "../helpers/config.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "startup-prepare-"));
after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
afterEach(() => _resetJobs());

let n = 0;
/** 화면 소스 하나와 가짜 빌드 도구가 있는 임시 저장소. fail: 빌드 도구가 실패로 끝난다, noTool: 빌드 도구가 없다 */
function repo({ fail = false, noTool = false }: { fail?: boolean; noTool?: boolean } = {}): DashboardPaths & { runs: () => number } {
  const root = path.join(base, `repo-${++n}`);
  const dashboard = path.join(root, "dashboard");
  const dist = path.join(dashboard, "dist");
  fs.mkdirSync(path.join(dashboard, "src"), { recursive: true });
  fs.writeFileSync(path.join(dashboard, "src", "main.ts"), "export {};\n");
  const runs = path.join(root, "runs.log");
  if (!noTool) {
    const bin = path.join(dashboard, "node_modules", "vite", "bin");
    fs.mkdirSync(bin, { recursive: true });
    const body = fail
      ? `require("fs").appendFileSync(${JSON.stringify(runs)}, "x"); console.error("빌드 오류"); process.exit(1);`
      : `const fs = require("fs"), path = require("path");
fs.appendFileSync(${JSON.stringify(runs)}, "x");
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync(path.join("dist", "index.html"), "<html></html>");
fs.writeFileSync(path.join("dist", ".build-inputs.json"), JSON.stringify({ builtAt: Date.now() + 1000, files: ["dashboard/src/main.ts"] }));`;
    fs.writeFileSync(path.join(bin, "vite.js"), body);
  }
  return { root, dashboard, dist, runs: () => (fs.existsSync(runs) ? fs.readFileSync(runs, "utf8").length : 0) };
}

test("빌드가 없으면 빌드하고, 최신 상태가 된 뒤에는 다시 빌드하지 않는다", async () => {
  const r = repo();
  await buildDashboardIfStale(r);
  assert.equal(r.runs(), 1);
  assert.equal(fs.existsSync(path.join(r.dist, "index.html")), true);
  await buildDashboardIfStale(r);
  assert.equal(r.runs(), 1, "최신 상태면 건너뛴다");
});

test("빌드한 뒤 화면 소스가 바뀌면 다시 빌드한다", async () => {
  const r = repo();
  await buildDashboardIfStale(r);
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(r.dashboard, "src", "main.ts"), later, later);
  await buildDashboardIfStale(r);
  assert.equal(r.runs(), 2);
});

test("빌드에 실패해도 예외 없이 끝난다(기존 화면 유지)", async () => {
  const r = repo({ fail: true });
  await buildDashboardIfStale(r);
  assert.equal(r.runs(), 1);
});

test("빌드 도구가 없거나 개발 모드면 건너뛴다", async () => {
  const none = repo({ noTool: true });
  await buildDashboardIfStale(none);
  assert.equal(fs.existsSync(none.dist), false);
  const dev = repo();
  await withConfig({ dashboard: { devOrigin: true } }, () => buildDashboardIfStale(dev));
  assert.equal(dev.runs(), 0);
});
