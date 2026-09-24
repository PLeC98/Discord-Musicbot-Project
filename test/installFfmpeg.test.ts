// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// scripts/install-ffmpeg.js — 어느 릴리스에서 어느 자산을 받을지.
//
// 회귀 대상 둘:
// 1. 움직이는 태그(latest)를 쓰면 이름이 같은 채 내용물이 바뀌어 환경마다 다른 바이너리가 깔린다.
//    게다가 BtbN은 일반 autobuild를 2주만 보관하므로 월말 빌드여야 고정이 유지된다(2년 보관).
// 2. `FFMPEG_PATH=   # 설명` 처럼 값이 비고 주석만 있는 줄을 값으로 읽어, 설정한 적 없는 사용자가
//    내려받기를 영영 건너뛰던 것(2026-09-15 사용자 보고 — --force로도 빠져나올 수 없었다).

import { test } from "node:test";
import assert from "node:assert/strict";

import installFfmpeg from "../scripts/install-ffmpeg.ts";
const { DEFAULT_RELEASE, VARIANT, TARGETS, RELEASES_URL, resolveAsset, readEnvValue } = installFfmpeg;

// 실제 릴리스의 checksums.sha256 일부 — 한 릴리스에 브랜치가 여럿 들어 있다
const CHECKSUMS = [
  "aaa1  ffmpeg-N-126342-gf88b741dbf-linux64-lgpl.tar.xz",
  "aaa2  ffmpeg-n8.1.2-50-g1a748fe2cd-linux64-lgpl-8.1.tar.xz",
  "aaa3  ffmpeg-n9.0.1-11-ge47273f4d9-linux64-lgpl-9.0.tar.xz",
  "aaa4  ffmpeg-n9.0.1-11-ge47273f4d9-linux64-lgpl-shared-9.0.tar.xz",
  "aaa5  ffmpeg-n9.0.1-11-ge47273f4d9-linux64-gpl-9.0.tar.xz",
  "bbb1  ffmpeg-n9.0.1-11-ge47273f4d9-win64-lgpl-9.0.zip",
  "bbb2  ffmpeg-n8.1.2-50-g1a748fe2cd-win64-lgpl-8.1.zip",
  "ccc1  ffmpeg-n9.0.1-11-ge47273f4d9-linuxarm64-lgpl-9.0.tar.xz",
  "ddd1  ffmpeg-n9.0.1-11-ge47273f4d9-winarm64-lgpl-9.0.zip",
].join("\n");

test("릴리스는 월말 autobuild 태그로 고정한다 — 그 외에는 2주 뒤 404", () => {
  const match = /^autobuild-(\d{4})-(\d{2})-(\d{2})-\d{2}-\d{2}$/.exec(DEFAULT_RELEASE);
  assert.ok(match, `latest 같은 움직이는 태그 금지: ${DEFAULT_RELEASE}`);

  const [, year, month, day] = match.map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  assert.equal(day, lastDay, `${year}-${month}의 마지막 날이어야 한다 (월말 빌드만 2년 보관): ${DEFAULT_RELEASE}`);
  assert.ok(RELEASES_URL.startsWith("https://github.com/BtbN/FFmpeg-Builds/"), RELEASES_URL);
});

test("LGPL 빌드 — 오디오만 쓰므로 GPL 전용 코덱은 불필요하고 라이선스 부담만 는다", () => {
  assert.equal(VARIANT, "lgpl");
});

test("BtbN이 제공하는 4개 플랫폼만 대상으로 한다", () => {
  assert.deepEqual(Object.keys(TARGETS).sort(), ["linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]);
  assert.equal(TARGETS["win32-x64"].ext, "zip");
  assert.equal(TARGETS["linux-x64"].ext, "tar.xz");
  assert.equal(TARGETS["win32-x64"].bin, "ffmpeg.exe");
  assert.equal(TARGETS["linux-x64"].bin, "ffmpeg");
});

test("자산은 릴리스의 체크섬 목록에서 고른다 — 최신 릴리스 브랜치, 공유 라이브러리 아님", () => {
  const linux = resolveAsset(CHECKSUMS, "linux-x64");
  assert.equal(linux.assetName, "ffmpeg-n9.0.1-11-ge47273f4d9-linux64-lgpl-9.0.tar.xz", "8.1이 아니라 9.0");
  assert.equal(linux.sha256, "aaa3");
  assert.equal(linux.branch, "9.0");
  assert.equal(linux.version, "n9.0.1-11-ge47273f4d9");

  assert.equal(resolveAsset(CHECKSUMS, "win32-x64").assetName, "ffmpeg-n9.0.1-11-ge47273f4d9-win64-lgpl-9.0.zip");
  assert.equal(resolveAsset(CHECKSUMS, "linux-arm64").sha256, "ccc1");
  assert.equal(resolveAsset(CHECKSUMS, "win32-arm64").sha256, "ddd1");
});

test("미지원 플랫폼은 null — macOS는 PATH/FFMPEG_PATH로 처리한다", () => {
  for (const key of ["darwin-x64", "darwin-arm64", "linux-arm", "freebsd-x64"]) {
    assert.equal(resolveAsset(CHECKSUMS, key), null, key);
  }
});

test("쓸 수 있는 빌드가 없으면 조용히 엉뚱한 것을 받지 않고 던진다", () => {
  const onlyShared = "aaa4  ffmpeg-n9.0.1-11-ge47273f4d9-linux64-lgpl-shared-9.0.tar.xz";
  assert.throws(() => resolveAsset(onlyShared, "linux-x64"), /빌드가 없습니다/);
});

test(".env 값 읽기: 인라인 주석은 값이 아니다", () => {
  const env = ["# 주석 줄", "FFMPEG_PATH=                    # macOS는 번들을 제공하지 않으므로 여기서 지정하세요", "FFMPEG_RELEASE=autobuild-2026-08-31-13-27   # 월말 빌드", 'QUOTED="C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe"', "export EXPORTED=/usr/bin/ffmpeg", "EMPTY="].join("\n");

  assert.equal(readEnvValue("FFMPEG_PATH", env), null, "설명문을 경로로 읽으면 안 된다");
  assert.equal(readEnvValue("FFMPEG_RELEASE", env), "autobuild-2026-08-31-13-27");
  assert.equal(readEnvValue("QUOTED", env), "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe", "따옴표 안의 공백·#은 값이다");
  assert.equal(readEnvValue("EXPORTED", env), "/usr/bin/ffmpeg");
  assert.equal(readEnvValue("EMPTY", env), null);
  assert.equal(readEnvValue("ABSENT", env), null);
});
