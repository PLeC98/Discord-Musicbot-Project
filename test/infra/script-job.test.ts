// src/infra/script-job.ts: 설치 스크립트를 자식 프로세스로 실행하는 작업. 한 번에 하나만 실행, 성공 판정의 네 조건, id로 하는 취소, 시간 상한, 출력 상한, 종료 중 거절

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startJob, cancelJob, stopJob, jobNow, jobRunning, onJobIdle, _resetJobs, KEEP_LINES, LINE_CHARS, type ScriptJobInfo, type ScriptJobSpec } from "../../src/infra/script-job.ts";
import { beginShutdown, _resetShutdown } from "../../src/infra/shutdown-state.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "script-job-"));
after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
afterEach(() => {
  _resetJobs();
  _resetShutdown();
});

let n = 0;
/** 본문을 스크립트 파일로 쓰고 경로를 돌려준다 */
const script = (body: string) => {
  const file = path.join(dir, `job-${++n}.mjs`);
  fs.writeFileSync(file, body);
  return file;
};
/** 작업을 시작하고 끝날 때 상태를 받는다 */
function run(spec: Partial<ScriptJobSpec> & { script: string }): { id: number; done: Promise<ScriptJobInfo> } {
  let resolve!: (info: ScriptJobInfo) => void;
  const done = new Promise<ScriptJobInfo>((r) => (resolve = r));
  const started = startJob({ name: "ffmpeg-install", args: [], cwd: dir, env: process.env, timeoutMs: 30_000, succeeded: () => true, onEnd: resolve, ...spec });
  assert.ok(started.ok, "시작한다");
  return { id: started.id, done };
}

test("종료 코드 0이고 성공 판정이 맞으면 성공. 두 출력의 줄을 모은다", async () => {
  const { done } = run({ script: script(`console.log("받는 중"); console.error("경고 한 줄"); console.log("끝")`) });
  const info = await done;
  assert.equal(info.state, "succeeded");
  assert.equal(info.reason, null);
  assert.deepEqual([...info.output].sort(), ["경고 한 줄", "끝", "받는 중"].sort());
  assert.equal(jobRunning(), false);
  assert.equal(jobNow()?.state, "succeeded", "끝난 작업은 다음 작업 전까지 남는다");
});

test("작업이 끝나면(성공, 실패 모두) 자리가 빈 것을 알리고, 알림 안에서 다음 작업을 시작할 수 있다", async () => {
  // 앞 테스트의 작업이 끝나며 보낸 알림을 먼저 흘려보낸다
  await new Promise((done) => setImmediate(done));
  const heard: boolean[] = [];
  let next: Promise<ScriptJobInfo> | null = null;
  const off = onJobIdle(() => {
    heard.push(jobRunning());
    if (!next) next = run({ script: script("process.exit(3)") }).done;
  });
  try {
    await run({ script: script("") }).done;
    await new Promise((done) => setImmediate(done));
    assert.deepEqual(heard, [false], "알릴 때는 도는 작업이 없다");
    assert.equal((await next!).exitCode, 3);
    await new Promise((done) => setImmediate(done));
    assert.equal(heard.length, 2, "실패로 끝나도 알린다");
  } finally {
    off();
  }
});

test("종료 코드 0이어도 성공 판정(가리킴이 목표인가)이 아니면 실패", async () => {
  assert.equal((await run({ script: script(""), succeeded: () => false }).done).reason, "unmet");
  const threw = await run({
    script: script(""),
    succeeded: () => {
      throw new Error("state.json을 읽지 못함");
    },
  }).done;
  assert.equal(threw.reason, "unmet");
  assert.ok(threw.output.includes("state.json을 읽지 못함"));
});

test("종료 코드가 0이 아니면 실패하고 코드를 남긴다", async () => {
  const info = await run({ script: script("process.exit(3)") }).done;
  assert.deepEqual([info.state, info.reason, info.exitCode], ["failed", "exit", 3]);
});

test("도는 작업이 있으면 다음 작업을 시작하지 않는다", async () => {
  const first = run({ script: script("setTimeout(() => {}, 1500)") });
  const second = startJob({ name: "bgutil-install", script: script(""), args: [], cwd: dir, env: process.env, timeoutMs: 30_000, succeeded: () => true });
  assert.equal(second.ok, false);
  assert.equal(!second.ok && second.reason, "busy");
  assert.equal(!second.ok && second.running?.id, first.id);
  await first.done;
});

