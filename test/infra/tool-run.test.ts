// src/infra/tool-run.ts: 외부 도구를 실행해 결과를 반환하고, 시간 상한을 넘으면 손자 프로세스까지 트리 전체를 강제 종료하고 실패한다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTool } from "../../src/infra/tool-run.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-run-"));
after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
const node = (code: string) => [process.execPath, ["-e", code]] as const;
const base = { env: process.env, label: "테스트 도구", timeoutMs: 30_000 };

test("종료 코드 0이면 모은 표준 출력을 돌려주고 넘긴 환경만 본다", async () => {
  // 테스트 프로세스에는 있지만 넘기는 환경에서 뺀 변수는 도구에 없다
  process.env.TOOL_RUN_PARENT_ONLY = "p";
  const { TOOL_RUN_PARENT_ONLY: _dropped, ...env } = process.env;
  const [file, args] = node("process.stdout.write(process.env.ONLY_HERE + ':' + ('TOOL_RUN_PARENT_ONLY' in process.env))");
  const out = await runTool(file, [...args], { ...base, env: { ...env, ONLY_HERE: "1" }, capture: true });
  delete process.env.TOOL_RUN_PARENT_ONLY;
  assert.equal(out, "1:false");
});

test("종료 코드가 0이 아니면 이름, 코드, stderr 끝부분을 담아 거부된다", async () => {
  const [file, args] = node("process.stderr.write('npm ERR! 무엇이 틀림'); process.exit(3)");
  await assert.rejects(runTool(file, [...args], { ...base, capture: true }), (error: Error) => error.message.includes("테스트 도구") && error.message.includes("3") && error.message.includes("무엇이 틀림"));
});

test("실행하지 못하면 거부된다", async () => {
  await assert.rejects(runTool(path.join(dir, "no-such-tool"), [], { ...base, capture: true }), /테스트 도구 실행 실패/);
});

test("시간 상한을 넘기면 손자 프로세스까지 강제 종료하고 거부된다", async () => {
  const marker = path.join(dir, "grandchild-ran");
  // 자식이 손자를 실행하고 둘 다 끝나지 않고 기다린다. 손자는 2초 뒤 마커 파일을 쓴다
  const grandchild = `setTimeout(() => require("fs").writeFileSync(${JSON.stringify(marker)}, "x"), 2000)`;
  const [file, args] = node(`require("child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "inherit" }); setTimeout(() => {}, 60_000)`);
  const started = Date.now();
  await assert.rejects(runTool(file, [...args], { ...base, timeoutMs: 500, capture: true }), /시간 상한\(1초\)을 넘겨 강제 종료함/);
  assert.ok(Date.now() - started < 10_000, `${Date.now() - started}ms`);
  await new Promise((done) => setTimeout(done, 3000));
  assert.equal(fs.existsSync(marker), false, "손자도 끝났다");
});
