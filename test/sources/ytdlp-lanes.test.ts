// src/sources/ytdlp-spawn.ts — yt-dlp 의 줄(곡 찾기 · 다운로드 · 미리 받기), 영상 정보 추출 세기, 멎은 다운로드 내리기.
// 가짜 실행기(pid 없음)로 줄을 보고, 내리는 길은 말이 없는 진짜 자식 프로세스로 본다

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import run, { useExec, useInfoTimeout, useLaneSizes, useStallWatch, ytdlpLoad, autoSlots, familyOf, type Exec, type YtDlpError } from "../../src/sources/ytdlp-spawn.ts";
import { inGuild } from "../../src/infra/guild-context.ts";

const GB = 1024 ** 3;
const tick = () => new Promise((done) => setTimeout(done, 20));
// 가짜가 끝나지 않으면 기다리는 약속이 풀리지 않는다. 걸리면 멈추지 않고 실패하게
const HELD = { timeout: 5_000 };

// 부른 차례와, 하나씩 끝낼 수 있는 가짜 실행. finish(url) 로 끝낸다(fail 이면 실패)
function heldExec() {
  const started: string[] = [];
  const pending = new Map<string, { ok: () => void; fail: () => void }>();
  const exec = ((url: string) => {
    started.push(url);
    return new Promise((resolve, reject) => {
      pending.set(url, { ok: () => resolve({ stdout: "{}", stderr: "" }), fail: () => reject(Object.assign(new Error("exit 1"), { stderr: "ERROR: x", exitCode: 1 })) });
    });
  }) as unknown as Exec;
  const finish = (url: string, fail = false) => {
    const one = pending.get(url);
    pending.delete(url);
    if (fail) one?.fail();
    else one?.ok();
  };
  return { exec, started, finish };
}

let children: ChildProcess[] = [];
// 말이 없는 진짜 자식. ms 뒤에 스스로 끝난다(없으면 내릴 때까지)
const sleeper = (ms?: number) =>
  ((..._args: unknown[]) => {
    const proc = spawn(process.execPath, ["-e", ms ? `setTimeout(() => {}, ${ms})` : "setTimeout(() => {}, 600000)"], { windowsHide: true });
    children.push(proc);
    const done = new Promise((resolve, reject) => {
      proc.on("exit", (code) => (code === 0 ? resolve({ stdout: "", stderr: "" }) : reject(Object.assign(new Error("killed"), { stderr: "", exitCode: code }))));
    });
    return Object.assign(done, proc);
  }) as unknown as Exec;

afterEach(() => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  children = [];
  useExec(null);
  useInfoTimeout(null);
  useLaneSizes(null);
  useStallWatch(null);
});

test("줄 크기는 메모리로: 곡 찾기는 2GB 마다 하나(2 ~ 8), 다운로드는 4GB 마다 하나(2 ~ 4). 프로세스에 걸린 상한이 있으면 그것으로", () => {
  const sizes = (constrained: number, total: number) => Object.values(autoSlots(constrained, total));
  assert.deepEqual(sizes(0, 16 * GB), [8, 4]);
  assert.deepEqual(sizes(0, 64 * GB), [8, 4]);
  assert.deepEqual(sizes(0, 12 * GB), [6, 3]);
  assert.deepEqual(sizes(0, 8 * GB), [4, 2]);
  assert.deepEqual(sizes(0, 4 * GB), [2, 2]);
  assert.deepEqual(sizes(0, 2 * GB), [2, 2]);
  assert.deepEqual(sizes(6 * GB, 64 * GB), [3, 2], "컨테이너 상한");
  assert.deepEqual(sizes(2 ** 62, 4 * GB), [2, 2], "상한이 없다는 큰 값이면 전체 메모리");
});

test("곡 찾기는 상한까지만 돌고 나머지는 차례로. 실패해도 자리를 돌려준다", HELD, async () => {
  const { exec, started, finish } = heldExec();
  useExec(exec);
  useLaneSizes({ lookup: 2, background: 1 });
  const calls = ["a", "b", "c"].map((id) => run(`https://youtu.be/${id}`, { dumpSingleJson: true }).catch(() => "실패"));
  await tick();
  assert.deepEqual(started, ["https://youtu.be/a", "https://youtu.be/b"]);
  assert.deepEqual(ytdlpLoad().lookup, { running: 2, size: 2, waiting: 1 });
  finish("https://youtu.be/a", true);
  await tick();
  assert.deepEqual(started.at(-1), "https://youtu.be/c");
  finish("https://youtu.be/b");
  finish("https://youtu.be/c");
  assert.deepEqual(await Promise.all(calls), ["실패", {}, {}]);
  assert.equal(ytdlpLoad().lookup.running, 0);
});

test("다운로드 · 미리 받기는 곡 찾기를 막지 않는다", HELD, async () => {
  const { exec, started, finish } = heldExec();
  useExec(exec);
  useLaneSizes({ lookup: 1, background: 1 });
  const download = run("https://youtu.be/d", { output: path.join(os.tmpdir(), "lanes-none.opus") });
  const prefetch = inGuild("g", () => run("https://youtu.be/p", { dumpSingleJson: true }), "prefetch");
  const lookup = run("https://youtu.be/l", { dumpSingleJson: true });
  await tick();
  assert.deepEqual(started, ["https://youtu.be/d", "https://youtu.be/l"], "미리 받기의 정보 호출은 뒤 줄에서 다운로드를 기다린다");
  assert.deepEqual(ytdlpLoad().background, { running: 1, size: 1, waiting: 1 });
  for (const url of ["https://youtu.be/l", "https://youtu.be/d"]) finish(url);
  await tick();
  finish("https://youtu.be/p");
  await Promise.all([download, prefetch, lookup]);
});

