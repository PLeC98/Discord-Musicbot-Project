import test from "node:test";
import assert from "node:assert/strict";
import cors from "../../dashboard/server/cors.js";
const { createCorsOptions, normalizeDashboardOrigin } = cors;

function isAllowed(options, origin) {
  return new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => {
      if (error) reject(error);
      else resolve(allowed);
    });
  });
}

test("기본 실행은 대시보드 주소 하나만 허용한다 (개발 서버 포함 안 함)", async () => {
  const options = createCorsOptions("https://discord.plec.moe/");
  assert.equal(await isAllowed(options, "https://discord.plec.moe"), true);
  assert.equal(await isAllowed(options, "https://evil.example"), false);
  assert.equal(await isAllowed(options, "http://localhost:5173"), false);
});

// 예전에는 NODE_ENV !== "production"이 기준이라 평상시 실행이 허용 쪽이었다 —
// 닫으려면 운영자가 기억해야 했다. 이제 `pnpm run dev`가 켤 때만 열린다.
test("개발 서버(5173)는 명시적으로 켰을 때만 허용한다", async () => {
  const options = createCorsOptions("http://localhost:33333", { allowDevOrigin: true });
  assert.equal(await isAllowed(options, "http://localhost:33333"), true);
  assert.equal(await isAllowed(options, "http://localhost:5173"), true);
  assert.equal(await isAllowed(options, "http://localhost:5174"), false);

  const closed = createCorsOptions("http://localhost:33333");
  assert.equal(await isAllowed(closed, "http://localhost:5173"), false, "켜지 않으면 막힌다");
});

test("Origin 헤더가 없는 요청(브라우저가 아닌 호출)은 통과", async () => {
  const options = createCorsOptions("https://discord.plec.moe");
  assert.equal(await isAllowed(options, undefined), true);
});

test("형식이 깨졌거나 출처를 헷갈리게 만든 값은 거부", async () => {
  const options = createCorsOptions("https://discord.plec.moe");
  assert.equal(await isAllowed(options, "not a url"), false);
  assert.equal(await isAllowed(options, "https://discord.plec.moe.evil.example"), false);
  assert.equal(await isAllowed(options, "https://discord.plec.moe@evil.example"), false);
});

test("DASHBOARD_URL은 평범한 http·https 출처여야 한다", () => {
  assert.equal(normalizeDashboardOrigin("https://discord.plec.moe/path"), "https://discord.plec.moe");
  assert.throws(() => normalizeDashboardOrigin("javascript:alert(1)"), /http or https/);
  assert.throws(() => normalizeDashboardOrigin("https://user:pass@example.com"), /plain origin/);
  assert.throws(() => normalizeDashboardOrigin("https://example.com/?next=evil"), /plain origin/);
});
