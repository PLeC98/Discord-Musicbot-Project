// src/sources/ytdlp-binary.ts — yt-dlp 버전을 버전마다 폴더에 두고, 목표 버전(고정 · 채널 최신)으로 맞추고, 가리키는 경로만 바꿔 끼운다.
// 바이너리 · GitHub 는 가짜다. 가짜 바이너리는 파일 내용이 곧 버전이고, --update-to 를 받으면 파일을 새 버전으로 고쳐 쓴다.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import config from "../../src/config/index.ts";
import { YtdlpBinary, describe, updateText, type YtdlpBinaryIo } from "../../src/sources/ytdlp-binary.ts";

const DAY = 24 * 60 * 60 * 1000;
const saved = { ...config.ytdlp };
let root = "";
// 받기 중에 쓰는 폴더가 남았나
const staged = () => fs.readdirSync(path.join(root, "bin/yt-dlp")).filter((name) => name.startsWith(".staging"));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ytdlp-bin-"));
  Object.assign(config.ytdlp, { channel: "nightly", version: null, update: "auto" });
});
afterEach(() => {
  Object.assign(config.ytdlp, saved);
  fs.rmSync(root, { recursive: true, force: true });
});

// 가짜 세상. latest 는 GitHub 의 최신 태그, update 는 --update-to 가 할 일(받은 버전을 바꾸거나 실패)
function world({ installed = "2026.08.19", latest = "2026.09.27.232849" } = {}) {
  const seed = path.join(root, "lib", "yt-dlp.exe");
  fs.mkdirSync(path.dirname(seed), { recursive: true });
  fs.writeFileSync(seed, installed);
  const w = {
    latest,
    clock: 1_000_000_000_000,
    asks: 0,
    runs: [] as string[],
    update: (target: string): { status: number; stderr?: string; got?: string } => ({ status: 0, got: target }),
  };
  const io: YtdlpBinaryIo = {
    dir: path.join(root, "bin", "yt-dlp"),
    seed,
    now: () => w.clock,
    latestTag: async () => {
      w.asks++;
      return w.latest;
    },
    run: async (file, args) => {
      w.runs.push([path.relative(root, file).split(path.sep).join("/"), ...args].join(" "));
      if (args[0] === "--version") return { status: 0, stdout: `${fs.readFileSync(file, "utf8")}\n`, stderr: "" };
      const target = args[1].split("@")[1];
      const r = w.update(target);
      if (r.status === 0) fs.writeFileSync(file, r.got ?? target);
      return { status: r.status, stdout: "", stderr: r.stderr ?? "" };
    },
  };
  const bin = new YtdlpBinary(io);
  const rel = () => path.relative(root, bin.path()).split(path.sep).join("/");
  return { w, io, bin, rel };
}

test("처음에는 설치 때 받은 것을 버전의 폴더로 옮겨 온다. 옮기기 전에는 설치 때 받은 것을 가리킨다", async () => {
  const { bin, rel } = world();
  assert.equal(rel(), "lib/yt-dlp.exe");
  assert.deepEqual(await bin.prepare(), { version: "2026.08.19", seeded: true });
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
  assert.deepEqual(await bin.prepare(), { version: "2026.08.19", seeded: false });
});

test("auto: 채널의 최신을 복사본 위에서 채널@태그로 받고, 가리키는 경로를 바꿔 끼운다. 옛 버전 파일은 그대로 둔다", async () => {
  const { w, bin, rel } = world();
  const outcome = await bin.check();
  assert.deepEqual(outcome, { kind: "installed", from: "2026.08.19", to: "2026.09.27.232849", channel: "nightly" });
  assert.ok(w.runs.includes(`bin/yt-dlp/.staging-${process.pid}/yt-dlp.exe --update-to nightly@2026.09.27.232849`), w.runs.join("\n"));
  assert.equal(rel(), "bin/yt-dlp/2026.09.27.232849/yt-dlp.exe");
  assert.equal(fs.readFileSync(path.join(root, "bin/yt-dlp/2026.08.19/yt-dlp.exe"), "utf8"), "2026.08.19", "돌고 있던 yt-dlp 의 파일은 덮지 않는다");
  assert.equal(bin.state?.previous, "2026.08.19");
  assert.deepEqual(staged(), []);
});

test("최신은 하루 한 번만 묻는다. 기록은 디스크에 남아 다시 켜도 이어진다", async () => {
  const { w, io, bin } = world({ latest: "2026.08.19" });
  assert.deepEqual(await bin.check(), { kind: "current", version: "2026.08.19" });
  w.clock += DAY - 1;
  assert.equal(await new YtdlpBinary(io).check(), null);
  assert.equal(w.asks, 1);
  w.clock += 1;
  await new YtdlpBinary(io).check();
  assert.equal(w.asks, 2);
});

test("notify: 새 버전을 알리기만 하고 받지 않는다", async () => {
  config.ytdlp.update = "notify";
  const { w, bin, rel } = world();
  assert.deepEqual(await bin.check(), { kind: "available", from: "2026.08.19", to: "2026.09.27.232849", channel: "nightly" });
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
  assert.equal(w.runs.filter((r) => r.includes("--update-to")).length, 0);
});

