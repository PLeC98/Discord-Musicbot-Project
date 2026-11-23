// src/media/ffmpeg/install.ts: ffmpeg를 목표 릴리스에 맞춘다. 같은 버전이면 받지 않고, 이전 빌드면 가리킴만 바꾸고, 물린 릴리스는 다시 받지 않는다.
// 받은 것이 이 환경에서 실행되지 않거나 릴리스가 없으면 가리킴은 그대로다. 고정은 맞추기에 성공했을 때만 바뀐다.
// 다운로드, 압축 풀기, 실행 확인은 가짜: 압축 파일의 내용이 곧 실행 파일이고, 내용이 "good"이면 실행된다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { alignFfmpeg, type InstallIo } from "../../src/media/ffmpeg/install.ts";
import { readState, writeState, type FfmpegBuild, type FfmpegState } from "../../src/media/ffmpeg/state.ts";
import { asText } from "../../src/infra/log/log-text.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-install-"));
after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));

const A = "autobuild-2026-09-30-12-59";
const B = "autobuild-2026-10-31-12-59";
const C = "autobuild-2026-08-31-12-59";
const assetOf = (release: string) => `ffmpeg-n9.0.${release.slice(15, 17)}-1-gabc-linux64-lgpl-9.0.tar.xz`;

/** 릴리스마다의 가짜 원격: 압축 파일 내용(없으면 그 릴리스가 없다), 체크섬을 틀리게 줄지 */
type Remote = Record<string, { body: string; badSum?: boolean } | undefined>;

function fakeIo(remote: Remote) {
  const fetched: string[] = [];
  let now = 1000;
  const io: InstallIo = {
    key: "linux-x64",
    fetchText: async (url) => {
      const release = Object.keys(remote).find((r) => url.includes(`/${r}/`));
      const entry = release ? remote[release] : undefined;
      if (!release || !entry) return null;
      const sum = crypto
        .createHash("sha256")
        .update(entry.badSum ? "다른 내용" : entry.body)
        .digest("hex");
      return `${sum}  ${assetOf(release)}\n`;
    },
    fetchFile: async (url) => {
      const release = Object.keys(remote).find((r) => url.includes(`/${r}/`)) ?? "";
      fetched.push(release);
      return Buffer.from(remote[release]?.body ?? "");
    },
    extract: async (archive, bin, cwd) => {
      const out = path.join(cwd, "bin", bin);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(path.join(cwd, archive), out);
      return out;
    },
    probe: async (file) => (fs.existsSync(file) && fs.readFileSync(file, "utf8") === "good" ? { ok: true, version: `v-${path.basename(path.dirname(file))}` } : { ok: false, reason: "실행 안 됨" }),
    now: () => ++now,
    pid: 4242,
  };
  return { io, fetched };
}

let n = 0;
const fresh = () => path.join(base, `dir-${++n}`);
/** 받아 둔 빌드 하나를 폴더에 만든다. good이면 실행된다 */
function placed(dir: string, release: string, good = true): FfmpegBuild {
  const folder = `${release}-1`;
  fs.mkdirSync(path.join(dir, folder), { recursive: true });
  fs.writeFileSync(path.join(dir, folder, "ffmpeg"), good ? "good" : "bad");
  return { folder, release, asset: assetOf(release), sha256: "x", version: "v" };
}
const stateOf = (dir: string): FfmpegState => {
  const read = readState(dir);
  assert.equal(read.kind, "ok");
  return (read as { state: FfmpegState }).state;
};

test("처음: 기본값을 받아 버전 폴더에 두고 가리킨다", async () => {
  const dir = fresh();
  const { io, fetched } = fakeIo({ [B]: { body: "good" } });
  const outcome = await alignFfmpeg({ dir, defaultRelease: B, io });
  assert.equal(outcome.kind, "installed");
  assert.deepEqual(fetched, [B]);
  const state = stateOf(dir);
  assert.equal(state.active?.release, B);
  assert.equal(state.previous, null);
  assert.equal(fs.readFileSync(path.join(dir, state.active?.folder ?? "", "ffmpeg"), "utf8"), "good");
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.startsWith(".staging")),
    [],
    "임시 폴더를 남기지 않는다",
  );
});

test("지금 빌드가 목표이고 실행되면 받지 않는다. 새 기본값으로 올리면 쓰던 것이 이전 빌드가 된다", async () => {
  const dir = fresh();
  writeState(dir, { active: placed(dir, A), previous: null, rejected: [], pin: null });
  const { io, fetched } = fakeIo({ [B]: { body: "good" } });
  assert.equal((await alignFfmpeg({ dir, defaultRelease: A, io })).kind, "unchanged");
  assert.deepEqual(fetched, []);
  assert.equal((await alignFfmpeg({ dir, defaultRelease: B, io })).kind, "installed");
  assert.deepEqual([stateOf(dir).active?.release, stateOf(dir).previous?.release], [B, A]);
});

