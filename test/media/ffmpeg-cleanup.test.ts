// src/media/ffmpeg/cleanup.ts: vendor/ffmpeg 정리. 기동 정리(가리키지 않는 버전 폴더, 끝난 임시 폴더, 휴지통)와
// 초기화 카드의 이전 설치본 지우기(봇이 쓰는 ffmpeg가 든 폴더, PATH의 폴더가 든 폴더, 하나뿐인 빌드는 남긴다)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readState, writeState, type FfmpegState } from "../../src/media/ffmpeg/state.ts";
import { cleanupFfmpeg, previewFfmpegCleanup } from "../../src/media/ffmpeg/cleanup.ts";
import { acquireInstanceLock } from "../../src/infra/instance-lock.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-cleanup-"));
after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
let n = 0;
const fresh = () => {
  const dir = path.join(base, `dir-${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const R = "autobuild-2026-10-31-12-59";
const P = "autobuild-2026-09-30-12-59";
const build = (folder: string, release = R) => ({ folder, release, asset: "a.zip", sha256: "x", version: "n9" });
const BIN = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
// 테스트는 이 프로세스의 PATH를 보지 않는다
const NO_PATH = "";

/** 버전 폴더(실행 파일 하나)를 만든다 */
function folder(dir: string, name: string, bytes = 10) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, BIN), Buffer.alloc(bytes));
}
/** 보통의 모양: 지금 설치본(R), 이전 설치본(P) */
function usual(): { dir: string; state: FfmpegState; active: string; previous: string } {
  const dir = fresh();
  const active = `${R}-2`;
  const previous = `${P}-1`;
  folder(dir, active, 100);
  folder(dir, previous, 30);
  const state: FfmpegState = { active: build(active), previous: build(previous, P), rejected: [], pin: null };
  writeState(dir, state);
  return { dir, state, active, previous };
}
const stateOf = (dir: string) => {
  const read = readState(dir);
  assert.equal(read.kind, "ok");
  return (read as { state: FfmpegState }).state;
};
const names = (dir: string) => fs.readdirSync(dir).sort();

test("기동 정리: 가리키지 않는 버전 폴더, 끝난 프로세스의 임시 폴더, 휴지통만 지운다", async () => {
  const dir = fresh();
  for (const name of [`${R}-1`, `${R}-2`, `${R}-3`, ".staging-111-5", ".staging-222-6", ".trash-x-1-2", "모르는-폴더"]) fs.mkdirSync(path.join(dir, name));
  writeState(dir, { active: build(`${R}-2`), previous: build(`${R}-3`), rejected: [], pin: null });
  const done = await cleanupFfmpeg(dir, { alive: (pid) => pid === 222, pathEnv: NO_PATH });
  assert.equal(done.kind, "ok");
  assert.deepEqual((done as { removed: { name: string }[] }).removed.map((r) => r.name).sort(), [".staging-111-5", ".trash-x-1-2", `${R}-1`].sort());
  assert.deepEqual(names(dir), [".staging-222-6", `${R}-2`, `${R}-3`, "state.json", "모르는-폴더"].sort());
});

test("기록을 읽지 못하면 아무것도 지우지 않는다(미리 보기도 broken)", async () => {
  const dir = fresh();
  folder(dir, `${R}-1`);
  fs.writeFileSync(path.join(dir, "state.json"), "{ 깨짐");
  assert.deepEqual(await cleanupFfmpeg(dir, { dropPrevious: true, inUse: "ffmpeg", pathEnv: NO_PATH }), { kind: "broken" });
  assert.deepEqual(await previewFfmpegCleanup(dir, { pathEnv: NO_PATH }), { kind: "broken" });
  assert.equal(fs.existsSync(path.join(dir, `${R}-1`)), true);
});

test("이전 설치본 지우기: 지금 설치본을 쓰면 이전 설치본 폴더와 기록을 지우고 크기를 센다", async () => {
  const { dir, active, previous } = usual();
  folder(dir, `${R}-0`, 7);
  const inUse = path.join(dir, active, BIN);
  const preview = await previewFfmpegCleanup(dir, { inUse, dropPrevious: true, pathEnv: NO_PATH });
  assert.deepEqual(preview, {
    kind: "ok",
    doomed: [
      { name: `${R}-0`, release: R },
      { name: previous, release: P },
    ].sort((a, b) => a.name.localeCompare(b.name)),
    kept: [],
    bytes: 37,
  });
  const done = await cleanupFfmpeg(dir, { inUse, dropPrevious: true, pathEnv: NO_PATH });
  assert.equal(done.kind, "ok");
  const ok = done as Extract<typeof done, { kind: "ok" }>;
  assert.equal(ok.dropped?.folder, previous);
  assert.deepEqual(
    ok.removed.map((r) => [r.name, r.bytes]).sort(),
    [
      [`${R}-0`, 7],
      [previous, 30],
    ].sort(),
  );
  assert.deepEqual(names(dir), [active, "state.json"]);
  assert.equal(stateOf(dir).previous, null);
  assert.equal(stateOf(dir).active?.folder, active);
});

test("이전 설치본 지우기: 봇이 이전 설치본으로 떴으면(대비책, 터미널 설치 뒤) 남기고 기록도 그대로", async () => {
  const { dir, state, previous } = usual();
  const done = await cleanupFfmpeg(dir, { inUse: path.join(dir, previous, BIN), dropPrevious: true, pathEnv: NO_PATH });
  assert.deepEqual(done.kind === "ok" && done.kept, [{ name: previous, reason: "in-use" }]);
  assert.equal(done.kind === "ok" && done.dropped, null);
  assert.deepEqual(stateOf(dir), state);
  assert.equal(fs.existsSync(path.join(dir, previous, BIN)), true);
});

test("이전 설치본 지우기: 기록에서 빠진 폴더라도 봇이 쓰는 폴더는 남긴다(터미널에서 두 번 받은 뒤)", async () => {
  const { dir, active, previous } = usual();
  const running = `${R}-0`;
  folder(dir, running);
  const done = await cleanupFfmpeg(dir, { inUse: path.join(dir, running, BIN), dropPrevious: true, pathEnv: NO_PATH });
  assert.deepEqual(done.kind === "ok" && done.kept, [{ name: running, reason: "in-use" }]);
  assert.deepEqual(names(dir), [running, active, "state.json"].sort());
  assert.equal(stateOf(dir).previous, null, previous);
});

test("이전 설치본 지우기: FFMPEG_PATH, PATH의 ffmpeg를 쓰면 이전 설치본을 지운다", async () => {
  for (const inUse of ["ffmpeg", path.join(base, "elsewhere", BIN)]) {
    const { dir, active } = usual();
    const done = await cleanupFfmpeg(dir, { inUse, dropPrevious: true, pathEnv: NO_PATH });
    assert.equal(done.kind === "ok" && done.dropped !== null, true, inUse);
    assert.deepEqual(names(dir), [active, "state.json"]);
  }
});

test("이전 설치본 지우기: 지금 설치본이 없으면 이전 설치본이 하나뿐인 빌드라 남긴다", async () => {
  const dir = fresh();
  folder(dir, `${P}-1`);
  writeState(dir, { active: null, previous: build(`${P}-1`, P), rejected: [], pin: null });
  const done = await cleanupFfmpeg(dir, { inUse: "ffmpeg", dropPrevious: true, pathEnv: NO_PATH });
  assert.deepEqual(done.kind === "ok" && done.kept, [{ name: `${P}-1`, reason: "only-build" }]);
  assert.equal(fs.existsSync(path.join(dir, `${P}-1`)), true);
  assert.notEqual(stateOf(dir).previous, null);
});

test("PATH의 폴더가 든 폴더는 남긴다(PATH의 ffmpeg는 경로가 이름뿐이라 그쪽으로 판단한다)", async () => {
  const { dir, previous } = usual();
  const done = await cleanupFfmpeg(dir, { inUse: "ffmpeg", dropPrevious: true, pathEnv: [path.join(base, "nowhere"), path.join(dir, previous)].join(path.delimiter) });
  assert.deepEqual(done.kind === "ok" && done.kept, [{ name: previous, reason: "in-use" }]);
  assert.equal(fs.existsSync(path.join(dir, previous)), true);
});

test("Windows: 대소문자만 다른 경로도 쓰는 폴더로 본다", { skip: process.platform !== "win32" }, async () => {
  const { dir, previous } = usual();
  const done = await cleanupFfmpeg(dir, { inUse: path.join(dir, previous, BIN).toUpperCase(), dropPrevious: true, pathEnv: NO_PATH });
  assert.deepEqual(done.kind === "ok" && done.kept, [{ name: previous, reason: "in-use" }]);
});

test("휴지통 이름으로 못 바꾸면(안의 파일이 열려 있다) 폴더와 기록을 그대로 둔다. 바쁨 코드면 다시 해 본다", async () => {
  const { dir, state, active, previous } = usual();
  const inUse = path.join(dir, active, BIN);
  const locked = () => Promise.reject(Object.assign(new Error("열려 있음"), { code: "ENOTEMPTY" }));
  const done = await cleanupFfmpeg(dir, { inUse, dropPrevious: true, pathEnv: NO_PATH, rename: locked });
  assert.deepEqual(done.kind === "ok" && done.kept, [{ name: previous, reason: "rename-failed" }]);
  assert.deepEqual(stateOf(dir), state);

  let tries = 0;
  const busyOnce = (from: string, to: string) => (++tries === 1 ? Promise.reject(Object.assign(new Error("백신"), { code: "EBUSY" })) : fs.promises.rename(from, to));
  const again = await cleanupFfmpeg(dir, { inUse, dropPrevious: true, pathEnv: NO_PATH, rename: busyOnce });
  assert.equal(again.kind === "ok" && again.dropped?.folder, previous);
  assert.equal(tries, 2);
  assert.deepEqual(names(dir), [active, "state.json"]);
});

test("기록 쓰기가 실패하면 옮긴 이전 설치본을 제자리로 되돌린다", async () => {
  const { dir, state, active, previous } = usual();
  // 옮긴 뒤 기록의 임시 파일 자리에 폴더를 두어 쓰기를 실패시킨다
  const rename = async (from: string, to: string) => {
    await fs.promises.rename(from, to);
    fs.mkdirSync(path.join(dir, `state.json.${process.pid}.tmp`), { recursive: true });
  };
  await assert.rejects(cleanupFfmpeg(dir, { inUse: path.join(dir, active, BIN), dropPrevious: true, pathEnv: NO_PATH, rename }));
  assert.equal(fs.existsSync(path.join(dir, previous, BIN)), true);
  assert.deepEqual(stateOf(dir), state);
});

test("세션 확인(go)이 던지면 아무것도 바꾸지 않는다", async () => {
  const { dir, state, active, previous } = usual();
  const go = () => {
    throw new Error("로그아웃");
  };
  await assert.rejects(cleanupFfmpeg(dir, { inUse: path.join(dir, active, BIN), dropPrevious: true, pathEnv: NO_PATH, go }), /로그아웃/);
  assert.deepEqual(stateOf(dir), state);
  assert.equal(fs.existsSync(path.join(dir, previous)), true);
});

test("다른 프로세스가 폴더 잠금을 쥐고 있으면 busy(받는 중)", async () => {
  const { dir, state } = usual();
  const held = await acquireInstanceLock(dir);
  assert.equal(held.ok, true);
  try {
    const done = await cleanupFfmpeg(dir, { inUse: "ffmpeg", dropPrevious: true, pathEnv: NO_PATH });
    assert.equal(done.kind, "busy");
    assert.deepEqual(stateOf(dir), state);
  } finally {
    if (held.ok) await held.release();
  }
});

test("링크는 따라가지도 지우지도 않는다", async () => {
  const { dir, active, previous } = usual();
  const outside = path.join(base, `outside-${n}`);
  folder(outside, "keep");
  const link = path.join(dir, `${R}-9`);
  fs.symlinkSync(path.join(outside, "keep"), link, "junction");
  await cleanupFfmpeg(dir, { inUse: path.join(dir, active, BIN), dropPrevious: true, pathEnv: NO_PATH });
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(outside, "keep", BIN)), true);
  assert.equal(fs.existsSync(path.join(dir, previous)), false);
  // 뒷정리가 링크를 따라 밖을 지우지 않게 링크부터 뗀다
  fs.unlinkSync(link);
  assert.equal(fs.existsSync(path.join(outside, "keep", BIN)), true);
});
