// src/rules/end-verdict.ts — 곡이 멈췄을 때 끝인가 끊김인가. 판정표의 행마다 고정한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { endVerdict, type EndFacts } from "../../src/rules/end-verdict.ts";

// 온전히 끝난 VOD 가 기준. 시험마다 한 칸씩 바꾼다
const facts = (over: Partial<EndFacts> = {}): EndFacts => ({
  reason: "idle",
  live: false,
  streamEnded: true,
  broken: null,
  exitCode: 0,
  positionMs: 100_000,
  lengthMs: 200_000,
  ...over,
});
const dropped = (over: Partial<EndFacts>) => endVerdict(facts(over)).dropped;

test("온전히 끝났으면 길이보다 한참 일찍이어도 끝이다(길이는 판정에 쓰지 않는다)", () => {
  assert.deepEqual(endVerdict(facts({ positionMs: 30_000 })), { dropped: false, why: "입력 끝" });
  assert.equal(dropped({ lengthMs: null }), false);
  assert.equal(dropped({ exitCode: null }), false, "종료 코드가 아직 안 왔어도 스트림이 끝까지 읽혔으면 끝");
});

test("우리가 멈춘 것은 그 까닭대로: 깨진 재생을 멈춘 까닭이면 끊김, 그 밖은 끝", () => {
  for (const reason of ["stream-error", "buffering-stall", "error"]) assert.equal(dropped({ reason, streamEnded: false }), true, reason);
  for (const reason of ["skip", "stop", "previous", "jump", "sponsorblock", "overflow", "stuck", "모르는-까닭"]) {
    assert.equal(dropped({ reason, streamEnded: false, broken: "입력 스트림 오류", exitCode: -1 }), false, reason);
  }
});

test("재생 스트림이 끝까지 읽히지 않고 멈췄으면(공급 부족) 끊김", () => {
  assert.deepEqual(endVerdict(facts({ streamEnded: false })), { dropped: true, why: "공급이 끊겨 플레이어가 멈춤" });
});

test("입력 깨짐 표시가 있으면 스트림이 끝까지 읽혔어도 끊김. 까닭은 표시 그대로", () => {
  assert.deepEqual(endVerdict(facts({ broken: "입력 스트림 오류: 끊김" })), { dropped: true, why: "입력 스트림 오류: 끊김" });
});

test("라이브: 0 으로 끝나고 입력이 온전하면 방송이 끝난 것, 그 밖(아직 안 끝남 · 0 아님 · 깨짐)은 끊김", () => {
  const live = { live: true, lengthMs: null };
  assert.deepEqual(endVerdict(facts({ ...live, exitCode: 0 })), { dropped: false, why: "방송이 끝남" });
  assert.equal(dropped({ ...live, exitCode: null }), true);
  assert.equal(dropped({ ...live, exitCode: 1 }), true);
  assert.equal(dropped({ ...live, exitCode: 0, broken: "입력 스트림 오류" }), true);
  assert.equal(endVerdict(facts({ ...live, exitCode: null })).why, "ffmpeg 종료 코드 없음");
});

test("되감기 방지: 끊겼어도 다시 열 위치가 길이 끝 1.5초 안이면 끝", () => {
  assert.equal(dropped({ streamEnded: false, positionMs: 198_499 }), true);
  const atEnd = endVerdict(facts({ streamEnded: false, positionMs: 198_500 }));
  assert.equal(atEnd.dropped, false);
  assert.equal(atEnd.why, "공급이 끊겨 플레이어가 멈춤. 끝에 닿아 다시 열지 않음");
  assert.equal(dropped({ reason: "stream-error", positionMs: 199_000 }), false, "우리가 멈춘 끊김에도 건다");
  assert.equal(dropped({ streamEnded: false, positionMs: 500_000, lengthMs: null }), true, "길이를 모르면 걸 수 없다");
});