test("취소는 그 id의 작업만. 손자 프로세스까지 끝난 것을 확인하고 반환한다", async () => {
  const marker = path.join(dir, "grandchild-ran");
  const grandchild = `setTimeout(() => require("fs").writeFileSync(process.env.GRANDCHILD_MARKER, "x"), 2500)`;
  const env = { ...process.env, GRANDCHILD_CODE: grandchild, GRANDCHILD_MARKER: marker };
  const { id, done } = run({ env, script: script(`import { spawn } from "node:child_process"; spawn(process.execPath, ["-e", process.env.GRANDCHILD_CODE], { stdio: "inherit" }); setTimeout(() => {}, 60_000)`) });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await cancelJob(id + 1), "not-running", "늦게 닿은 다른 id");
  assert.equal(jobRunning(), true);
  assert.equal(await cancelJob(id), "cancelled");
  assert.equal(jobRunning(), false, "돌아왔을 때는 끝나 있다");
  assert.equal((await done).reason, "cancelled");
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(fs.existsSync(marker), false, "손자도 끝났다");
  assert.equal(await cancelJob(id), "not-running", "끝난 작업");
});

test("시간 상한을 넘기면 끝내고 실패로 남긴다(종료 코드 0이어도 성공이 아니다)", async () => {
  const info = await run({ script: script("setTimeout(() => {}, 60_000)"), timeoutMs: 300 }).done;
  assert.deepEqual([info.state, info.reason], ["failed", "timeout"]);
});

test("봇이 종료 중이면 시작하지 않는다", () => {
  beginShutdown();
  const started = startJob({ name: "ffmpeg-install", script: script(""), args: [], cwd: dir, env: process.env, timeoutMs: 30_000, succeeded: () => true });
  assert.equal(!started.ok && started.reason, "stopping");
});

test("출력: 조각 경계에 걸린 UTF-8, \\r 줄바꿈, 색 코드, 긴 줄, 줄 수 상한", async () => {
  const body = `
    const han = Buffer.from("한글 줄\\n");
    process.stdout.write(han.subarray(0, 2));
    await new Promise((r) => setTimeout(r, 50));
    process.stdout.write(han.subarray(2));
    process.stdout.write("10%\\r50%\\r100%\\n");
    process.stdout.write("\\x1b[32m초록\\x1b[0m\\n");
    process.stdout.write("x".repeat(${LINE_CHARS + 10}) + "\\n");
    for (let i = 0; i < ${KEEP_LINES + 5}; i++) process.stdout.write("줄 " + i + "\\n");
    process.stdout.write("마지막 줄(줄바꿈 없음)");
  `;
  const info = await run({ script: script(body) }).done;
  assert.equal(info.output.length, KEEP_LINES);
  assert.equal(info.output.at(-1), "마지막 줄(줄바꿈 없음)");
  const early = await run({ script: script(body.replace(/for \(.*\n/, "")) }).done;
  assert.deepEqual(early.output.slice(0, 5), ["한글 줄", "10%", "50%", "100%", "초록"]);
  assert.equal(early.output[5]?.length, LINE_CHARS + 1, "한 줄 상한에서 자르고 표시를 붙인다");
});

test("봇 종료 시 stopJob: 실행 중인 작업을 취소할 때처럼 중단하고 이름을 반환한다. 없으면 null", async () => {
  assert.equal(await stopJob(), null);
  const { done } = run({ name: "bgutil-install", script: script("setTimeout(() => {}, 60_000)") });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await stopJob(), "bgutil-install");
  assert.equal(jobRunning(), false);
  assert.equal((await done).reason, "cancelled");
});

test("스크립트가 끝난 뒤 손자 프로세스가 출력 파이프를 물고 있어도 상한(3초)이 지나면 작업이 끝난다", async () => {
  const started = Date.now();
  // 손자 프로세스의 작업 폴더는 테스트 폴더 밖에 둔다(Windows는 작업 폴더로 쓰이는 폴더를 지우지 못한다)
  const body = `import { spawn } from "node:child_process"; import os from "node:os"; spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "inherit", detached: true, cwd: os.tmpdir() }).unref(); console.log("끝")`;
  const info = await run({ script: script(body) }).done;
  assert.equal(info.state, "succeeded");
  assert.ok(Date.now() - started < 20_000, `${Date.now() - started}ms`);
  assert.equal(jobRunning(), false, "다음 작업을 막지 않는다");
});

test("줄바꿈 없이 이어지는 출력도 한 줄 상한마다 끊어 내보내 메모리에 끝없이 쌓이지 않는다", async () => {
  const info = await run({ script: script(`process.stdout.write("y".repeat(${LINE_CHARS * 3 + 5}))`) }).done;
  assert.deepEqual(
    info.output.map((line) => line.length),
    [LINE_CHARS, LINE_CHARS, LINE_CHARS, 5],
  );
});
