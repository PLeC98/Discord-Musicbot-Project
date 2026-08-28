"use strict";

// scripts/install-ffmpeg.js — 내려받을 자산의 좌표.
//
// 회귀 대상: 움직이는 태그(latest)를 쓰면 이름이 같은 채 내용물이 바뀌어 환경마다 다른
// 바이너리가 깔린다. 버전을 올릴 때 RELEASE와 VERSION 중 하나만 바꾸는 실수도 막는다.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { RELEASE, VERSION, VARIANT, TARGETS, BASE_URL, assetNameFor } = require("../scripts/install-ffmpeg");

test("릴리스는 움직이지 않는 태그로 고정한다", () => {
  assert.match(RELEASE, /^autobuild-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/, `latest 같은 움직이는 태그 금지: ${RELEASE}`);
  assert.ok(BASE_URL.endsWith(`/${RELEASE}`), BASE_URL);
});

test("자산 이름은 커밋까지 박힌 버전을 쓴다 (태그와 함께 갱신되어야 함)", () => {
  assert.match(VERSION, /^n\d+\.\d+\.\d+-\d+-g[0-9a-f]+$/, `커밋 해시가 없으면 고정이 아니다: ${VERSION}`);
});

test("LGPL 빌드 — 오디오만 쓰므로 GPL 전용 코덱은 불필요하고 라이선스 부담만 는다", () => {
  assert.equal(VARIANT, "lgpl");
});

test("BtbN이 제공하는 4개 플랫폼만 대상으로 한다", () => {
  assert.deepEqual(Object.keys(TARGETS).sort(), ["linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]);
});

test("플랫폼별 자산 이름이 BtbN 명명 규칙과 맞는다", () => {
  assert.equal(assetNameFor("linux-x64"), `ffmpeg-${VERSION}-linux64-lgpl-9.0.tar.xz`);
  assert.equal(assetNameFor("linux-arm64"), `ffmpeg-${VERSION}-linuxarm64-lgpl-9.0.tar.xz`);
  assert.equal(assetNameFor("win32-x64"), `ffmpeg-${VERSION}-win64-lgpl-9.0.zip`);
  assert.equal(assetNameFor("win32-arm64"), `ffmpeg-${VERSION}-winarm64-lgpl-9.0.zip`);
});

test("미지원 플랫폼은 null — macOS는 PATH/FFMPEG_PATH로 처리한다", () => {
  for (const key of ["darwin-x64", "darwin-arm64", "linux-arm", "freebsd-x64"]) {
    assert.equal(assetNameFor(key), null, key);
  }
});

test("확장자는 플랫폼에 맞는다 (윈도우 zip은 bsdtar만 읽는다)", () => {
  assert.equal(TARGETS["win32-x64"].ext, "zip");
  assert.equal(TARGETS["linux-x64"].ext, "tar.xz");
  assert.equal(TARGETS["win32-x64"].bin, "ffmpeg.exe");
  assert.equal(TARGETS["linux-x64"].bin, "ffmpeg");
});
