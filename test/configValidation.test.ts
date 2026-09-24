// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// config.js — 잘못 적은 설정값은 기동을 멈춘다 (2026-09-15 사용자 결정).
//
// 회귀 대상: `parseInt`가 "120junk"를 120으로 삼켜, 오타가 조용히 다른 값으로 돌던 것.
// 예전에는 경고 후 기본값이었다 — 로그를 보지 않는 사이 의도하지 않은 값으로 운영됐다.
//
// config 는 불러와도 멈추지 않고 문제 목록을 낸다. 멈추는 것은 기동(index.js)의 첫 줄이다.
// 값 계산은 loadConfig 순수 함수라 바로 부른다.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { spawnSync } from "child_process";
import { loadConfig } from "../config.ts";
import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const ROOT = path.join(import.meta.dirname, "..");

/** 주어진 환경 변수로 설정을 계산한다 — { problems, cfg } */
function load(env, opts) {
  const { config: c, problems, warnings } = loadConfig({ DISCORD_TOKEN: "t", CLIENT_ID: "1", CLIENT_SECRET: "s", SPOTIFY_CLIENT_ID: "a", SPOTIFY_CLIENT_SECRET: "b", ...env }, opts);
  return { problems, warnings, cfg: { port: c.dashboard.port, apiMax: c.dashboard.rateLimit.apiMax, website: c.bot.website, queueMax: c.bot.maxQueueSize } };
}

test("숫자 뒤에 글자가 붙으면 문제다 (parseInt가 삼키던 것)", () => {
  const { problems } = load({ RATE_LIMIT_API_MAX: "120junk" });
  assert.deepEqual(problems, [".env의 RATE_LIMIT_API_MAX 값이 잘못됐습니다 (120junk): 정수만 쓸 수 있습니다. 고친 뒤 다시 실행하세요."]);
});

test("허용 범위를 벗어나면 문제다 — 조용히 기본값으로 돌지 않는다", () => {
  assert.match(load({ DASHBOARD_PORT: "99999" }).problems.join(), /DASHBOARD_PORT.*65535 이하/);
  assert.equal(load({ SSE_HEARTBEAT_SEC: "0" }).problems.length, 1, "0초 하트비트 같은 1ms급 타이머도 막는다");
});

test("주소 설정은 형식과 스킴을 본다", () => {
  assert.equal(load({ WEBSITE: "그냥 글자" }).problems.length, 1);
  assert.equal(load({ WEBSITE: "javascript:alert(1)" }).problems.length, 1, "http·https만");
  assert.deepEqual(load({ WEBSITE: "https://example.com" }).problems, []);
});

// 틀린 색을 그대로 두면 임베드를 보낼 때마다 던진다. 기동에서 멈춘다
test("임베드 색은 #RRGGBB 만 받는다", () => {
  assert.deepEqual(load({ EMBED_COLOR: "#2743d2" }).problems, []);
  for (const bad of ["blue", "#12345", "2743D2", "#GGGGGG"]) assert.equal(load({ EMBED_COLOR: bad }).problems.length, 1, bad);
  assert.equal(loadConfig({ DISCORD_TOKEN: "t", CLIENT_ID: "1" }).config.bot.embedColor, "#2743D2", "비우면 기본 색");
});

test("비워 두는 것은 기본값을 쓰겠다는 뜻이라 통과한다", () => {
  const { problems, cfg } = load({ DASHBOARD_PORT: "", WEBSITE: "", RATE_LIMIT_API_MAX: "  ", QUEUE_MAX_TRACKS: "" });
  assert.deepEqual(problems, []);
  assert.deepEqual(cfg, { port: 33333, apiMax: 120, website: null, queueMax: 250 });
});

test("대기열 상한은 0(끔)이거나 25 이상이다", () => {
  assert.match(load({ QUEUE_MAX_TRACKS: "10" }).problems.join(), /QUEUE_MAX_TRACKS/, "사전 캐싱 버퍼보다 작은 대기열은 막는다");
  assert.equal(load({ QUEUE_MAX_TRACKS: "0" }).cfg.queueMax, 0);
  assert.equal(load({ QUEUE_MAX_TRACKS: "25" }).cfg.queueMax, 25);
  assert.equal(load({ QUEUE_MAX_TRACKS: "-1" }).problems.length, 1);
});

test("범위 안의 값은 그대로 쓴다", () => {
  const { problems, cfg } = load({ DASHBOARD_PORT: "40000", RATE_LIMIT_API_MAX: "300" });
  assert.deepEqual(problems, []);
  assert.equal(cfg.port, 40000);
  assert.equal(cfg.apiMax, 300);
});

test("문제는 첫 하나에서 멈추지 않고 모두 모은다", () => {
  const { problems } = load({ DASHBOARD_PORT: "x", WEBSITE: "y", LOG_LEVEL: "loud" });
  assert.equal(problems.length, 3);
  assert.match(problems[2], /LOG_LEVEL.*trace·debug·info·warn·error·fatal 중 하나/);
});

test("자격증명: 봇 토큰이 없으면 문제, 기능 한정 키가 없으면 경고", () => {
  const bare = loadConfig({});
  assert.deepEqual(bare.problems, ["DISCORD_TOKEN 또는 CLIENT_ID가 비어 있습니다. .env.example 의 주석을 참고해 .env 에 값을 채운 뒤 다시 실행하세요."]);
  assert.equal(bare.warnings.length, 2);
  assert.match(bare.warnings[0], /CLIENT_SECRET/);
  assert.match(bare.warnings[1], /Spotify/);
  assert.deepEqual(load({}).warnings, []);
});

test(".env 가 없으면 그 문제 하나만 알린다", () => {
  assert.deepEqual(loadConfig({}, { envFileFound: false }).problems, [".env 파일이 없습니다. 프로젝트 루트의 .env.example 을 .env 로 복사한 뒤, 파일 안의 주석을 참고해 값을 채우세요."]);
});

test("불러와도 멈추지 않는다. 문제는 목록으로 따로 내보내고 설정 값에는 섞이지 않는다", () => {
  const probe = "import('./config.ts').then((m) => console.log('CFG:' + JSON.stringify({ problems: m.problems, keys: Object.keys(m.default).includes('problems') })));";
  const r = spawnSync(process.execPath, ["-e", probe], { cwd: ROOT, encoding: "utf8", env: { ...process.env, DISCORD_TOKEN: "t", CLIENT_ID: "1", DASHBOARD_PORT: "abc" } });
  assert.equal(r.status, 0);
  const out = JSON.parse(/CFG:(\{.*\})/.exec(r.stdout)[1]);
  assert.equal(out.problems.length, 1);
  assert.match(out.problems[0], /DASHBOARD_PORT/);
  assert.equal(out.keys, false);
});

test("기동 첫 줄: 경고는 찍고 지나가고, 문제가 있으면 전부 찍고 멈춘다", (t) => {
  const { stopOnConfigProblems } = require("../src/app/configCheck.ts");
  const exits = [];
  t.mock.method(process, "exit", (code) => exits.push(code));
  const seen = [];
  const out = { warn: (line) => seen.push(`warn ${line}`), error: (line) => seen.push(`error ${line}`) };

  stopOnConfigProblems({ warnings: ["w"], problems: [] }, out);
  assert.deepEqual(exits, []);
  stopOnConfigProblems({ warnings: [], problems: ["a", "b"] }, out);
  assert.deepEqual(exits, [1]);
  assert.deepEqual(seen, ["warn w", "error a", "error b"]);
});
