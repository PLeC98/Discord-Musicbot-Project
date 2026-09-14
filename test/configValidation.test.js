"use strict";

// config.js — 잘못 적은 설정값은 기동을 멈춘다 (2026-09-15 사용자 결정).
//
// 회귀 대상: `parseInt`가 "120junk"를 120으로 삼켜, 오타가 조용히 다른 값으로 돌던 것.
// 예전에는 경고 후 기본값이었다 — 로그를 보지 않는 사이 의도하지 않은 값으로 운영됐다.
//
// config는 require 시점에 검증하고 process.exit(1)을 부르므로 자식 프로세스로 확인한다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

/** 주어진 .env 값으로 config를 읽는 자식 프로세스 — { code, output } */
function loadConfig(env) {
  const probe = "const c = require('./config'); console.log('CFG:' + JSON.stringify({ port: c.dashboard.port, apiMax: c.dashboard.rateLimit.apiMax, website: c.bot.website }));";
  const r = spawnSync(process.execPath, ["-e", probe], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, DISCORD_TOKEN: "t", CLIENT_ID: "1", ...env },
  });
  const output = `${r.stdout}${r.stderr}`;
  // config는 기동 로그도 함께 뱉는다 — 표식을 붙여 그 줄만 집는다
  const marked = /CFG:(\{.*\})/.exec(output);
  return { code: r.status, output, cfg: marked ? JSON.parse(marked[1]) : null };
}

test("숫자 뒤에 글자가 붙으면 기동을 멈춘다 (parseInt가 삼키던 것)", () => {
  const { code, output } = loadConfig({ RATE_LIMIT_API_MAX: "120junk" });
  assert.equal(code, 1);
  assert.match(output, /RATE_LIMIT_API_MAX/);
  assert.match(output, /정수/);
});

test("허용 범위를 벗어나면 기동을 멈춘다 — 조용히 기본값으로 돌지 않는다", () => {
  const port = loadConfig({ DASHBOARD_PORT: "99999" });
  assert.equal(port.code, 1);
  assert.match(port.output, /DASHBOARD_PORT/);

  const heartbeat = loadConfig({ SSE_HEARTBEAT_SEC: "0" });
  assert.equal(heartbeat.code, 1, "0초 하트비트 같은 1ms급 타이머도 막는다");
});

test("주소 설정은 형식과 스킴을 본다", () => {
  assert.equal(loadConfig({ WEBSITE: "그냥 글자" }).code, 1);
  assert.equal(loadConfig({ WEBSITE: "javascript:alert(1)" }).code, 1, "http·https만");
  assert.equal(loadConfig({ WEBSITE: "https://example.com" }).code, 0);
});

test("비워 두는 것은 기본값을 쓰겠다는 뜻이라 통과한다", () => {
  const { code, cfg } = loadConfig({ DASHBOARD_PORT: "", WEBSITE: "", RATE_LIMIT_API_MAX: "  " });
  assert.equal(code, 0);
  assert.deepEqual(cfg, { port: 33333, apiMax: 120, website: null });
});

test("범위 안의 값은 그대로 쓴다", () => {
  const { code, cfg } = loadConfig({ DASHBOARD_PORT: "40000", RATE_LIMIT_API_MAX: "300" });
  assert.equal(code, 0);
  assert.equal(cfg.port, 40000);
  assert.equal(cfg.apiMax, 300);
});
