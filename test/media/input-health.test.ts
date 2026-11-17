// src/media/input-health.ts: 오디오 입력 하나가 온전히 끝났는지 적는 것

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { InputHealth, refusedStatus } from "../../src/media/input-health.ts";

const child = () => new EventEmitter();

test("ffmpeg가 0으로 끝나면 온전하다", () => {
  const ffmpeg = child();
  const health = new InputHealth("파일").watch(ffmpeg);
  assert.equal(health.exitCode, null, "끝나기 전에는 모른다");
  ffmpeg.emit("exit", 0, null);
  assert.equal(health.exitCode, 0);
  assert.equal(health.broken, null);
});

test("0이 아닌 코드나 신호로 끝나면 깨진 것이다. 신호는 -1로 적는다", () => {
  const coded = child();
  const a = new InputHealth("파일").watch(coded);
  coded.emit("exit", 1, null);
  assert.equal(a.exitCode, 1);
  assert.equal(a.broken, "ffmpeg 종료 코드 1");

  const killed = child();
  const b = new InputHealth("파일").watch(killed);
  killed.emit("exit", null, "SIGKILL");
  assert.equal(b.exitCode, -1);
  assert.equal(b.broken, "ffmpeg 종료 코드 SIGKILL");
});

test("먼저 온 원인을 지킨다. 입력을 닫아 ffmpeg가 0으로 끝나도 깨진 채로 남는다", () => {
  const ffmpeg = child();
  const health = new InputHealth("파일").watch(ffmpeg);
  health.mark("입력 스트림 오류");
  ffmpeg.emit("exit", 1, null);
  assert.equal(health.broken, "입력 스트림 오류");

  const closed = child();
  const h2 = new InputHealth("파일").watch(closed);
  h2.mark("입력 스트림 오류");
  closed.emit("exit", 0, null);
  assert.equal(h2.broken, "입력 스트림 오류");
});

test("주소가 거절된 오류: 4xx면 그 상태, 범위 탓(416), 5xx, 네트워크 오류는 아니다", () => {
  assert.equal(refusedStatus(Object.assign(new Error("Range 요청 실패: HTTP 403"), { status: 403 })), 403);
  assert.equal(refusedStatus(Object.assign(new Error("x"), { status: 410 })), 410);
  assert.equal(refusedStatus(Object.assign(new Error("x"), { status: 416 })), null);
  assert.equal(refusedStatus(Object.assign(new Error("x"), { status: 503 })), null);
  assert.equal(refusedStatus(new Error("ECONNRESET")), null);
  assert.equal(refusedStatus(null), null);
});
