// src/dashboard/old-tools.ts: 업데이트 탭의 외부 프로그램 이전 버전 카드(삭제할 이전 버전과 크기, 삭제). 도구마다 따로 하고 하나가 실패해도 나머지는 한다.
// yt-dlp는 가짜(이전 버전 삭제 자체는 ytdlp-binary.test), ffmpeg와 예전 설치 위치(vendor/bin)는 임시 폴더

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeState } from "../../src/media/ffmpeg/state.ts";
import { previewOldTools, removeOldTools, type OldToolsDeps } from "../../src/dashboard/old-tools.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "old-tools-"));
after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
let n = 0;

const R = "autobuild-2026-10-31-12-59";
const P = "autobuild-2026-09-30-12-59";
const BIN = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const build = (folder: string, release: string) => ({ folder, release, asset: "a.zip", sha256: "x", version: "n9" });
const put = (file: string, bytes: number) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
};

/**
 * 세 폴더를 만든다. yt-dlp: 지금 2026.09.30, 이전 2026.08.19(20바이트). ffmpeg: 지금 R, 이전 P(30바이트). vendor/bin: 옛 ffmpeg(40바이트)와 yt-dlp 폴더(5바이트).
 * 가짜 yt-dlp: forgetPrevious는 기록에서 빼고, leased가 아니면 폴더를 삭제한다. busy면 잠금 실패 예외를 던진다. s.used: 봇이 정해 둔 ffmpeg 경로(null이면 아직 정하지 않음)
 */
function world() {
  const root = path.join(base, `w-${++n}`);
  const d = { ytdlpDir: path.join(root, "yt-dlp"), ffmpegDir: path.join(root, "ffmpeg"), legacyDir: path.join(root, "bin") };
  put(path.join(d.ytdlpDir, "2026.09.30", "yt-dlp.exe"), 10);
  put(path.join(d.ytdlpDir, "2026.08.19", "yt-dlp.exe"), 20);
  put(path.join(d.ffmpegDir, `${R}-2`, BIN), 100);
  put(path.join(d.ffmpegDir, `${P}-1`, BIN), 30);
  writeState(d.ffmpegDir, { active: build(`${R}-2`, R), previous: build(`${P}-1`, P), rejected: [], pin: null });
  put(path.join(d.legacyDir, BIN), 40);
  put(path.join(d.legacyDir, "yt-dlp", "2026.01.01", "yt-dlp.exe"), 5);
  const s = { previous: "2026.08.19" as string | null, leased: false, busy: false, used: path.join(d.ffmpegDir, `${R}-2`, BIN) as string | null };
  const ytdlp: OldToolsDeps["ytdlp"] = {
    oldFolders: () => ({ previous: s.previous, folders: s.previous && !s.leased && fs.existsSync(path.join(d.ytdlpDir, s.previous)) ? [s.previous] : [] }),
    forgetPrevious: async (go) => {
      if (s.busy) throw Object.assign(new Error("다른 프로세스가 yt-dlp 폴더를 사용 중"), { code: "folder-busy" });
      go?.();
      const gone = s.previous;
      s.previous = null;
      if (gone && !s.leased) fs.rmSync(path.join(d.ytdlpDir, gone), { recursive: true });
      return gone;
    },
  };
  const deps: OldToolsDeps = { ...d, ytdlp, ffmpegPath: () => s.used, pathEnv: "" };
  return { d, s, deps };
}

test("미리 보기: 도구마다 삭제할 버전과 크기", async () => {
  const { deps } = world();
  assert.deepEqual(await previewOldTools(deps), [
    { tool: "ytdlp", versions: ["2026.08.19"], bytes: 20, kept: [] },
    { tool: "ffmpeg", versions: [P], bytes: 30, kept: [] },
    { tool: "legacy", versions: [], bytes: 45, kept: [] },
  ]);
});

test("삭제: 세 도구를 삭제하고, 예전 설치 위치는 비면 폴더도 삭제한다. 지금 쓰는 버전은 남는다", async () => {
  const { d, deps } = world();
  const done = await removeOldTools(undefined, deps);
  assert.deepEqual(done, [
    { tool: "ytdlp", versions: ["2026.08.19"], bytes: 20, kept: [], deferred: false },
    { tool: "ffmpeg", versions: [P], bytes: 30, kept: [], deferred: false },
    { tool: "legacy", versions: [], bytes: 45, kept: [], deferred: false },
  ]);
  assert.deepEqual(fs.readdirSync(d.ytdlpDir), ["2026.09.30"]);
  assert.deepEqual(fs.readdirSync(d.ffmpegDir).sort(), [`${R}-2`, "state.json"]);
  assert.equal(fs.existsSync(d.legacyDir), false);
  assert.deepEqual(await previewOldTools(deps), [], "지운 뒤에는 보일 것이 없다");
});

