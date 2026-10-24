import test from "node:test";
import assert from "node:assert/strict";
import { createCorsOptions, normalizeDashboardOrigin } from "../../src/dashboard/cors.ts";

function isAllowed(options: ReturnType<typeof createCorsOptions>, origin: string | undefined) {
  return new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => {
      if (error) reject(error);
      else resolve(allowed);
    });
  });
}

test("기본 실행은 대시보드 주소 하나만 허용한다 (개발 서버 포함 안 함)", async () => {
  const options = createCorsOptions("https://dashboard.example.com/");
  assert.equal(await isAllowed(options, "https://dashboard.example.com"), true);
  assert.equal(await isAllowed(options, "https://evil.example"), false);
  assert.equal(await isAllowed(options, "http://localhost:5173"), false);
});

// 개발 서버 출처는 `pnpm run dev`가 켤 때만 연다. NODE_ENV 로 가르면 평상시 실행이 열린 쪽이 되어 운영자가 닫는 것을 기억해야 한다.
test("개발 서버(5173)는 명시적으로 켰을 때만 허용한다", async () => {
  const options = createCorsOptions("http://localhost:33333", { allowDevOrigin: true });
  assert.equal(await isAllowed(options, "http://localhost:33333"), true);
  assert.equal(await isAllowed(options, "http://localhost:5173"), true);
  assert.equal(await isAllowed(options, "http://localhost:5174"), false);

  const closed = createCorsOptions("http://localhost:33333");
  assert.equal(await isAllowed(closed, "http://localhost:5173"), false, "켜지 않으면 막힌다");
});

test("Origin 헤더가 없는 요청(브라우저가 아닌 호출)은 통과", async () => {
  const options = createCorsOptions("https://dashboard.example.com");
  assert.equal(await isAllowed(options, undefined), true);
});

test("형식이 깨졌거나 출처를 헷갈리게 만든 값은 거부", async () => {
  const options = createCorsOptions("https://dashboard.example.com");
  assert.equal(await isAllowed(options, "not a url"), false);
  assert.equal(await isAllowed(options, "https://dashboard.example.com.evil.example"), false);
  assert.equal(await isAllowed(options, "https://dashboard.example.com@evil.example"), false);
});

test("DASHBOARD_URL은 평범한 http·https 출처여야 한다", () => {
  assert.equal(normalizeDashboardOrigin("https://dashboard.example.com/path"), "https://dashboard.example.com");
  assert.throws(() => normalizeDashboardOrigin("javascript:alert(1)"), /http 나 https/);
  assert.throws(() => normalizeDashboardOrigin("https://user:pass@example.com"), /계정 · 쿼리 · 조각 없는 주소/);
  assert.throws(() => normalizeDashboardOrigin("https://example.com/?next=evil"), /계정 · 쿼리 · 조각 없는 주소/);
});
