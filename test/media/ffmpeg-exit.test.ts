// src/media/ffmpeg/exit.ts — ffmpeg 가 끝난 까닭(종료 코드 해독 · 남기는 방식)
//
// 지키는 것: Windows 의 부호 없는 32비트 코드를 부호 있는 AVERROR 로 되돌려 이름을 붙인다.
// 우리가 출력을 닫아 생긴 종료(파이프 쓰기 실패 · 우리가 보낸 신호)만 정리로 보고,
// 우리가 닫았더라도 다른 코드로 끝났으면 그 전에 이미 실패한 것으로 남긴다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { exitText, exitVerdict, isPipeWriteFailure, signedCode } from "../../src/media/ffmpeg/exit.ts";

const EINVAL_WIN = 4294967274; // -22
const INVALIDDATA_WIN = 3199971767; // -1094995529

test("Windows 의 종료 코드는 부호를 되돌려 이름을 붙인다", () => {
  assert.equal(signedCode(EINVAL_WIN, "win32"), -22);
  assert.equal(exitText(EINVAL_WIN, null, "win32"), "-22(EINVAL)");
  assert.equal(exitText(INVALIDDATA_WIN, null, "win32"), "-1094995529(INVALIDDATA)");
  assert.equal(exitText(1, null, "win32"), "1");
  assert.equal(exitText(null, "SIGKILL", "win32"), "SIGKILL");
  assert.equal(exitText(null, null, "win32"), "없음");
});

test("하위 8비트만 남는 OS 는 숫자 그대로 둔다", () => {
  assert.equal(signedCode(234, "linux"), null);
  assert.equal(exitText(234, null, "linux"), "234");
});

test("파이프 쓰기 실패: Windows 는 -22 · -32, 그 밖은 하위 8비트(234 · 224)", () => {
  assert.equal(isPipeWriteFailure(EINVAL_WIN, "win32"), true);
  assert.equal(isPipeWriteFailure(INVALIDDATA_WIN, "win32"), false);
  assert.equal(isPipeWriteFailure(1, "win32"), false);
  assert.equal(isPipeWriteFailure(256 - 32, "linux"), true);
});

test("남기는 방식: 비정상 신호 · 우리가 닫은 정리 · 스스로 실패 · 정상", () => {
  const v = (code: number | null, signal: string | null, closedByUs: boolean) => exitVerdict({ code, signal, closedByUs, platform: "win32" });
  assert.equal(v(null, "SIGSEGV", false), "crash");
  assert.equal(v(null, "SIGSEGV", true), "crash");
  // 스킵 · 위치 이동으로 우리가 닫았다
  assert.equal(v(EINVAL_WIN, null, true), "cleanup");
  assert.equal(v(null, "SIGKILL", true), "cleanup");
  assert.equal(v(0, null, true), "cleanup");
  // 우리가 닫았는데 다른 코드: 닫기 전에 이미 실패했다(close 가 exit 보다 먼저 와도 묻히지 않게)
  assert.equal(v(INVALIDDATA_WIN, null, true), "failed");
  assert.equal(v(INVALIDDATA_WIN, null, false), "failed");
  assert.equal(v(1, null, false), "failed");
  // 정상 종료 · 우리가 보낸 신호(HLS 세그먼트 건너뛰기 · 종료 정리)
  assert.equal(v(0, null, false), "ok");
  assert.equal(v(null, "SIGKILL", false), "ok");
});
