"use strict";

// src/ffmpegPath.js — ffmpeg 경로 해석의 단일 출처.
//
// 회귀 대상: 재생과 캐시 변환이 서로 다른 ffmpeg를 쓰던 문제. 어느 바이너리가 도는지
// 알 수 없어 플랫폼별 빌드 결함을 진단할 수 없었다.

const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const ffmpegPathModule = require("../src/ffmpegPath");
const { resolve, ffmpegPath, logResolved } = ffmpegPathModule;
const { probe, _reset } = ffmpegPathModule._internals;

test("resolve: 실행 가능한 ffmpeg를 찾고 버전을 뽑아낸다", () => {
  const info = resolve();
  assert.ok(info.path, "경로가 있어야 함");
  assert.ok(info.version && info.version !== "unknown", `버전 파싱: ${info.version}`);
  assert.ok(["FFMPEG_PATH", "ffmpeg-static", "PATH"].includes(info.source), `출처: ${info.source}`);
});

test("resolve: 결과를 캐시한다 — 매 호출마다 프로세스를 띄우지 않는다", () => {
  assert.equal(resolve(), resolve(), "동일 객체를 돌려줘야 함");
  assert.equal(ffmpegPath(), resolve().path);
});

test("probe: ffmpeg가 아닌 것은 거부한다", () => {
  assert.equal(probe(null), null);
  assert.equal(probe(path.join(__dirname, "does-not-exist-ffmpeg")), null);
  // node는 실행은 되지만 `-version`에 'ffmpeg version'을 출력하지 않는다 → 거부돼야 한다
  assert.equal(probe(process.execPath), null, "아무 실행 파일이나 통과시키면 안 됨");
});

test("probe: 실제 ffmpeg는 버전 문자열을 돌려준다", () => {
  const version = probe(resolve().path);
  assert.ok(version, "버전을 뽑아야 함");
  assert.match(version, /\d/, `버전에 숫자가 있어야 함: ${version}`);
});

test("logResolved: 던지지 않고 해석 정보를 돌려준다 (기동 경로)", () => {
  const info = logResolved();
  assert.equal(info.path, resolve().path);
});

test("_reset 후에도 같은 바이너리로 다시 해석된다 (캐시 초기화 안전)", () => {
  const before = resolve().path;
  _reset();
  assert.equal(resolve().path, before);
});
