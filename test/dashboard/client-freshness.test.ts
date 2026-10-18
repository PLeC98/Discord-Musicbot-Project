// src/dashboard/client-freshness.ts — 빌드해 둔 화면이 지금 소스보다 옛것인가. 임시 폴더에 가짜 저장소 · 빌드를 만든다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILD_INPUTS, clientFreshness, freshnessWarning } from "../../src/dashboard/client-freshness.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "client-freshness-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const dist = path.join(root, "dashboard", "dist");

const write = (rel: string, text = "x") => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
/** 파일의 수정 시각을 정한다(ms) */
const touch = (rel: string, ms: number) => fs.utimesSync(path.join(root, rel), ms / 1000, ms / 1000);

test("빌드가 없으면 missing, 빌드 정보가 없으면 unknown", () => {
  assert.deepEqual(clientFreshness(dist, root), { state: "missing" });
  write("dashboard/dist/index.html");
  assert.deepEqual(clientFreshness(dist, root), { state: "unknown" });
  write(`dashboard/dist/${BUILD_INPUTS}`, "{망가진");
  assert.deepEqual(clientFreshness(dist, root), { state: "unknown" }, "읽지 못하면 모름");
});

test("빌드 뒤 고쳐지거나 사라진 화면 소스만 가리킨다. 목록에 없는 봇 코드는 보지 않는다", () => {
  const builtAt = Date.UTC(2026, 9, 10, 12);
  write("dashboard/dist/index.html");
  write("dashboard/src/App.vue");
  write("src/rules/controls.ts");
  write("src/player/player.ts");
  touch("dashboard/src/App.vue", builtAt - 60_000);
  touch("src/rules/controls.ts", builtAt - 60_000);
  touch("src/player/player.ts", builtAt + 60_000);
  write(`dashboard/dist/${BUILD_INPUTS}`, JSON.stringify({ builtAt, files: ["dashboard/src/App.vue", "src/rules/controls.ts"] }));
  assert.deepEqual(clientFreshness(dist, root), { state: "fresh" });

  touch("src/rules/controls.ts", builtAt + 60_000);
  write(`dashboard/dist/${BUILD_INPUTS}`, JSON.stringify({ builtAt, files: ["dashboard/src/App.vue", "src/rules/controls.ts", "dashboard/src/gone.ts"] }));
  assert.deepEqual(clientFreshness(dist, root), { state: "stale", changed: ["src/rules/controls.ts", "dashboard/src/gone.ts"] });
});

test("경고 문장: 새것이면 없고, 옛것이면 바뀐 수와 앞의 셋 · 다시 빌드할 명령", () => {
  assert.equal(freshnessWarning({ state: "fresh" }), null);
  assert.match(freshnessWarning({ state: "missing" }) ?? "", /빌드되지 않았습니다. pnpm run build:dashboard/);
  const stale = freshnessWarning({ state: "stale", changed: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] }) ?? "";
  assert.match(stale, /바뀐 화면 소스 5개: a\.ts, b\.ts, c\.ts 외 2개\)/);
  assert.match(stale, /pnpm run build:dashboard/);
});
