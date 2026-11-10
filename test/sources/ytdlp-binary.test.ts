// src/sources/ytdlp-binary.ts: yt-dlp 버전을 버전마다 폴더에 두고, 목표 버전(고정, 채널 최신)으로 맞추고, 가리키는 경로만 교체한다. 처음에는 설정과 상관없이 설치한다.
// 릴리스, GitHub 은 가짜다. 가짜 릴리스는 staging/dir 에 실행 파일을 쓰고(내용이 곧 버전), 가짜 실행은 그 내용을 --version 으로 돌려준다. 잠금은 진짜(OS 가 쥐는 것)를 쓴다.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import config from "../../src/config/index.ts";
import { YtdlpBinary, describe, updateText, lockFolder, type YtdlpBinaryIo, type YtdlpRan } from "../../src/sources/ytdlp-binary.ts";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const saved = { ...config.ytdlp };
let root = "";
const dirOf = () => path.join(root, "bin", "yt-dlp");
const names = () => fs.readdirSync(dirOf()).sort();
// 다운로드 중에 쓰는 폴더가 남았나
const staged = () => names().filter((name) => name.startsWith(".staging"));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-bin-"));
  Object.assign(config.ytdlp, { channel: "nightly", version: null, update: "auto" });
});
afterEach(() => {
  Object.assign(config.ytdlp, saved);
  fs.rmSync(root, { recursive: true, force: true });
});

/** 그 버전을 설치해 둔다(버전 폴더와 기록) */
function seed(version: string, { previous = null as string | null } = {}) {
  fs.mkdirSync(path.join(dirOf(), version), { recursive: true });
  fs.writeFileSync(path.join(dirOf(), version, "yt-dlp.exe"), version);
  fs.writeFileSync(path.join(dirOf(), "state.json"), JSON.stringify({ version, previous, lastChecked: 0, unusable: null }));
}

/**
 * 가짜 세상. latest 는 GitHub 의 최신 태그. release 는 태그마다 릴리스가 할 일(쓸 버전, 또는 던질 실패), ran 은 --version 대신 줄 결과.
 * 같은 root 에 world 를 둘 만들면 프로세스 둘이다(pid 가 다르고 잠금은 진짜).
 */
function world({ installed = "2026.08.19" as string | null, latest = "2026.09.27.232849", pid = 4242 } = {}) {
  if (installed) seed(installed);
  const w = {
    latest,
    clock: 1_000_000_000_000,
    asks: 0,
    runs: [] as string[],
    fetches: [] as string[],
    alive: new Set<number>(),
    leased: new Set<string>(),
    release: (tag: string): { version?: string; error?: { kind: string; message: string } } => ({ version: tag }),
    ran: null as ((file: string) => YtdlpRan) | null,
    // 받는 도중에 할 일(다른 프로세스가 같은 버전을 공개하는 것을 흉내 낸다)
    during: null as (() => void) | null,
  };
  const io: YtdlpBinaryIo = {
    dir: dirOf(),
    asset: () => ({ zip: "yt-dlp_win.zip", exe: "yt-dlp.exe" }),
    fetch: async ({ tag, staging, skipSignature }) => {
      w.fetches.push(`${tag}${skipSignature ? " 서명 건너뜀" : ""}`);
      const result = w.release(tag);
      if (result.error) throw Object.assign(new Error(result.error.message), { kind: result.error.kind });
      w.during?.();
      fs.mkdirSync(path.join(staging, "dir", "_internal"), { recursive: true });
      fs.writeFileSync(path.join(staging, "dir", "_internal", "base_library.zip"), "lib");
      fs.writeFileSync(path.join(staging, "dir", "yt-dlp.exe"), result.version ?? tag);
    },
    run: async (file, args) => {
      w.runs.push([path.relative(root, file).split(path.sep).join("/"), ...args].join(" "));
      if (w.ran) return w.ran(file);
      return { kind: "exited", status: 0, stdout: `${fs.readFileSync(file, "utf8")}\n`, stderr: "" };
    },
    latestTag: async () => {
      w.asks++;
      return w.latest;
    },
    now: () => w.clock,
    pid,
    isAlive: (other) => other === pid || w.alive.has(other),
    inUse: (dir) => [...w.leased].some((held) => held === dir || held.startsWith(dir + path.sep)),
    lock: () => lockFolder(dirOf()),
  };
  const bin = new YtdlpBinary(io);
  const rel = () => {
    const file = bin.path();
    return file && path.relative(root, file).split(path.sep).join("/");
  };
  return { w, io, bin, rel };
}

