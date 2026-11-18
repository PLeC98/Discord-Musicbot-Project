// src/media/ffmpeg/state.ts, cli-args.ts: ffmpeg 기록 읽기(형식이 올바르지 않으면 깨진 것), install:ffmpeg의 인자. 정리는 ffmpeg-cleanup.test

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readState, writeState, isReleaseTag } from "../../src/media/ffmpeg/state.ts";
import { parseInstallArgs } from "../../src/media/ffmpeg/cli-args.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-state-"));
after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
let n = 0;
const fresh = () => {
  const dir = path.join(base, `dir-${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const R = "autobuild-2026-10-31-12-59";
const build = (folder: string) => ({ folder, release: R, asset: "a.zip", sha256: "x", version: "n9" });

test("기록: 없으면 none, 쓴 것은 그대로 읽힌다", () => {
  const dir = fresh();
  assert.deepEqual(readState(dir), { kind: "none" });
  const state = { active: build(`${R}-1`), previous: null, rejected: [R], pin: R };
  writeState(dir, state);
  assert.deepEqual(readState(dir), { kind: "ok", state });
});

test("기록: 형식이 올바르지 않으면 broken(vendor/ffmpeg 밖을 가리키는 폴더 이름, latest 같은 태그, 깨진 JSON)", () => {
  for (const text of [JSON.stringify({ active: build("../outside") }), JSON.stringify({ pin: "latest" }), JSON.stringify({ rejected: ["x"] }), "{ 깨짐"]) {
    const dir = fresh();
    fs.writeFileSync(path.join(dir, "state.json"), text);
    assert.equal(readState(dir).kind, "broken", text);
  }
});

test("릴리스 태그는 autobuild-YYYY-MM-DD-HH-MM 형식만", () => {
  assert.equal(isReleaseTag(R), true);
  for (const bad of ["latest", "autobuild-2026-10-31", "--force", "autobuild-2026-10-31-12-59/../x"]) assert.equal(isReleaseTag(bad), false, bad);
});

test("인자: --pin 태그, --pin=태그, --unpin, --force. 함께 쓸 수 없는 것과 틀린 태그는 오류", () => {
  assert.deepEqual(parseInstallArgs([]), { pin: undefined, force: false });
  assert.deepEqual(parseInstallArgs(["--pin", R]), { pin: R, force: false });
  assert.deepEqual(parseInstallArgs([`--pin=${R}`, "--force"]), { pin: R, force: true });
  assert.deepEqual(parseInstallArgs(["--", "--unpin"]), { pin: null, force: false });
  assert.ok("error" in parseInstallArgs(["--pin", R, "--unpin"]));
  assert.ok("error" in parseInstallArgs(["--pin"]));
  assert.ok("error" in parseInstallArgs(["--pin", "latest"]));
});
