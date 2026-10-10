// src/config/index.ts — 잘못 적은 설정값은 기동을 멈춘다 (2026-09-15 사용자 결정).
//
// 회귀 대상: `parseInt`가 "120junk"를 120으로 삼켜, 오타가 조용히 다른 값으로 돌던 것.
// 예전에는 경고 후 기본값이었다 — 로그를 보지 않는 사이 의도하지 않은 값으로 운영됐다.
//
// config 는 불러와도 멈추지 않고 문제 목록을 낸다. 멈추는 것은 기동(src/index.ts)의 첫 줄이다.
// 값 계산은 loadConfig 순수 함수라 바로 부른다.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { spawnSync } from "child_process";
import { loadConfig } from "../src/config/index.ts";
import { stopOnConfigProblems } from "../src/app/config-check.ts";

const ROOT = path.join(import.meta.dirname, "..");
// 모양이 맞는 암호화 키(32바이트)
const KEY = Buffer.alloc(32, 7).toString("base64");

/** 주어진 환경 변수(env)와 운영 조절값(tunables, settings.db 의 문서)으로 설정을 계산한다 */
function load(env: Record<string, string>, opts?: { envFileFound?: boolean; tunables?: Record<string, string> }) {
  const { config: c, problems, warnings, tuneProblems } = loadConfig({ DISCORD_TOKEN: "t", CLIENT_ID: "1", CLIENT_SECRET: "s", SECRETS_KEY: KEY, ...env }, opts);
  return { problems, warnings, tuneProblems, cfg: { port: c.dashboard.port, apiMax: c.dashboard.rateLimit.apiMax, website: c.bot.website, queueMax: c.bot.maxQueueSize } };
}
/** 운영 조절값만 준다 */
const tune = (tunables: Record<string, string>) => load({}, { tunables });

test("숫자 뒤에 글자가 붙으면 문제다 (parseInt가 삼키던 것)", () => {
  assert.deepEqual(load({ DASHBOARD_PORT: "120junk" }).problems, [".env의 DASHBOARD_PORT 값이 잘못됐습니다 (120junk): 정수만 쓸 수 있습니다. 고친 뒤 다시 실행하세요."]);
  assert.deepEqual(tune({ RATE_LIMIT_API_MAX: "120junk" }).tuneProblems, ["RATE_LIMIT_API_MAX 값이 잘못됐습니다 (120junk): 정수만 쓸 수 있습니다."]);
});

// 조절값은 대시보드가 저장 전에 같은 검사로 거절한다. 그래도 DB 에 틀린 값이 있으면(바깥에서 고침) 기동을 멈추지 않고 그 칸만 기본값이다
test("조절값의 문제는 기동을 멈추지 않고(tuneProblems) 그 칸만 기본값이다", () => {
  const { problems, tuneProblems, cfg } = tune({ RATE_LIMIT_API_MAX: "0", QUEUE_MAX_TRACKS: "300" });
  assert.deepEqual(problems, []);
  assert.equal(tuneProblems.length, 1);
  assert.deepEqual([cfg.apiMax, cfg.queueMax], [120, 300]);
});

test(".env 에 남은 조절값 이름은 읽지 않고 경고만 한다", () => {
  const { warnings, cfg } = load({ OWNER_ID: "9", RATE_LIMIT_API_MAX: "300", QUEUE_MAX_TRACKS: "100" });
  assert.equal(cfg.apiMax, 120);
  assert.deepEqual(warnings, [".env 의 QUEUE_MAX_TRACKS · RATE_LIMIT_API_MAX 는 이제 쓰지 않습니다. 운영자 패널의 설정 탭에서 넣고 .env 에서 지우세요."]);
  assert.equal(load({ RATE_LIMIT_API_MAX: "300" }, { tunables: { RATE_LIMIT_API_MAX: "200" } }).cfg.apiMax, 200, "조절값 문서가 이긴다");
});

test("허용 범위를 벗어나면 문제다 — 조용히 기본값으로 돌지 않는다", () => {
  assert.match(load({ DASHBOARD_PORT: "99999" }).problems.join(), /DASHBOARD_PORT.*65535 이하/);
  assert.equal(tune({ SSE_HEARTBEAT_SEC: "0" }).tuneProblems.length, 1, "0초 하트비트 같은 1ms급 타이머도 막는다");
});

test("주소 설정은 형식과 스킴을 본다", () => {
  assert.equal(tune({ WEBSITE: "그냥 글자" }).tuneProblems.length, 1);
  assert.equal(tune({ WEBSITE: "javascript:alert(1)" }).tuneProblems.length, 1, "http·https만");
  assert.equal(tune({ SPONSORBLOCK_API_BASE: "file:///etc" }).tuneProblems.length, 1, "요청을 보내는 주소도 같다");
  assert.deepEqual(tune({ WEBSITE: "https://example.com" }).tuneProblems, []);
});

