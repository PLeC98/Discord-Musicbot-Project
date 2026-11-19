// src/ui/ping-view.ts: /ping 화면(값마다 한 줄과 작은 줄, 다시 재기 버튼)

import { test } from "node:test";
import assert from "node:assert/strict";
import { pingView, type PingValues } from "../../src/ui/ping-view.ts";
import { LIMITS } from "../../src/rules/status-levels.ts";
import { textOf } from "../helpers/cv2.ts";

const base: PingValues = { responseMs: 186, restMs: 48, gatewayMs: 42, gatewayAverage: { minutes: 15, ms: 45 }, voiceMs: 31, again: true };
const text = (v: Partial<PingValues>) => textOf({ components: [pingView({ ...base, ...v })] });
const json = (v: Partial<PingValues>) => JSON.stringify(pingView({ ...base, ...v }).toJSON());

test("값마다 속도별 색, 이름, 값(코드 블록)과 무엇과 무엇 사이인지 작은 글씨 줄. 게이트웨이 옆에 기록 평균", () => {
  assert.equal(text({}), ["### 🏓 퐁!", "🟢 **응답 시간** `186ms`", "-# 명령 → 봇 → 응답", "🟢 **REST 왕복** `48ms`", "-# 봇 ↔ 디스코드 API", "🟢 **게이트웨이** `42ms` · 15분 평균 `45ms`", "-# 봇 ↔ 디스코드 연결", "🟢 **음성** `31ms`", "-# 봇 ↔ 이 서버의 음성 연결"].join("\n"));
  assert.ok(json({}).includes('"custom_id":"ping:again"'));
});

test("연결 지연은 대시보드의 핑 기준, 응답 시간은 1초, 2초 기준으로 색을 바꾼다", () => {
  const [warn, bad] = LIMITS.ping;
  assert.match(text({ restMs: warn, gatewayMs: bad, voiceMs: bad - 1, responseMs: 2000 }), /🔴 \*\*응답 시간\*\*[\s\S]*🟡 \*\*REST 왕복\*\*[\s\S]*🔴 \*\*게이트웨이\*\*[\s\S]*🟡 \*\*음성\*\*/);
  assert.match(text({ responseMs: 1000 }), /🟡 \*\*응답 시간\*\*/);
});

test("음성 채널에 없으면 음성 줄이 없고, 게이트웨이를 아직 못 쟀으면 측정 중, 기록이 없으면 평균이 없다. 서버 밖에서는 버튼이 없다", () => {
  const out = text({ voiceMs: null, gatewayMs: null, gatewayAverage: null });
  assert.equal(out.includes("음성"), false);
  assert.ok(out.includes("⚪ **게이트웨이** `측정 중...`"));
  assert.equal(text({ gatewayAverage: null }).includes("평균"), false);
  assert.equal(json({ again: false }).includes("ping:again"), false);
});