test("off: 네트워크를 쓰지 않는다. 사람이 부르면(force) 목표 버전으로 받는다", async () => {
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
  assert.ok(w.runs.some((r) => r.endsWith("--update-to stable@2026.08.19")));
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
  assert.deepEqual(await bin.check(), { kind: "current", version: "2026.08.19" });
  assert.equal(w.asks, 0);
});

test("받아 둔 버전으로 되돌리면 받지 않고 바꿔 끼운다", async () => {
  const { w, bin, rel } = world();
  await bin.check();
  config.ytdlp.version = "2026.08.19";
  const updates = () => w.runs.filter((r) => r.includes("--update-to")).length;
  const before = updates();
  assert.deepEqual(await bin.check(), { kind: "reused", from: "2026.09.27.232849", to: "2026.08.19" });
  assert.equal(updates(), before);
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
});

test("받기가 실패하면 지금 버전 그대로. 까닭은 yt-dlp 의 마지막 줄", async () => {
  const { w, bin, rel } = world();
  w.update = () => ({ status: 100, stderr: "[debug] …\nERROR: Unable to download: HTTP Error 503" });
  assert.deepEqual(await bin.check(), { kind: "failed", current: "2026.08.19", target: "2026.09.27.232849", reason: "ERROR: Unable to download: HTTP Error 503", channel: "nightly" });
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
  assert.deepEqual(staged(), []);
});

test("목표가 아닌 버전이 오면(받을 수 있는 버전의 상한) 버리고, 같은 태그는 다시 받지 않는다. 사람이 부르면 다시 해 본다", async () => {
  const { w, bin, rel } = world();
  w.update = () => ({ status: 0, got: "2026.09.01" });
  assert.deepEqual(await bin.check(), { kind: "capped", current: "2026.08.19", target: "2026.09.27.232849", got: "2026.09.01", channel: "nightly" });
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe");
  w.clock += DAY;
  assert.equal(await bin.check(), null);
  assert.equal((await bin.check({ force: true }))?.kind, "capped");
});

test("돌고 있는 봇은 확인할 때 다른 프로세스(update:ytdlp)가 받은 버전을 이어받는다", async () => {
  const { io, bin, rel } = world();
  await bin.prepare();
  await new YtdlpBinary(io).check({ force: true });
  assert.equal(rel(), "bin/yt-dlp/2026.08.19/yt-dlp.exe", "확인 전에는 쓰던 버전");
  assert.equal(await bin.check(), null, "받은 버전과 확인 시각을 그대로 이어받아 더 할 일이 없다");
  assert.equal(rel(), "bin/yt-dlp/2026.09.27.232849/yt-dlp.exe");
});

test("정리는 지금 버전과 직전 버전만 남긴다", async () => {
  const { w, bin } = world();
  await bin.check();
  w.latest = "2026.09.28.000000";
  w.clock += DAY;
  await bin.check();
  fs.mkdirSync(path.join(root, "bin/yt-dlp/.staging-1234"));
  bin.cleanup();
  assert.deepEqual(fs.readdirSync(path.join(root, "bin/yt-dlp")).sort(), ["2026.09.27.232849", "2026.09.28.000000", "state.json"]);
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
  assert.deepEqual(fs.readdirSync(path.join(root, "bin/yt-dlp")).sort(), ["2026.09.29.000000", "2026.09.30.000000", "state.json"]);
});

test("기동: 최신을 따라가면 다음 확인을 하루 뒤에 걸고, 고정이면 걸지 않는다", async (t) => {
  const { bin } = world();
  t.after(() => bin.stop());
  await bin.start();
  assert.ok(bin.timer, "하루 뒤 확인");
  bin.stop();

  config.ytdlp.version = "2026.08.19";
  const pinned = world().bin;
  await pinned.start();
  assert.equal(pinned.timer, null);
});

test("결과 한 줄", () => {
  const lines = [describe({ kind: "current", version: "a" }), describe({ kind: "installed", from: "a", to: "b", channel: "nightly" }), describe({ kind: "reused", from: "b", to: "a" }), describe({ kind: "available", from: "a", to: "b", channel: "stable" }), describe({ kind: "failed", current: "a", target: "b", reason: "ERROR: x", channel: "nightly" }), describe({ kind: "capped", current: "a", target: "c", got: "b", channel: "nightly" })];
  assert.deepEqual(lines, [
    { level: "info", line: "yt-dlp가 목표 버전입니다(a)" },
    { level: "info", line: "yt-dlp를 업데이트했습니다: a → b" },
    { level: "info", line: "yt-dlp를 저장된 버전으로 교체했습니다: b → a" },
    { level: "info", line: "yt-dlp에 업데이트가 있습니다: a → b (stable). (업데이트: pnpm run update:ytdlp)" },
    { level: "warn", line: "yt-dlp 업데이트 실패. 기존 버전을 유지합니다: a → b (nightly) - ERROR: x" },
    { level: "warn", line: "yt-dlp 업데이트 불가. 기존 버전을 유지합니다: a → c (nightly) - 이 환경에서 받을 수 있는 최고 버전은 b" },
  ]);
});

test("기동 줄의 업데이트 방식. 버전을 고정하면 하루 한 번 확인하지 않는다", () => {
  assert.deepEqual([updateText("auto", false), updateText("auto", true), updateText("notify", false), updateText("off", false)], ["자동 (1일 1회 확인)", "자동", "알림만", "하지 않음"]);
});