// 틀린 색을 그대로 두면 임베드를 보낼 때마다 던진다. 그 칸은 기본 색으로 돈다
test("임베드 색은 #RRGGBB 만 받는다", () => {
  assert.deepEqual(tune({ EMBED_COLOR: "#2743d2" }).tuneProblems, []);
  for (const bad of ["blue", "#12345", "2743D2", "#GGGGGG"]) assert.equal(tune({ EMBED_COLOR: bad }).tuneProblems.length, 1, bad);
  assert.equal(loadConfig({ DISCORD_TOKEN: "t", CLIENT_ID: "1" }).config.bot.embedColor, "#2743D2", "비우면 기본 색");
});

test("비워 두는 것은 기본값을 쓰겠다는 뜻이라 통과한다", () => {
  const { problems, tuneProblems, cfg } = load({ DASHBOARD_PORT: "" }, { tunables: { WEBSITE: "", RATE_LIMIT_API_MAX: "  ", QUEUE_MAX_TRACKS: "" } });
  assert.deepEqual([problems, tuneProblems], [[], []]);
  assert.deepEqual(cfg, { port: 33333, apiMax: 120, website: null, queueMax: 250 });
});

test("대기열 상한은 0(끔)이거나 25 이상이다", () => {
  assert.match(tune({ QUEUE_MAX_TRACKS: "10" }).tuneProblems.join(), /QUEUE_MAX_TRACKS/, "사전 캐싱 버퍼보다 작은 대기열은 막는다");
  assert.equal(tune({ QUEUE_MAX_TRACKS: "0" }).cfg.queueMax, 0);
  assert.equal(tune({ QUEUE_MAX_TRACKS: "25" }).cfg.queueMax, 25);
  assert.equal(tune({ QUEUE_MAX_TRACKS: "-1" }).tuneProblems.length, 1);
});

test("범위 안의 값은 그대로 쓴다", () => {
  const { problems, tuneProblems, cfg } = load({ DASHBOARD_PORT: "40000" }, { tunables: { RATE_LIMIT_API_MAX: "300" } });
  assert.deepEqual([problems, tuneProblems], [[], []]);
  assert.equal(cfg.port, 40000);
  assert.equal(cfg.apiMax, 300);
});

// 모르는 브라우저 이름을 yt-dlp 에 넘기면 사용법 오류로 끝나 모든 곡 찾기가 실패했다(none 으로 실측)
test("쿠키 출처는 file 이거나 yt-dlp 가 받는 브라우저 이름이다(프로필 모양은 그대로 둔다)", () => {
  assert.match(tune({ COOKIES_SOURCE: "none" }).tuneProblems.join(), /COOKIES_SOURCE 값이 잘못됐습니다 \(none\): file 또는 브라우저 이름/);
  for (const ok of ["file", "FILE", "chrome", "Firefox", "chrome:Profile 1", "chromium+gnomekeyring:Work", "whale"]) {
    assert.deepEqual(tune({ COOKIES_SOURCE: ok }).tuneProblems, [], ok);
  }
  const { config: c } = loadConfig({ DISCORD_TOKEN: "t", CLIENT_ID: "1" }, { tunables: { COOKIES_SOURCE: "chrome:Profile 1" } });
  assert.equal(c.ytdlp.cookiesFromBrowser, "chrome:Profile 1");
});

// 클라이언트 이름은 yt-dlp 추출기 인자(youtube:player_client=…)에 그대로 들어간다. ; 가 끼면 인자가 늘어난다
test("유튜브 클라이언트 이름은 영문 소문자 · 숫자 · _ 만", () => {
  assert.equal(tune({ YTDLP_PLAYER_CLIENTS: "web;formats=x" }).tuneProblems.length, 1);
  const { config: c } = loadConfig({}, { tunables: { YTDLP_PLAYER_CLIENTS: "Web_Embedded, tv,web_embedded" } });
  assert.deepEqual(c.ytdlp.playerClients, ["web_embedded", "tv"]);
});

test("문제는 첫 하나에서 멈추지 않고 모두 모은다", () => {
  const { problems } = load({ DASHBOARD_PORT: "x", DASHBOARD_URL: "y", LOG_LEVEL: "loud" });
  assert.equal(problems.length, 3);
  assert.match(problems[2], /LOG_LEVEL.*trace·debug·info·warn·error·fatal 중 하나/);
});

