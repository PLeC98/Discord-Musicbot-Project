// src/media/ffmpeg/path.ts: ffmpeg 경로 해석의 단일 출처.
//
// 재생과 캐시 변환은 같은 ffmpeg를 쓴다. 다르면 어느 바이너리가 도는지 알 수 없어 플랫폼별 빌드 결함을 진단할 수 없다.

import path from "node:path";
import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import os from "node:os";
import * as ffmpegPathModule from "../../src/media/ffmpeg/path.ts";
import { readState, writeState } from "../../src/media/ffmpeg/state.ts";
import { FFMPEG_RELEASE } from "../../src/config/vendor-versions.ts";

const { resolve, ffmpegPath, logResolved, settleRejected, ffmpegInfo } = ffmpegPathModule;
const { probe, _reset } = ffmpegPathModule._internals;

test("resolve: 실행 가능한 ffmpeg를 찾고 버전을 추출한다", () => {
  const info = resolve();
  assert.ok(info.path, "경로가 있어야 함");
  assert.ok(info.version && info.version !== "unknown", `버전 파싱: ${info.version}`);
  assert.ok(["FFMPEG_PATH", "설치본", "이전 설치본", "PATH"].includes(info.source), `출처: ${info.source}`);
});

test("resolve: 결과를 캐시한다. 매 호출마다 프로세스를 실행하지 않는다", () => {
  assert.equal(resolve(), resolve(), "동일 객체를 돌려줘야 함");
  assert.equal(ffmpegPath(), resolve().path);
});

test("probe: ffmpeg가 아닌 것은 거부한다", () => {
  assert.equal(probe(null), null);
  assert.equal(probe(path.join(import.meta.dirname, "..", "does-not-exist-ffmpeg")), null);
  // node는 실행은 되지만 `-version`에 'ffmpeg version'을 출력하지 않는다 → 거부돼야 한다
  assert.equal(probe(process.execPath), null, "아무 실행 파일이나 통과시키면 안 됨");
});

test("probe: 실제 ffmpeg는 버전 문자열을 돌려준다", () => {
  const version = probe(resolve().path);
  assert.ok(version, "버전을 뽑아야 함");
  assert.match(version, /\d/, `버전에 숫자가 있어야 함: ${version}`);
});

test("logResolved: 예외를 던지지 않고 해석 정보를 돌려준다 (기동 경로)", () => {
  const info = logResolved();
  assert.equal(info.path, resolve().path);
});

test("_reset 후에도 같은 바이너리로 다시 해석된다 (캐시 초기화 안전)", () => {
  const before = resolve().path;
  _reset();
  assert.equal(resolve().path, before);
});

test("설치본이 실행되지 않으면 이전 설치본으로 뜨고, 기동 뒤 기록을 그쪽으로 되돌려 물린다", async (t) => {
  _reset();
  const real = resolve().path;
  if (!path.isAbsolute(real)) return t.skip("파일로 된 ffmpeg가 없다(PATH의 ffmpeg)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-path-"));
  t.after(() => {
    _reset();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });
  const bin = path.basename(real);
  const make = (release: string, good: boolean) => {
    const folder = `${release}-1`;
    fs.mkdirSync(path.join(dir, folder));
    if (good) fs.copyFileSync(real, path.join(dir, folder, bin));
    else fs.writeFileSync(path.join(dir, folder, bin), "실행 파일이 아니다");
    return { folder, release, asset: "a", sha256: "x", version: "v" };
  };
  const good = make("autobuild-2026-09-30-12-59", true);
  const broken = make("autobuild-2026-10-31-12-59", false);
  writeState(dir, { active: broken, previous: good, rejected: [], pin: null });

  _reset();
  const info = resolve(dir);
  assert.equal(info.source, "이전 설치본");
  assert.equal(info.release, good.release);
  await settleRejected(dir);
  const read = readState(dir);
  assert.equal(read.kind, "ok");
  if (read.kind === "ok") assert.deepEqual([read.state.active?.folder, read.state.previous, read.state.rejected], [good.folder, null, [broken.release]]);
});

test("ffmpegInfo: 지금 쓰는 ffmpeg와 기록의 고정, 물린 릴리스, 기본 릴리스를 반환하고, 부를 때마다 기록을 새로 읽는다", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-info-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  const pin = "autobuild-2026-09-30-12-59";
  writeState(dir, { active: null, previous: null, rejected: ["autobuild-2026-08-31-12-59"], pin });
  const info = ffmpegInfo(dir);
  assert.ok(info);
  assert.deepEqual([info.pin, info.rejected, info.defaultRelease], [pin, ["autobuild-2026-08-31-12-59"], FFMPEG_RELEASE]);
  assert.ok(["env", "installed", "previous", "path"].includes(info.source));
  writeState(dir, { active: null, previous: null, rejected: [], pin: null });
  assert.equal(ffmpegInfo(dir)?.pin, null, "기록을 다시 읽는다");
});