test("이전 빌드가 목표이고 실행되면 받지 않고 가리킴만 바꾼다", async () => {
  const dir = fresh();
  writeState(dir, { active: placed(dir, B), previous: placed(dir, A), rejected: [], pin: null });
  const { io, fetched } = fakeIo({});
  assert.equal((await alignFfmpeg({ dir, defaultRelease: A, io })).kind, "switched");
  assert.deepEqual(fetched, []);
  assert.deepEqual([stateOf(dir).active?.release, stateOf(dir).previous?.release], [A, B]);
});

test("지금 빌드가 목표인데 실행되지 않으면 다시 받고, 망가진 것을 이전 빌드로 남기지 않는다", async () => {
  const dir = fresh();
  const previous = placed(dir, A);
  writeState(dir, { active: placed(dir, B, false), previous, rejected: [], pin: null });
  const { io, fetched } = fakeIo({ [B]: { body: "good" } });
  assert.equal((await alignFfmpeg({ dir, defaultRelease: B, io })).kind, "installed");
  assert.deepEqual(fetched, [B]);
  assert.equal(stateOf(dir).previous?.folder, previous.folder);
});

test("받은 것이 이 환경에서 실행되지 않으면 가리킴은 그대로, 물린 릴리스로 적고 다음에는 받지 않는다. --force는 받는다", async () => {
  const dir = fresh();
  const active = placed(dir, A);
  writeState(dir, { active, previous: null, rejected: [], pin: null });
  const bad = fakeIo({ [B]: { body: "bad" } });
  const outcome = await alignFfmpeg({ dir, defaultRelease: B, io: bad.io });
  assert.equal(outcome.kind, "failed");
  assert.equal(stateOf(dir).active?.folder, active.folder);
  assert.deepEqual(stateOf(dir).rejected, [B]);

  const again = fakeIo({ [B]: { body: "good" } });
  assert.equal((await alignFfmpeg({ dir, defaultRelease: B, io: again.io })).kind, "skipped");
  assert.deepEqual(again.fetched, [], "물린 릴리스는 다시 받지 않는다");
  assert.equal((await alignFfmpeg({ dir, defaultRelease: B, force: true, io: again.io })).kind, "installed");
  assert.deepEqual(stateOf(dir).rejected, [], "실행되면 물린 목록에서 뺀다");
});

test("릴리스가 없거나(404) 체크섬이 틀리면 실패하고 기록은 그대로다", async () => {
  const dir = fresh();
  const active = placed(dir, A);
  writeState(dir, { active, previous: null, rejected: [], pin: null });
  const missing = await alignFfmpeg({ dir, defaultRelease: B, io: fakeIo({}).io });
  assert.equal(missing.kind, "failed");
  assert.match(missing.kind === "failed" ? asText(missing.reason) : "", /없음/);
  const badSum = await alignFfmpeg({ dir, defaultRelease: B, io: fakeIo({ [B]: { body: "good", badSum: true } }).io });
  assert.match(badSum.kind === "failed" ? asText(badSum.reason) : "", /체크섬/);
  assert.deepEqual(stateOf(dir), { active, previous: null, rejected: [], pin: null });
});

test("고정: 성공하면 저장하고 다음 맞추기는 고정을 따른다. 실패하면 고정은 그대로. 풀면 기본값으로", async () => {
  const dir = fresh();
  writeState(dir, { active: placed(dir, B), previous: null, rejected: [], pin: null });
  const { io } = fakeIo({ [A]: { body: "good" } });
  assert.equal((await alignFfmpeg({ dir, defaultRelease: B, pin: A, io })).kind, "installed");
  assert.equal(stateOf(dir).pin, A);
  assert.equal((await alignFfmpeg({ dir, defaultRelease: B, io })).kind, "unchanged", "기본값이 B여도 고정한 A");

  assert.equal((await alignFfmpeg({ dir, defaultRelease: B, pin: C, io })).kind, "failed", "C는 원격에 없다");
  assert.equal(stateOf(dir).pin, A);

  assert.equal((await alignFfmpeg({ dir, defaultRelease: B, pin: null, io })).kind, "switched", "B는 이전 빌드");
  assert.equal(stateOf(dir).pin, null);
});

test("기록이 깨졌으면 옆으로 치우고 알린 뒤 새로 기록한다(말없이 고정을 잃지 않는다)", async () => {
  const dir = fresh();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), "{ 깨짐");
  const outcome = await alignFfmpeg({ dir, defaultRelease: B, io: fakeIo({ [B]: { body: "good" } }).io });
  assert.equal(outcome.kind, "installed");
  assert.equal(outcome.notes.length, 1);
  assert.match(asText(outcome.notes[0] ?? ""), /다시 고정하세요/);
  assert.equal(
    fs.readdirSync(dir).some((f) => f.startsWith("state.json.broken-")),
    true,
  );
});

test("이 플랫폼의 빌드가 없으면 예외를 던진다(스크립트가 먼저 거른다)", async () => {
  const { io } = fakeIo({});
  await assert.rejects(alignFfmpeg({ dir: fresh(), defaultRelease: B, io: { ...io, key: "darwin-arm64" } }), /darwin-arm64/);
});
