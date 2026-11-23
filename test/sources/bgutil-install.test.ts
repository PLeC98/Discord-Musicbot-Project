// src/sources/bgutil/: 버전 폴더에 받기(install), 기록(state), 봇이 읽는 번들(bundle), 기동 정리(cleanup), 실행 테스트(trial).
// 받기의 체크아웃, npm, tsc, 실행 테스트는 가짜다(가짜 체크아웃은 server/package.json과 lockfile을 쓰고, 가짜 tsc가 build/main.js를 쓴다).
// 실행 테스트 자체는 /ping에 응답하는 작은 가짜 서버 파일을 실제로 띄운다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installBgutil, type InstallIo } from "../../src/sources/bgutil/install.ts";
import { readState, writeState, type BgutilState } from "../../src/sources/bgutil/state.ts";
import { readBundle } from "../../src/sources/bgutil/bundle.ts";
import { cleanupBgutil } from "../../src/sources/bgutil/cleanup.ts";
import { trialRun } from "../../src/sources/bgutil/trial.ts";
import { asText } from "../../src/infra/log/log-text.ts";
import { acquireInstanceLock } from "../../src/infra/instance-lock.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "bgutil-install-"));
after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
let n = 0;
const fresh = () => {
  const dir = path.join(base, `dir-${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const TAG = "1.2.2";
const COMMIT = "a".repeat(40);
const OTHER = "b".repeat(40);

/** 버전 폴더 하나(체크아웃, 빌드 결과)를 만든다 */
function built(dir: string, folder: string, version = TAG) {
  const server = path.join(dir, folder, "server");
  fs.mkdirSync(path.join(server, "build"), { recursive: true });
  fs.mkdirSync(path.join(dir, folder, "plugin", "yt_dlp_plugins"), { recursive: true });
  fs.writeFileSync(path.join(server, "build", "main.js"), "");
  fs.writeFileSync(path.join(server, "package.json"), JSON.stringify({ version }));
}
const build = (folder: string, tag = TAG, commit = COMMIT) => ({ folder, tag, commit, version: tag });
const stateOf = (dir: string): BgutilState => {
  const read = readState(dir);
  assert.equal(read.kind, "ok");
  return (read as { state: BgutilState }).state;
};
const names = (dir: string) => fs.readdirSync(dir).sort();

/**
 * 가짜 입출력. version: 가짜 체크아웃의 서버 버전, scripts: 서버 package.json의 scripts, trialOk: 실행 테스트 결과.
 * during: 체크아웃한 뒤 할 일(다른 프로세스가 먼저 옮기는 것을 흉내 낸다). calls: 부른 순서
 */
function fakeIo(over: { version?: string; scripts?: Record<string, string>; trialOk?: boolean; during?: () => void; clock?: number } = {}) {
  const calls: string[] = [];
  let clock = over.clock ?? 1_800_000_000_000;
  const io: InstallIo = {
    checkout: async (repoDir, tag, commit) => {
      calls.push(`checkout ${tag} ${commit.slice(0, 4)}`);
      assert.equal(fs.existsSync(repoDir), false, "체크아웃은 아직 없는 경로에 한다");
      const server = path.join(repoDir, "server");
      fs.mkdirSync(server, { recursive: true });
      fs.mkdirSync(path.join(repoDir, "plugin", "yt_dlp_plugins"), { recursive: true });
      fs.writeFileSync(path.join(server, "package.json"), JSON.stringify({ version: over.version ?? tag, scripts: over.scripts ?? {} }));
      fs.writeFileSync(path.join(server, "package-lock.json"), JSON.stringify({ packages: { "node_modules/canvas": { hasInstallScript: true } } }));
      over.during?.();
    },
    npmCi: async () => void calls.push("npm ci"),
    npmRebuild: async (_dir, names) => void calls.push(`npm rebuild ${names.join(" ")}`),
    tsc: async (serverDir) => {
      calls.push("tsc");
      fs.mkdirSync(path.join(serverDir, "build"), { recursive: true });
      fs.writeFileSync(path.join(serverDir, "build", "main.js"), "");
    },
    trial: async (_dir, expected) => (calls.push(`trial ${expected}`), over.trialOk === false ? { ok: false, reason: "응답하지 않음" } : { ok: true }),
    now: () => clock++,
    pid: 4242,
    log: () => undefined,
  };
  return { io, calls };
}

test("기록: 형식이 올바르지 않으면 broken(폴더 이름이 밖을 가리킴, 태그 모양, 커밋 길이, 깨진 JSON)", () => {
  for (const text of [JSON.stringify({ active: build("../x-1800000000000") }), JSON.stringify({ active: build(`${TAG}-1800000000000`, "--x") }), JSON.stringify({ active: build(`${TAG}-1800000000000`, TAG, "abc") }), "{ 깨짐"]) {
    const dir = fresh();
    fs.writeFileSync(path.join(dir, "state.json"), text);
    assert.equal(readState(dir).kind, "broken", text);
  }
  assert.deepEqual(readState(fresh()), { kind: "none" });
});

test("받기: 체크아웃, 설치, 다시 빌드, tsc, 실행 테스트 뒤 버전 폴더로 옮기고 가리킨다. 임시 폴더는 남지 않는다", async () => {
  const dir = fresh();
  const { io, calls } = fakeIo();
  const done = await installBgutil({ dir, tag: TAG, commit: COMMIT, io });
  assert.equal(done.kind, "installed");
  assert.deepEqual(calls, [`checkout ${TAG} aaaa`, "npm ci", "npm rebuild canvas", "tsc", `trial ${TAG}`]);
  const state = stateOf(dir);
  assert.equal(state.active?.tag, TAG);
  assert.equal(state.active?.commit, COMMIT);
  assert.equal(state.previous, null);
  assert.deepEqual(names(dir), [state.active!.folder, "state.json"].sort());
  assert.ok(fs.existsSync(path.join(dir, state.active!.folder, "server", "build", "main.js")));
});

test("받기: 이미 그 태그와 커밋이면 받지 않고, --force면 새 폴더에 다시 받아 앞의 것을 이전 빌드로", async () => {
  const dir = fresh();
  built(dir, `${TAG}-1700000000000`);
  writeState(dir, { active: build(`${TAG}-1700000000000`), previous: null });
  const same = fakeIo();
  assert.equal((await installBgutil({ dir, tag: TAG, commit: COMMIT, io: same.io })).kind, "unchanged");
  assert.deepEqual(same.calls, []);
  const forced = fakeIo();
  assert.equal((await installBgutil({ dir, tag: TAG, commit: COMMIT, force: true, io: forced.io })).kind, "installed");
  assert.equal(stateOf(dir).previous?.folder, `${TAG}-1700000000000`);
});

test("받기: 다른 태그를 받으면 쓰던 것이 이전 빌드가 된다", async () => {
  const dir = fresh();
  built(dir, `1.1.0-1700000000000`, "1.1.0");
  writeState(dir, { active: build(`1.1.0-1700000000000`, "1.1.0", OTHER), previous: build(`1.0.0-1600000000000`, "1.0.0", OTHER) });
  const done = await installBgutil({ dir, tag: TAG, commit: COMMIT, io: fakeIo().io });
  assert.deepEqual(done.kind === "installed" && done.from, "1.1.0");
  assert.equal(stateOf(dir).previous?.tag, "1.1.0");
});

test("받기: 실행 테스트가 실패하거나 루트 설치 스크립트가 생겼으면 가리킴은 그대로이고 받은 것은 지운다", async () => {
  for (const over of [{ trialOk: false }, { scripts: { postinstall: "node evil.js" } }, { version: "9.9.9" }]) {
    const dir = fresh();
    built(dir, `1.1.0-1700000000000`, "1.1.0");
    const before: BgutilState = { active: build(`1.1.0-1700000000000`, "1.1.0", OTHER), previous: null };
    writeState(dir, before);
    const { io } = fakeIo({ ...over, trialOk: over.version ? false : over.trialOk });
    const done = await installBgutil({ dir, tag: TAG, commit: COMMIT, io });
    assert.equal(done.kind, "failed", JSON.stringify(over));
    assert.deepEqual(stateOf(dir), before);
    assert.deepEqual(names(dir), [`1.1.0-1700000000000`, "state.json"], "임시 폴더를 지운다");
  }
});

test("받기: 받는 사이 다른 프로세스가 같은 것을 먼저 옮겼으면 내 것을 버리고 unchanged(이전 빌드가 쌍둥이가 되지 않는다)", async () => {
  const dir = fresh();
  built(dir, `1.1.0-1700000000000`, "1.1.0");
  writeState(dir, { active: build(`1.1.0-1700000000000`, "1.1.0", OTHER), previous: null });
  const during = () => {
    built(dir, `${TAG}-1750000000000`);
    writeState(dir, { active: build(`${TAG}-1750000000000`), previous: build(`1.1.0-1700000000000`, "1.1.0", OTHER) });
  };
  const done = await installBgutil({ dir, tag: TAG, commit: COMMIT, io: fakeIo({ during }).io });
  assert.equal(done.kind, "unchanged");
  assert.deepEqual(stateOf(dir), { active: build(`${TAG}-1750000000000`), previous: build(`1.1.0-1700000000000`, "1.1.0", OTHER) });
  assert.deepEqual(names(dir), [`1.1.0-1700000000000`, `${TAG}-1750000000000`, "state.json"].sort());
});

test("받기: 기록이 깨져 있으면 옮겨 두고 새로 기록한다(알릴 줄)", async () => {
  const dir = fresh();
  fs.writeFileSync(path.join(dir, "state.json"), "{ 깨짐");
  const done = await installBgutil({ dir, tag: TAG, commit: COMMIT, io: fakeIo().io });
  assert.equal(done.kind, "installed");
  assert.equal(done.notes.length, 1);
  assert.ok(names(dir).some((name) => name.startsWith("state.json.broken-")));
});

test("받기: 옮길 때 다른 프로세스가 폴더 잠금을 풀지 않으면 busy(가리킴은 그대로, 받은 것은 지운다)", async (t) => {
  const dir = fresh();
  const held = await acquireInstanceLock(dir);
  assert.equal(held.ok, true);
  t.after(() => (held.ok ? held.release() : undefined));
  const done = await installBgutil({ dir, tag: TAG, commit: COMMIT, io: fakeIo().io, lockWaitMs: 600 });
  assert.equal(done.kind, "busy");
  assert.deepEqual(readState(dir), { kind: "none" });
  assert.equal(
    fs.readdirSync(dir).some((name) => name.startsWith(".staging-")),
    false,
  );
});

test("묶음: 기록의 지금 빌드를 읽는다. 기록이 없거나 깨졌거나 실행 파일이 없으면 null", () => {
  const dir = fresh();
  assert.equal(readBundle(dir), null);
  built(dir, `${TAG}-1700000000000`);
  writeState(dir, { active: build(`${TAG}-1700000000000`), previous: null });
  const bundle = readBundle(dir);
  assert.deepEqual(bundle && [bundle.root, bundle.serverDir, bundle.version, bundle.tag], [path.join(dir, `${TAG}-1700000000000`), path.join(dir, `${TAG}-1700000000000`, "server"), TAG, TAG]);
  fs.rmSync(path.join(dir, `${TAG}-1700000000000`, "server", "build"), { recursive: true });
  assert.equal(readBundle(dir), null, "실행 파일이 없다");
  fs.writeFileSync(path.join(dir, "state.json"), "{ 깨짐");
  assert.equal(readBundle(dir), null);
});

test("기동 정리: 기록에 없는 버전 폴더와 끝난 받기의 임시 폴더를 지우고, 돌고 있는 서버의 빌드는 기록에 없어도 남긴다", async () => {
  const dir = fresh();
  for (const folder of [`1.0.0-1600000000000`, `1.1.0-1700000000000`, `${TAG}-1750000000000`, `1.0.5-1650000000000`]) built(dir, folder);
  fs.mkdirSync(path.join(dir, ".staging-111-5", "repo"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".staging-222-6", "repo"), { recursive: true });
  writeState(dir, { active: build(`${TAG}-1750000000000`), previous: build(`1.1.0-1700000000000`, "1.1.0") });
  const running = path.join(dir, `1.0.5-1650000000000`, "server", "build", "main.js");
  const done = await cleanupBgutil(dir, { inUse: running, alive: (pid) => pid === 222, pathEnv: "" });
  assert.equal(done.kind, "ok");
  assert.deepEqual(names(dir), [".staging-222-6", `1.0.5-1650000000000`, `1.1.0-1700000000000`, `${TAG}-1750000000000`, "state.json"].sort());
});

test("실행 테스트: /ping이 기대한 버전으로 답하면 ok, 다른 버전이면 실패. 어느 쪽이든 서버가 끝난 뒤에 돌아간다", { timeout: 60_000 }, async () => {
  const server = path.join(fresh(), "server");
  fs.mkdirSync(path.join(server, "build"), { recursive: true });
  // bgutil 서버처럼 -p 포트, -H 주소로 열고 /ping에 버전을 답한다
  fs.writeFileSync(
    path.join(server, "build", "main.js"),
    `const http = require("node:http");
const argv = process.argv;
const port = Number(argv[argv.indexOf("-p") + 1]);
const host = argv[argv.indexOf("-H") + 1];
http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ version: "1.2.2" })); }).listen(port, host);`,
  );
  fs.writeFileSync(path.join(server, "package.json"), JSON.stringify({ type: "commonjs" }));
  assert.deepEqual(await trialRun(server, "1.2.2"), { ok: true });
  const wrong = await trialRun(server, "2.0.0");
  assert.equal(wrong.ok, false);
  assert.match(!wrong.ok ? asText(wrong.reason) : "", /다른 버전/);
  // 끝났으면 폴더 이름을 바꿀 수 있다(Windows는 실행 중인 파일이 든 폴더를 못 바꾼다)
  fs.renameSync(path.dirname(server), `${path.dirname(server)}-moved`);
});

test("실행 테스트: 응답하기 전에 끝나면 그 사유와 서버 출력 끝부분", { timeout: 60_000 }, async () => {
  const server = path.join(fresh(), "server");
  fs.mkdirSync(path.join(server, "build"), { recursive: true });
  fs.writeFileSync(path.join(server, "build", "main.js"), `console.error("canvas.node를 불러오지 못함"); process.exit(3);`);
  const result = await trialRun(server, "1.2.2");
  assert.equal(result.ok, false);
  assert.match(!result.ok ? asText(result.reason) : "", /끝남\(code=3\).*canvas\.node/);
});