test("처음: 기록이 없으면 설정과 상관없이 채널의 최신을 설치한다. 설치 전에는 경로가 없다", async () => {
  config.ytdlp.update = "off";
  const { w, bin, rel } = world({ installed: null });
  assert.equal(rel(), null);
  const { version, outcome } = await bin.prepare();
  assert.deepEqual(outcome, { kind: "installed", from: null, to: "2026.09.27.232849", channel: "nightly" });
  assert.equal(version, "2026.09.27.232849");
  assert.equal(rel(), "bin/yt-dlp/2026.09.27.232849/yt-dlp.exe");
  assert.deepEqual(fs.readdirSync(path.join(dirOf(), "2026.09.27.232849")).sort(), ["_internal", "yt-dlp.exe"], "푼 폴더째 옮긴다(zip 은 남기지 않는다)");
  assert.deepEqual(staged(), []);
  assert.equal(w.asks, 1);
  assert.deepEqual(await bin.prepare(), { version: "2026.09.27.232849", outcome: null }, "설치돼 있으면 네트워크를 쓰지 않는다");
  assert.equal(w.asks, 1);
});

test("처음, 고정: 최신을 묻지 않고 그 버전을 설치한다", async () => {
  config.ytdlp.version = "2026.08.19";
  const { w, bin } = world({ installed: null });
  assert.equal((await bin.prepare()).outcome?.kind, "installed");
  assert.equal(w.asks, 0);
  assert.deepEqual(w.fetches, ["2026.08.19"]);
});

test("auto: 채널의 최신을 받아 버전 폴더에 두고 가리키는 경로를 교체한다. 옛 버전 폴더는 그대로 둔다", async () => {
  const { w, bin, rel } = world();
  const outcome = await bin.check();
  assert.deepEqual(outcome, { kind: "installed", from: "2026.08.19", to: "2026.09.27.232849", channel: "nightly" });
  assert.deepEqual(w.fetches, ["2026.09.27.232849"]);
  assert.ok(
    w.runs.some((run) => /^bin\/yt-dlp\/\.staging-4242-\d+\/dir\/yt-dlp\.exe --version$/.test(run)),
    w.runs.join("\n"),
  );
  assert.equal(rel(), "bin/yt-dlp/2026.09.27.232849/yt-dlp.exe");
  assert.equal(fs.readFileSync(path.join(dirOf(), "2026.08.19", "yt-dlp.exe"), "utf8"), "2026.08.19", "돌고 있던 yt-dlp 의 폴더는 건드리지 않는다");
  assert.equal(bin.state?.previous, "2026.08.19");
  assert.deepEqual(staged(), []);
});

test("최신은 하루 한 번만 묻는다. 기록은 디스크에 남아 다시 시작해도 이어진다", async () => {
  const { w, io, bin } = world({ latest: "2026.08.19" });
  assert.deepEqual(await bin.check(), { kind: "current", version: "2026.08.19" });
  w.clock += DAY - 1;
  assert.equal(await new YtdlpBinary(io).check(), null);
  assert.equal(w.asks, 1);
  w.clock += 1;
  await new YtdlpBinary(io).check();
  assert.equal(w.asks, 2);
});

test("GitHub 가 준 태그가 릴리스 태그 모양이 아니면 그 경로로 받거나 옮기지 않고 실패한다", async () => {
  const { w, bin } = world({ latest: "../../evil" });
  await assert.rejects(bin.check(), /릴리스 태그 형식이 아님/);
  assert.deepEqual(w.fetches, [], "받은 태그로는 아무것도 받지 않는다");
  assert.ok(!fs.existsSync(path.join(root, "evil")), "폴더 밖에 아무것도 만들지 않는다");
});

test("notify: 새 버전을 알리기만 하고 다운로드하지 않는다", async () => {
  config.ytdlp.update = "notify";
  const { w, bin, rel } = world();
  assert.deepEqual(await bin.check(), { kind: "available", from: "2026.08.19", to: "2026.09.27.232849", channel: "nightly" });
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
  assert.deepEqual(w.fetches, []);
});