test("봇이 아직 ffmpeg를 정하지 않았으면(기동 중) ffmpeg와 예전 설치 위치는 건너뛴다", async () => {
  const { d, s, deps } = world();
  s.used = null;
  const done = await removeOldTools(undefined, deps);
  assert.deepEqual(
    done.map((t) => [t.tool, t.kept]),
    [
      ["ytdlp", []],
      ["ffmpeg", ["starting"]],
      ["legacy", ["starting"]],
    ],
  );
  assert.equal(fs.existsSync(path.join(d.ffmpegDir, `${P}-1`)), true);
  assert.equal(fs.existsSync(path.join(d.legacyDir, BIN)), true);
});

test("봇이 쓰는 ffmpeg가 이전 설치본이거나 예전 설치 위치에 있으면 남긴다", async () => {
  const { d, s, deps } = world();
  s.used = path.join(d.ffmpegDir, `${P}-1`, BIN);
  const first = await removeOldTools(undefined, deps);
  assert.deepEqual(first.find((t) => t.tool === "ffmpeg")?.kept, ["in-use"]);
  assert.equal(fs.existsSync(s.used), true);

  const other = world();
  other.s.used = path.join(other.d.legacyDir, BIN);
  const second = await removeOldTools(undefined, other.deps);
  assert.deepEqual(
    second.find((t) => t.tool === "legacy"),
    { tool: "legacy", versions: [], bytes: 5, kept: ["in-use"], deferred: false },
  );
  assert.deepEqual(fs.readdirSync(other.d.legacyDir), [BIN], "쓰는 실행 파일만 남고 폴더도 남는다");
});

test("yt-dlp: 도는 yt-dlp가 쓰는 폴더는 기록에서만 지우고 다음 정리로 미룬다", async () => {
  const { d, s, deps } = world();
  s.leased = true;
  const done = await removeOldTools(undefined, deps);
  assert.deepEqual(done[0], { tool: "ytdlp", versions: ["2026.08.19"], bytes: 0, kept: [], deferred: true });
  assert.equal(fs.existsSync(path.join(d.ytdlpDir, "2026.08.19")), true);
});

test("한 도구가 다른 프로세스 때문에 못 해도 나머지는 한다", async () => {
  const { d, s, deps } = world();
  s.busy = true;
  const done = await removeOldTools(undefined, deps);
  assert.deepEqual(done[0], { tool: "ytdlp", versions: [], bytes: 0, kept: ["busy"], deferred: false });
  assert.equal(fs.existsSync(path.join(d.ffmpegDir, `${P}-1`)), false);
  assert.equal(fs.existsSync(d.legacyDir), false);
});

test("세션 확인(go)이 던지면 그대로 올리고 그 뒤의 도구는 하지 않는다", async () => {
  const { d, deps } = world();
  await assert.rejects(
    removeOldTools(() => {
      throw new Error("로그아웃");
    }, deps),
    /로그아웃/,
  );
  assert.equal(fs.existsSync(path.join(d.ytdlpDir, "2026.08.19")), true);
  assert.equal(fs.existsSync(path.join(d.ffmpegDir, `${P}-1`)), true);
  assert.equal(fs.existsSync(path.join(d.legacyDir, BIN)), true);
});

test("예전 설치 위치: 정해 둔 이름만 지우고 모르는 이름이 있으면 폴더를 남긴다. 폴더 자체가 링크면 건너뛴다", async () => {
  const { d, deps } = world();
  put(path.join(d.legacyDir, "내가-둔-것.txt"), 1);
  await removeOldTools(undefined, deps);
  assert.deepEqual(fs.readdirSync(d.legacyDir), ["내가-둔-것.txt"]);

  const other = world();
  const real = path.join(base, `real-bin-${n}`);
  fs.renameSync(other.d.legacyDir, real);
  fs.symlinkSync(real, other.d.legacyDir, "junction");
  const done = await removeOldTools(undefined, other.deps);
  assert.deepEqual(done.find((t) => t.tool === "legacy")?.kept, ["link"]);
  assert.equal(fs.existsSync(path.join(real, BIN)), true);
  fs.unlinkSync(other.d.legacyDir);
});