test("뒤 줄에서는 지금 곡의 다운로드가 미리 받기보다 먼저, 다시 묻기는 줄 맨 앞", HELD, async () => {
  const { exec, started, finish } = heldExec();
  useExec(exec);
  useLaneSizes({ lookup: 1, background: 1 });
  const out = (name: string) => path.join(os.tmpdir(), `lanes-${name}.opus`);
  const first = run("https://youtu.be/first", { output: out("first") });
  await tick();
  const waiting = [inGuild("g", () => run("https://youtu.be/prefetch", { output: out("prefetch") }), "prefetch"), run("https://youtu.be/now", { output: out("now") }), inGuild("g", () => run("https://youtu.be/retry", { output: out("retry") }, { retry: true }), "prefetch")];
  await tick();
  for (const url of ["first", "retry", "now", "prefetch"].map((id) => `https://youtu.be/${id}`)) {
    finish(url);
    await tick();
  }
  assert.deepEqual(
    started,
    ["first", "retry", "now", "prefetch"].map((id) => `https://youtu.be/${id}`),
  );
  await Promise.all([first, ...waiting]);
});

test("줄에서 기다린 시간은 정보 호출의 한도에 들지 않는다", { timeout: 10_000 }, async () => {
  useExec(sleeper(400));
  useInfoTimeout(600);
  useLaneSizes({ lookup: 1, background: 1 });
  const results = await Promise.all([run("https://youtu.be/a", { dumpSingleJson: true }), run("https://youtu.be/b", { dumpSingleJson: true })]);
  assert.deepEqual(results, ["", ""], "둘째는 400ms 기다리고 400ms 돌아도 한도(600ms) 안이다");
});

test("기다리다 끊기면 줄에서 빠진다", HELD, async () => {
  const { exec, finish } = heldExec();
  useExec(exec);
  useLaneSizes({ lookup: 1, background: 1 });
  const holding = run("https://youtu.be/hold", { output: path.join(os.tmpdir(), "lanes-hold.opus") });
  const controller = new AbortController();
  const waiting = run("https://youtu.be/w", { output: path.join(os.tmpdir(), "lanes-w.opus") }, { signal: controller.signal });
  await tick();
  controller.abort(new Error("그만"));
  await assert.rejects(waiting, /그만/);
  assert.equal(ytdlpLoad().background.waiting, 0);
  finish("https://youtu.be/hold");
  await holding;
});

test("유튜브 영상 정보 추출만 센다(검색 · 재생목록 펼치기 · 다른 사이트는 빼고)", HELD, async () => {
  useExec((() => Promise.resolve({ stdout: "{}", stderr: "" })) as unknown as Exec);
  const before = ytdlpLoad().extractedLastHour;
  await run("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { dumpSingleJson: true });
  await run("https://youtu.be/dQw4w9WgXcQ", { output: path.join(os.tmpdir(), "lanes-count.opus") });
  await run("ytsearch5:곡", { dumpSingleJson: true, flatPlaylist: true });
  await run("https://www.youtube.com/playlist?list=PL1", { dumpSingleJson: true, flatPlaylist: true });
  await run("https://soundcloud.com/a/b", { dumpSingleJson: true });
  assert.equal(ytdlpLoad().extractedLastHour - before, 2);
});

test("다운로드 파일 묶음: 출력 이름으로 시작하는 것, 템플릿이면 그 앞까지", () => {
  const plain = familyOf(path.join("cache", "abc.tmp-1-ff.opus"));
  assert.equal(plain.dir, "cache");
  for (const name of ["abc.tmp-1-ff.opus", "abc.tmp-1-ff.opus.part", "abc.tmp-1-ff.webm.part-Frag3", "abc.tmp-1-ff.info.json"]) assert.equal(plain.has(name), true, name);
  for (const name of ["abc.opus", "abc.tmp-1-ffx.opus", "other.opus"]) assert.equal(plain.has(name), false, name);
  const template = familyOf(path.join("bg", "download.%(ext)s"));
  for (const name of ["download.webm", "download.webm.part", "download.info.json"]) assert.equal(template.has(name), true, name);
  assert.equal(template.has("downloads.webm"), false);
});

test("다운로드는 파일 묶음이 한도 동안 그대로면 내리고 연결 오류로 실패한다", { timeout: 10_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-stall-"));
  try {
    useExec(sleeper());
    useStallWatch({ everyMs: 50, limitMs: 300 });
    fs.writeFileSync(path.join(dir, "x.opus.part"), "a");
    const started = Date.now();
    const error = await run("https://youtu.be/x", { output: path.join(dir, "x.opus") }).then(
      () => null,
      (e: YtDlpError) => e,
    );
    assert.equal(error?.code, "network-error");
    assert.match(String(error?.message), /나아가지 않아/);
    // 가짜 yt-dlp 는 10분 돈다. 그보다 훨씬 먼저 끊는다(자식 프로세스를 띄우고 죽이는 시간은 부하에 따라 흔들려 넉넉히 둔다)
    assert.ok(Date.now() - started < 8000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("다운로드는 파일 묶음이 바뀌는 동안 둔다(크기가 줄어도)", { timeout: 10_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-busy-"));
  try {
    useExec(sleeper(900));
    useStallWatch({ everyMs: 50, limitMs: 300 });
    const part = path.join(dir, "x.opus.part");
    let n = 0;
    const writer = setInterval(() => fs.writeFileSync(part, "a".repeat(n++ % 2 ? 10 : 5)), 100);
    try {
      assert.equal(await run("https://youtu.be/x", { output: path.join(dir, "x.opus") }), "");
    } finally {
      clearInterval(writer);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