test("off: 설치돼 있으면 네트워크를 쓰지 않는다. 사람이 부르면(force) 목표 버전으로 다운로드한다", async () => {
  config.ytdlp.update = "off";
  const { w, bin } = world();
  assert.equal(await bin.check(), null);
  assert.equal(w.asks, 0);
  assert.equal((await bin.check({ force: true }))?.kind, "installed");
});

test("고정: 하루 한 번과 상관없이 그 버전으로 맞추고 최신은 묻지 않는다. 낮은 버전으로도 내려간다", async () => {
  const { w, bin, rel } = world({ installed: "2026.09.20" });
  config.ytdlp.channel = "stable";
  config.ytdlp.version = "2026.08.19";
  assert.deepEqual(await bin.check(), { kind: "installed", from: "2026.09.20", to: "2026.08.19", channel: "stable" });
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
  assert.deepEqual(await bin.check(), { kind: "current", version: "2026.08.19" });
  assert.equal(w.asks, 0);
});

test("다운로드해 둔 버전으로 되돌리면 다운로드하지 않고 교체한다", async () => {
  const { w, bin, rel } = world();
  await bin.check();
  config.ytdlp.version = "2026.08.19";
  assert.deepEqual(await bin.check(), { kind: "reused", from: "2026.09.27.232849", to: "2026.08.19" });
  assert.deepEqual(w.fetches, ["2026.09.27.232849"]);
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
});

test("다운로드 실패는 지금 버전 그대로. 연결, 체크섬은 일시적, 자산 없음과 서명은 오래 간다(하루 뒤)", async () => {
  const { w, bin, rel } = world();
  w.release = () => ({ error: { kind: "network", message: "SHA2-256SUMS 다운로드 실패: HTTP 503" } });
  assert.deepEqual(await bin.check({ force: true }), { kind: "failed", current: "2026.08.19", target: "2026.09.27.232849", reason: "SHA2-256SUMS 다운로드 실패: HTTP 503", channel: "nightly", retry: "transient" });
  w.release = () => ({ error: { kind: "signature", message: "서명 확인 실패: 다른 키가 서명함(AB)" } });
  const signed = await bin.check({ force: true });
  assert.equal(signed?.kind === "failed" && signed.retry, "lasting");
  assert.match(describe(signed!).line, /서명 키가 바뀌었을 수 있음.*--skip-signature/);
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
  assert.deepEqual(staged(), []);
});

test("받은 것이 실행됐지만 오류로 끝나면(이 환경에서 안 돈다) 버리고 그 태그를 적는다. 하루 확인은 다시 받지 않고, 사람이 부르면 다시 해 본다", async () => {
  const { w, bin, rel } = world();
  w.ran = (file) => (file.includes(".staging") ? { kind: "exited", status: 255, stdout: "", stderr: "[PYI-1] Error loading Python lib: GLIBC_2.17 not found" } : { kind: "exited", status: 0, stdout: fs.readFileSync(file, "utf8"), stderr: "" });
  assert.deepEqual(await bin.check(), { kind: "unusable", current: "2026.08.19", target: "2026.09.27.232849", reason: "[PYI-1] Error loading Python lib: GLIBC_2.17 not found", channel: "nightly" });
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
  w.clock += DAY;
  assert.equal(await bin.check(), null);
  assert.equal(w.fetches.length, 1);
  assert.equal((await bin.check({ force: true }))?.kind, "unusable");
  assert.equal(w.fetches.length, 2);
});

