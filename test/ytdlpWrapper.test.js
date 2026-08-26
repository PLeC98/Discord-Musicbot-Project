"use strict";

// src/ytdlp.js — youtube-dl-exec 드롭인 래퍼의 계약.
//
// 왜 래퍼가 필요한가: 원본 youtubedl(url, flags)는 Promise만 돌려줘 spawn된 프로세스를 잡을 수 없다.
// 그래서 봇을 종료해도 yt-dlp와 그 자식 ffmpeg가 고아로 남아 무한 다운로드를 계속했다.
// 래퍼는 pid를 노출하는 .exec()로 우회해 ChildProcessRegistry에 등록한다.
//
// 회귀 위험: 우회 과정에서 반환/오류 모양을 직접 재구현했다 — 원본과 어긋나면
// isAgeRestrictedError/isVideoUnavailableError(error.stderr를 읽는다)가 조용히 오작동한다.
// 그래서 원본과 나란히 돌려 동등성을 확인한다. 네트워크 없이 yt-dlp 바이너리만 사용.

const fs = require("node:fs");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const youtubedl = require("youtube-dl-exec");
const run = require("../src/ytdlp");
const registry = require("../src/ChildProcessRegistry");

const BINARY = youtubedl.constants.YOUTUBE_DL_PATH;
const hasBinary = fs.existsSync(BINARY);
const opts = { skip: hasBinary ? false : `yt-dlp 바이너리 없음 (${BINARY})` };

test("성공 계약: 원본과 같은 값을 돌려주고 프로세스 등록을 해제한다", opts, async () => {
  const before = registry.size();
  const [mine, theirs] = await Promise.all([run("--version"), youtubedl("--version")]);

  assert.equal(mine, theirs, "원본과 동일한 반환값");
  assert.match(String(mine), /^\d{4}\.\d{2}\.\d{2}/, "yt-dlp 버전 문자열");
  assert.equal(registry.size(), before, "정상 종료 후 레지스트리에 남으면 안 된다(누수)");
});

test("실패 계약: stderr를 담은 Error — 연령제한/삭제영상 판별이 이걸 읽는다", opts, async () => {
  const before = registry.size();

  const mine = await run("--definitely-bogus-flag").then(
    () => null,
    (e) => e,
  );
  const theirs = await youtubedl("--definitely-bogus-flag").then(
    () => null,
    (e) => e,
  );

  assert.ok(mine instanceof Error, "실패는 Error로 던져야 한다");
  assert.match(mine.stderr, /no such option/i, "stderr가 실려 있어야 한다");
  assert.equal(mine.message, mine.stderr, "원본과 같이 message = stderr");
  assert.equal(mine.stderr, theirs && theirs.stderr, "원본과 같은 stderr");
  assert.notEqual(mine.exitCode, 0);

  assert.equal(registry.size(), before, "실패해도 레지스트리에 남으면 안 된다(누수)");
});

test("실행 중에는 레지스트리가 프로세스를 추적한다", opts, async () => {
  const before = registry.size();
  const pending = run("--version");
  assert.equal(registry.size(), before + 1, "실행 중에는 추적되어야 종료 시 정리할 수 있다");
  await pending.catch(() => {});
  assert.equal(registry.size(), before);
});
