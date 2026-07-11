"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCorsOptions, normalizeDashboardOrigin } = require("../dashboard/server/cors");

function isAllowed(options, origin) {
  return new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => {
      if (error) reject(error);
      else resolve(allowed);
    });
  });
}

test("allows only the configured dashboard origin in production", async () => {
  const options = createCorsOptions("https://discord.plec.moe/", "production");
  assert.equal(await isAllowed(options, "https://discord.plec.moe"), true);
  assert.equal(await isAllowed(options, "https://evil.example"), false);
  assert.equal(await isAllowed(options, "http://localhost:5173"), false);
});

test("allows the Vite origin only outside production", async () => {
  const options = createCorsOptions("http://localhost:33333", "development");
  assert.equal(await isAllowed(options, "http://localhost:33333"), true);
  assert.equal(await isAllowed(options, "http://localhost:5173"), true);
  assert.equal(await isAllowed(options, "http://localhost:5174"), false);
});

test("allows non-browser requests without an Origin header", async () => {
  const options = createCorsOptions("https://discord.plec.moe", "production");
  assert.equal(await isAllowed(options, undefined), true);
});

test("rejects malformed and origin-confusion inputs", async () => {
  const options = createCorsOptions("https://discord.plec.moe", "production");
  assert.equal(await isAllowed(options, "not a url"), false);
  assert.equal(await isAllowed(options, "https://discord.plec.moe.evil.example"), false);
  assert.equal(await isAllowed(options, "https://discord.plec.moe@evil.example"), false);
});

test("validates DASHBOARD_URL as an HTTP origin", () => {
  assert.equal(normalizeDashboardOrigin("https://discord.plec.moe/path"), "https://discord.plec.moe");
  assert.throws(() => normalizeDashboardOrigin("javascript:alert(1)"), /http or https/);
  assert.throws(() => normalizeDashboardOrigin("https://user:pass@example.com"), /plain origin/);
  assert.throws(() => normalizeDashboardOrigin("https://example.com/?next=evil"), /plain origin/);
});