test("시간 초과, 띄우기 실패, 신호 종료, 다른 버전은 일시적 실패다(그 태그를 적지 않고 다음 확인에 다시 받는다)", async () => {
  const cases: [YtdlpRan | null, string, RegExp][] = [
    [{ kind: "timeout" }, "2026.09.27.232849", /30초 안에 끝나지 않아/],
    [{ kind: "spawn-failed", code: "EBUSY" }, "2026.09.27.232849", /실행하지 못함\(EBUSY\)/],
    [{ kind: "signal", signal: "SIGKILL" }, "2026.09.27.232849", /신호로 끝남/],
    [null, "2026.09.01", /버전이 다름\(2026\.09\.01\)/],
  ];
  for (const [ran, version, why] of cases) {
    const { w, bin } = world();
    w.release = () => ({ version });
    w.ran = ran ? (file) => (file.includes(".staging") ? ran : { kind: "exited", status: 0, stdout: fs.readFileSync(file, "utf8"), stderr: "" }) : null;
    const outcome = await bin.check();
    assert.ok(outcome?.kind === "failed" && outcome.retry === "transient" && why.test(outcome.reason), JSON.stringify(outcome));
    assert.equal(bin.state?.unusable, null);
    w.clock += DAY;
    await bin.check();
    assert.equal(w.fetches.length, 2, "다음 확인에 다시 받는다");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("돌고 있는 봇은 확인할 때 다른 프로세스(update:ytdlp)가 다운로드한 버전을 이어받는다", async () => {
  const { bin, rel } = world();
  await bin.prepare();
  const other = world({ installed: null, pid: 5555 });
  await other.bin.check({ force: true });
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe", "확인 전에는 쓰던 버전");
  assert.equal(await bin.check(), null, "다운로드한 버전과 확인 시각을 그대로 이어받아 더 할 일이 없다");
  assert.equal(rel(), "bin/yt-dlp/2026.09.27.232849/yt-dlp.exe");
});

test("프로세스 둘이 같은 버전을 동시에 설치하고 정리해도 새 폴더가 남고 기록이 맞다", async () => {
  const one = world();
  const two = world({ installed: null, pid: 5555 });
  one.w.alive.add(5555);
  two.w.alive.add(4242);
  const [a, b] = await Promise.all([one.bin.check({ force: true }), two.bin.check({ force: true })]);
  for (const outcome of [a, b]) assert.ok(outcome?.kind === "installed" || outcome?.kind === "reused", JSON.stringify(outcome));
  assert.ok([a, b].some((outcome) => outcome?.kind === "installed"));
  await Promise.all([one.bin.cleanup(), two.bin.cleanup()]);
  const state = JSON.parse(fs.readFileSync(path.join(dirOf(), "state.json"), "utf8"));
  assert.equal(state.version, "2026.09.27.232849");
  assert.equal(state.previous, "2026.08.19");
  assert.equal(fs.readFileSync(path.join(dirOf(), "2026.09.27.232849", "yt-dlp.exe"), "utf8"), "2026.09.27.232849");
  assert.deepEqual(staged(), []);
});

test("받는 사이 다른 프로세스가 같은 버전을 먼저 공개하면 그것을 확인해 쓴다", async () => {
  const { w, bin, rel } = world();
  w.during = () => {
    fs.mkdirSync(path.join(dirOf(), "2026.09.27.232849"), { recursive: true });
    fs.writeFileSync(path.join(dirOf(), "2026.09.27.232849", "yt-dlp.exe"), "2026.09.27.232849");
  };
  assert.deepEqual(await bin.check(), { kind: "reused", from: "2026.08.19", to: "2026.09.27.232849" });
  assert.equal(rel(), "bin/yt-dlp/2026.09.27.232849/yt-dlp.exe");
  assert.deepEqual(staged(), []);
});

test("그 이름의 폴더에 이 판의 실행 파일이 없거나(옛 판) 다른 버전이 들었으면 새로 받아 바꾼다. 확인이 일시적으로 실패한 폴더는 건드리지 않는다", async () => {
  const { w, bin, rel } = world();
  fs.mkdirSync(path.join(dirOf(), "2026.09.27.232849"), { recursive: true });
  fs.writeFileSync(path.join(dirOf(), "2026.09.27.232849", "yt-dlp"), "옛 zipapp 판");
  assert.equal((await bin.check())?.kind, "installed");
  assert.equal(rel(), "bin/yt-dlp/2026.09.27.232849/yt-dlp.exe");
  assert.ok(!fs.existsSync(path.join(dirOf(), "2026.09.27.232849", "yt-dlp")));

  config.ytdlp.version = "2026.09.30";
  fs.mkdirSync(path.join(dirOf(), "2026.09.30"));
  fs.writeFileSync(path.join(dirOf(), "2026.09.30", "yt-dlp.exe"), "2026.01.01");
  assert.equal((await bin.check())?.kind, "installed");
  assert.equal(fs.readFileSync(path.join(dirOf(), "2026.09.30", "yt-dlp.exe"), "utf8"), "2026.09.30");

  config.ytdlp.version = "2026.10.01";
  fs.mkdirSync(path.join(dirOf(), "2026.10.01"));
  fs.writeFileSync(path.join(dirOf(), "2026.10.01", "yt-dlp.exe"), "2026.10.01");
  w.ran = (file) => (file.includes("2026.10.01") ? { kind: "timeout" } : { kind: "exited", status: 0, stdout: fs.readFileSync(file, "utf8"), stderr: "" });
  const outcome = await bin.check();
  assert.ok(outcome?.kind === "failed" && /확인 실패/.test(outcome.reason), JSON.stringify(outcome));
  assert.equal(fs.readFileSync(path.join(dirOf(), "2026.10.01", "yt-dlp.exe"), "utf8"), "2026.10.01");
});

test("잠금을 잡지 못하면 설치는 일시적 실패, 정리는 건너뛴다", async () => {
  const { w, io, bin } = world();
  fs.mkdirSync(path.join(dirOf(), "2026.01.01"));
  io.lock = async () => null;
  const outcome = await bin.check();
  assert.ok(outcome?.kind === "failed" && outcome.retry === "transient" && /잠금/.test(outcome.reason), JSON.stringify(outcome));
  await bin.cleanup();
  assert.ok(names().includes("2026.01.01"));
  assert.deepEqual(staged(), []);
  assert.equal(w.fetches.length, 1);
});

test("정리: 지금, 직전, 쓰는 중인 버전과 살아 있는 프로세스의 staging 을 남기고, 기록과 모르는 이름은 건드리지 않는다", async () => {
  const { w, bin } = world();
  await bin.check();
  for (const name of ["2026.01.01", "2026.02.02", ".staging-1234", ".staging-7777-5", ".trash-2025.12.31-1-2", "my-notes"]) fs.mkdirSync(path.join(dirOf(), name));
  fs.writeFileSync(path.join(dirOf(), "state.json.999.tmp"), "{}");
  w.leased.add(path.join(dirOf(), "2026.02.02"));
  w.alive.add(7777);
  await bin.cleanup();
  assert.deepEqual(names(), [".staging-7777-5", "2026.02.02", "2026.08.19", "2026.09.27.232849", "my-notes", "state.json", "state.json.999.tmp"]);
});

test("정리: 이 프로세스의 staging 도 그 안에서 아직 도는 것이 없으면 지운다", async () => {
  const { w, bin } = world();
  fs.mkdirSync(path.join(dirOf(), ".staging-4242-1"));
  fs.mkdirSync(path.join(dirOf(), ".staging-4242-2"));
  w.leased.add(path.join(dirOf(), ".staging-4242-2", "dir"));
  await bin.cleanup();
  assert.deepEqual(staged(), [".staging-4242-2"]);
});

test("오래 켜 두어도 버전이 쌓이지 않는다. 확인할 때마다 지금 버전과 직전 버전만 남긴다", async (t) => {
  const { w, bin } = world();
  t.after(() => bin.stop());
  await bin.start();
  for (const day of ["2026.09.28.000000", "2026.09.29.000000", "2026.09.30.000000"]) {
    w.latest = day;
    w.clock += DAY;
    await bin._tick();
  }
  assert.deepEqual(names(), ["2026.09.29.000000", "2026.09.30.000000", "state.json"]);
});

test("기동: 최신을 따라가면 다음 확인을 하루 뒤에 걸고, 고정이면 걸지 않는다", async (t) => {
  const { bin, w } = world();
  t.after(() => bin.stop());
  await bin.start();
  assert.ok(bin.timer, "하루 뒤 확인");
  assert.equal(bin.nextAt, w.clock + DAY, "다음 확인 때(봇 상태 탭)");
  bin.stop();
  assert.equal(bin.nextAt, null);

  config.ytdlp.version = "2026.08.19";
  const pinned = world().bin;
  await pinned.start();
  assert.equal(pinned.timer, null);
});

test("기동: 처음 설치가 실패하면 설정과 상관없이 다시 해 본다(일시적이면 한 시간, 자산 없음은 하루 뒤). 설치되면 원래 규칙으로", async (t) => {
  config.ytdlp.update = "off";
  const { w, io, bin } = world({ installed: null });
  t.after(() => bin.stop());
  w.release = () => ({ error: { kind: "network", message: "연결 끊김" } });
  await bin.start();
  assert.equal(bin.nextAt, w.clock + HOUR);
  w.release = (tag) => ({ version: tag });
  await bin._tick();
  assert.equal(bin.path() !== null, true);
  assert.equal(bin.timer, null, "설치되면 off 라 더 보지 않는다");

  const none = new YtdlpBinary({ ...io, dir: path.join(root, "other"), asset: () => ({ missing: "이 OS, CPU 용 yt-dlp 판이 없음(freebsd-x64)" }) });
  t.after(() => none.stop());
  await none.start();
  assert.equal(none.nextAt, w.clock + DAY);
});

test("설치 전이나 실행 파일이 사라졌으면 경로가 없고, 봇이 돌리는 중이면 설치를 한 번만 예약한다", async (t) => {
  const { w, bin } = world();
  t.after(() => bin.stop());
  bin.started = true;
  assert.ok(bin.path());
  fs.rmSync(path.join(dirOf(), "2026.08.19"), { recursive: true });
  assert.equal(bin.path(), null);
  const first = bin.nextAt;
  assert.equal(first, w.clock + 60_000);
  w.clock += 1000;
  assert.equal(bin.path(), null);
  assert.equal(bin.nextAt, first, "곡 추가가 여러 번 와도 예약은 하나");
});

test("--skip-signature 는 처음 설치와 기존 설치 모두의 다운로드에 닿는다", async () => {
  const fresh = world({ installed: null });
  await fresh.bin.prepare({ force: true, skipSignature: true });
  assert.deepEqual(fresh.w.fetches, ["2026.09.27.232849 서명 건너뜀"]);
  fs.rmSync(root, { recursive: true, force: true });
  const { w, bin } = world();
  await bin.check({ force: true, skipSignature: true });
  await bin.check({ force: true });
  assert.deepEqual(w.fetches, ["2026.09.27.232849 서명 건너뜀"], "두 번째는 이미 목표 버전이다");
});

test("결과 한 줄", () => {
  const lines = [
    describe({ kind: "current", version: "a" }),
    describe({ kind: "installed", from: "a", to: "b", channel: "nightly" }),
    describe({ kind: "installed", from: null, to: "b", channel: "nightly" }),
    describe({ kind: "reused", from: "b", to: "a" }),
    describe({ kind: "available", from: "a", to: "b", channel: "stable" }),
    describe({ kind: "failed", current: "a", target: "b", reason: "연결 끊김", channel: "nightly", retry: "transient" }),
    describe({ kind: "failed", current: null, target: "b", reason: "연결 끊김", channel: "nightly", retry: "transient" }),
    describe({ kind: "unusable", current: "a", target: "c", reason: "GLIBC_2.17 not found", channel: "nightly" }),
  ];
  assert.deepEqual(lines, [
    { level: "info", line: "yt-dlp 버전이 목표와 같음(a)" },
    { level: "info", line: "yt-dlp 업데이트 완료: a → b" },
    { level: "info", line: "yt-dlp 설치 완료: b (nightly)" },
    { level: "info", line: "yt-dlp를 저장된 버전으로 교체: b → a" },
    { level: "info", line: "yt-dlp 업데이트 있음: a → b (stable). (업데이트: pnpm run update:ytdlp)" },
    { level: "warn", line: "yt-dlp 업데이트 실패(기존 버전 유지): a → b (nightly) - 연결 끊김" },
    { level: "warn", line: "yt-dlp 설치 실패(yt-dlp 를 쓰는 기능이 동작하지 않음): b (nightly) - 연결 끊김" },
    { level: "warn", line: "yt-dlp 업데이트 불가(기존 버전 유지): a → c (nightly) - 이 환경에서 실행되지 않음: GLIBC_2.17 not found" },
  ]);
});

test("기동 줄의 업데이트 방식. 버전을 고정하면 하루 한 번 확인하지 않는다", () => {
  assert.deepEqual([updateText("auto", false), updateText("auto", true), updateText("notify", false), updateText("off", false)], ["자동 (1일 1회 확인)", "자동", "알림만", "하지 않음"]);
});