test("자격증명: 봇 토큰 · 클라이언트 ID · 시크릿이 없으면 문제(빈 것만 짚는다), 운영자 ID · 기능 한정 키가 없으면 경고", () => {
  const bare = loadConfig({ SECRETS_KEY: KEY });
  assert.deepEqual(bare.problems, ['비어 있는 필수 값: DISCORD_TOKEN · CLIENT_ID · CLIENT_SECRET. README 의 "설정" 절과 .env.example 의 주석을 참고해 .env 에 채운 뒤 다시 실행하세요.']);
  assert.match(loadConfig({ DISCORD_TOKEN: "t", CLIENT_ID: "1", SECRETS_KEY: KEY }).problems[0], /^비어 있는 필수 값: CLIENT_SECRET\./);
  assert.equal(bare.warnings.length, 1);
  assert.match(bare.warnings[0], /OWNER_ID/);
  assert.deepEqual(load({ OWNER_ID: "9" }).warnings, []);
});

test("대시보드로 옮긴 키가 .env 에 남아 있으면 쓰지 않고 경고만 한다", () => {
  const { warnings } = load({ OWNER_ID: "9", SPOTIFY_CLIENT_SECRET: "x", LASTFM_API_KEY: "y" });
  assert.deepEqual(warnings, [".env 의 SPOTIFY_CLIENT_SECRET · LASTFM_API_KEY 는 이제 쓰지 않습니다. 운영자 패널의 설정 탭에서 넣고 .env 에서 지우세요."]);
  const { config: c } = loadConfig({ SPOTIFY_CLIENT_SECRET: "x", LASTFM_API_KEY: "y" });
  assert.deepEqual([c.spotify.clientSecret, c.sources.lastfmKey], [null, null]);
});

test(".env 가 없으면 그 문제 하나만 알린다", () => {
  assert.deepEqual(loadConfig({}, { envFileFound: false }).problems, [".env 파일이 없습니다. 봇을 실행하면 .env.example 로 만들고 비밀 키를 채웁니다. 그 뒤 파일 안의 주석을 참고해 [필수] 값을 채우세요."]);
});

test("SECRETS_KEY: 비었거나 32바이트 base64 가 아니면 만드는 명령과 함께 멈춘다", () => {
  const empty = load({ SECRETS_KEY: "" }).problems;
  assert.equal(empty.length, 1);
  assert.match(empty[0], /^SECRETS_KEY 가 비어 있습니다\(비밀값 암호화 키\)\. 만들기: node -e .*randomBytes\(32\).* 다시 넣어야 합니다\.$/);
  for (const wrong of ["짧다", Buffer.alloc(16).toString("base64"), `${KEY}x`]) {
    assert.match(load({ SECRETS_KEY: wrong }).problems.join(), /SECRETS_KEY 가 base64 로 적은 32바이트가 아닙니다/, wrong);
  }
  assert.deepEqual(load({}).problems, []);
});

test("불러와도 멈추지 않는다. 문제는 목록으로 따로 내보내고 설정 값에는 섞이지 않는다", () => {
  const probe = "import('./src/config/index.ts').then((m) => console.log('CFG:' + JSON.stringify({ problems: m.problems, keys: Object.keys(m.default).includes('problems') })));";
  const r = spawnSync(process.execPath, ["-e", probe], { cwd: ROOT, encoding: "utf8", env: { ...process.env, DISCORD_TOKEN: "t", CLIENT_ID: "1", DASHBOARD_PORT: "abc" } });
  assert.equal(r.status, 0);
  const out = JSON.parse(/CFG:(\{.*\})/.exec(r.stdout)?.[1] ?? "null");
  // 자식은 저장소의 .env 를 읽는다. 있고 없고에 따라 다른 문제가 더 붙을 수 있어 넣은 값의 문제만 센다
  assert.equal(out.problems.filter((p: string) => /DASHBOARD_PORT/.test(p)).length, 1);
  assert.equal(out.keys, false);
});

test("기동 첫 줄: 경고는 찍고 지나가고, 문제가 있으면 전부 찍고 멈춘다", () => {
  const exits: number[] = [];
  const seen: string[] = [];
  const out = { warn: (line: string) => seen.push(`warn ${line}`), error: (line: string) => seen.push(`error ${line}`) };

  const exit = (code: number) => exits.push(code);
  stopOnConfigProblems({ warnings: ["w"], problems: [] }, out, exit);
  assert.deepEqual(exits, []);
  stopOnConfigProblems({ warnings: [], problems: ["a", "b"] }, out, exit);
  assert.deepEqual(exits, [78], "설정이 틀림: 고치기 전에는 다시 켜도 같다");
  assert.deepEqual(seen, ["warn w", "error a", "error b"]);
});
