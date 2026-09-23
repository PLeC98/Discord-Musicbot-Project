"use strict";

// dashboard/server/routes/admin.js — 봇 운영자 API 통합 테스트 (상태/서버 목록/나가기/재배포/공지).
// 실 라우터 + fake client. 서버 설정은 임시 DB, REST.put은 프로토타입 패치(실 배포·운영 DB 없음).

// 봇 운영자 판정은 요청마다 config.dashboard.ownerId와 대조한다 — 세션에 굳은 값이 아니라.
// dotenv는 이미 설정된 process.env를 덮지 않으므로 .env가 있어도 이 값이 이긴다.
process.env.OWNER_ID = "owner";

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// 재배포 경로가 운영 배포 지문(database/deployed-commands.json)을 기록하지 않도록 임시 경로로 우회
process.env.DEPLOYED_COMMANDS_HASH_PATH = path.join(os.tmpdir(), `musicbot-cmd-hash-${process.pid}.json`);

// 서버 설정은 진짜를 임시 DB 로(공지 발송이 봇 채널을 읽는다)
const { openTempStore, setGuild } = require("../helpers/tempStore");
const store = openTempStore("dashboard-admin-");
after(() => store.close());

// ── 모킹: REST.put (재배포 버튼 경로) ──
const { REST } = require("discord.js");
const realPut = REST.prototype.put;
REST.prototype.put = async function (route, options) {
  return options.body.map((c) => ({ name: c.name }));
};
after(() => {
  REST.prototype.put = realPut;
});

const express = require("express");

// ── Fake Discord client ──────────────────────────────────────
function makeSendableChannel(id) {
  const ch = {
    id,
    position: 0,
    sent: [],
    isTextBased: () => true,
    isThread: () => false,
    send: async (payload) => ch.sent.push(payload),
    permissionsFor: () => ({ has: () => true }),
  };
  return ch;
}

function makeGuild(id, name, { leaveError = null } = {}) {
  const botChannel = makeSendableChannel(`bc-${id}`);
  const g = {
    id,
    name,
    memberCount: 42,
    botChannel,
    leftCount: 0,
    iconURL: () => null,
    systemChannel: null,
    members: { me: {} },
    channels: {
      cache: Object.assign(new Map([[botChannel.id, botChannel]]), {
        filter() {
          return { sort: () => ({ first: () => botChannel }) };
        },
      }),
    },
    leave: async () => {
      if (leaveError) throw leaveError;
      g.leftCount++;
    },
  };
  return g;
}

const g1 = makeGuild("100", "AlphaGuild");
const g2 = makeGuild("200", "BetaGuild");
const gStuck = makeGuild("300", "StuckGuild", { leaveError: new Error("Cannot leave") });

const playerG1 = {
  cleaned: 0,
  queue: [{ title: "q1" }],
  currentTrack: { title: "playing" },
  cleanup() {
    this.cleaned++;
  },
};

const client = {
  isReady: () => true,
  user: { tag: "TestBot#1", id: "bot1" },
  ws: { ping: 42, status: 0 },
  guilds: {
    cache: new Map([
      [g1.id, g1],
      [g2.id, g2],
      [gStuck.id, gStuck],
    ]),
  },
  players: new Map([[g1.id, playerG1]]),
  musicEmbedManager: {
    endedPlayers: [],
    async handlePlaybackEnd(player) {
      this.endedPlayers.push(player);
    },
  },
};

// ── 앱 구성 ──────────────────────────────────────────────────
let currentUser;
let server;
let base;

before(() => {
  currentUser = { id: "owner", username: "owner" };
  const app = express();
  app.use(require("../../dashboard/server/bodyLimit").bodyLimit()); // 실제 서버와 같은 상한을 쓴다
  app.use((req, res, next) => {
    req.session = { user: currentUser };
    next();
  });
  app.locals.discordClient = client;
  app.use("/api/admin", require("../../dashboard/server/routes/admin.js"));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function req(method, urlPath, body) {
  const res = await fetch(base + urlPath, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

// ── 인가 ─────────────────────────────────────────────────────

test("requireOwner: 비로그인 401 / 운영자 아님 403", async () => {
  currentUser = null;
  assert.equal((await req("GET", "/api/admin/status")).status, 401);

  currentUser = { id: "u1" };
  assert.equal((await req("GET", "/api/admin/status")).status, 403);

  currentUser = { id: "owner", username: "owner" };
});

// OWNER_ID를 바꿔도 SQLite에 남은 기존 세션이 그대로 통과하던 회귀.
// 구버전 세션에 남아 있는 isAdmin 필드는 인가에 쓰이지 않는다.
test("requireOwner: 구버전 세션의 isAdmin=true는 인가에 쓰이지 않는다", async () => {
  currentUser = { id: "former-owner", username: "이전 운영자", isAdmin: true };
  assert.equal((await req("GET", "/api/admin/status")).status, 403);

  currentUser = { id: "owner", username: "owner", isAdmin: false };
  assert.equal((await req("GET", "/api/admin/status")).status, 200, "현재 OWNER_ID면 세션 값과 무관하게 통과");

  currentUser = { id: "owner", username: "owner" };
});

// ── 상태 / 서버 목록 ─────────────────────────────────────────

test("GET status: 봇/노드/시스템 상태 형태", async () => {
  const r = await req("GET", "/api/admin/status");
  assert.equal(r.status, 200);
  assert.equal(r.json.bot.tag, "TestBot#1");
  assert.equal(r.json.bot.guilds, 3);
  assert.equal(r.json.activePlayers, 1);
  assert.equal(typeof r.json.node.version, "string");
  assert.equal(typeof r.json.system.cpus, "number");
  // 로그 뷰어의 레벨 토글 초기 상태가 이 값을 따른다 — 없으면 서버가 debug를 안 보내는데도
  // DEBUG 알약이 켜진 채로 시작해, 아무것도 안 나오는 필터가 켜져 있는 것처럼 보인다.
  assert.ok(["trace", "debug", "info", "warn", "error", "fatal"].includes(r.json.logLevel), `logLevel=${r.json.logLevel}`);
});

test("GET guilds: 참가 서버 목록 + 재생 여부", async () => {
  const r = await req("GET", "/api/admin/guilds");
  assert.equal(r.status, 200);
  assert.equal(r.json.guilds.length, 3);
  const alpha = r.json.guilds.find((g) => g.id === "100");
  assert.equal(alpha.name, "AlphaGuild");
  assert.equal(alpha.memberCount, 42);
  assert.equal(alpha.hasPlayer, true);
  assert.equal(r.json.guilds.find((g) => g.id === "200").hasPlayer, false);
});

// ── 서버 나가기 ──────────────────────────────────────────────

test("POST leave: 재생 중 서버 — 플레이어 마감(임베드 종료+cleanup+맵 제거) 후 leave", async () => {
  const r = await req("POST", "/api/admin/guilds/100/leave");
  assert.equal(r.status, 200);
  assert.equal(r.json.name, "AlphaGuild");
  assert.equal(g1.leftCount, 1);
  assert.equal(playerG1.cleaned, 1, "player.cleanup 호출");
  assert.equal(client.players.has("100"), false, "players 맵에서 제거");
  assert.equal(playerG1.pendingEndReason, "forced-disconnect", "강제 해제와 동일 마감 절차");
  assert.deepEqual(playerG1.queue, [], "대기열 비움");
  assert.equal(client.musicEmbedManager.endedPlayers[0], playerG1, "임베드 종료 상태 갱신");
});

test("POST leave: 플레이어 없는 서버도 정상", async () => {
  const r = await req("POST", "/api/admin/guilds/200/leave");
  assert.equal(r.status, 200);
  assert.equal(g2.leftCount, 1);
});

test("POST leave: 없는 서버 404 / leave 실패 502", async () => {
  assert.equal((await req("POST", "/api/admin/guilds/999/leave")).status, 404);

  const r = await req("POST", "/api/admin/guilds/300/leave");
  assert.equal(r.status, 502);
  assert.ok(r.json.error.includes("Cannot leave"));
});

// ── 커맨드 재배포 ────────────────────────────────────────────

test("POST redeploy-commands: 목킹된 REST로 성공 응답", async () => {
  const r = await req("POST", "/api/admin/redeploy-commands");
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.ok(r.json.count > 0);
  assert.ok(["guild", "global"].includes(r.json.scope));
});

// ── 전체 공지 ────────────────────────────────────────────────

test("POST broadcast: 빈 내용 400", async () => {
  const r = await req("POST", "/api/admin/broadcast", { message: "   " });
  assert.equal(r.status, 400);
});

// 회귀: message가 객체면 `message?.trim()`에서 TypeError가 나 500이 됐다. 길이·종류도 안 봤다.
test("POST broadcast: 문자열·길이·종류를 검증한다", async () => {
  for (const body of [{ message: { evil: 1 } }, { message: 42 }, {}]) {
    const r = await req("POST", "/api/admin/broadcast", body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }

  const tooLong = await req("POST", "/api/admin/broadcast", { message: "가".repeat(4097) });
  assert.equal(tooLong.status, 400, "embed description 상한(4096)");
  assert.match(tooLong.json.error, /4096/);

  const badType = await req("POST", "/api/admin/broadcast", { message: "안내", type: "없는종류" });
  assert.equal(badType.status, 400, "모르는 종류를 info로 조용히 바꾸지 않는다");

  const ok = await req("POST", "/api/admin/broadcast", { message: "가".repeat(4096) });
  assert.equal(ok.status, 200, "상한 경계는 통과");
});

test("POST broadcast: 한 곳도 못 보내면 성공으로 돌려주지 않는다", async () => {
  const guilds = client.guilds.cache;
  client.guilds.cache = new Map(); // 보낼 서버가 없는 상태
  try {
    const r = await req("POST", "/api/admin/broadcast", { message: "아무도 못 받음" });
    assert.equal(r.status, 502);
    assert.equal(r.json.success, false);
    assert.equal(r.json.sent, 0);
  } finally {
    client.guilds.cache = guilds;
  }
});

test("POST broadcast: 봇 채널 우선 발송 + 집계", async () => {
  setGuild("100", { botChannel: "bc-100" });
  setGuild("200", { botChannel: "bc-200" });
  setGuild("300", { botChannel: null });
  for (const g of [g1, g2, gStuck]) g.botChannel.sent.length = 0;

  const r = await req("POST", "/api/admin/broadcast", { message: "점검 안내", type: "maintenance" });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.json.total, 3);
  assert.equal(r.json.sent, 3, "봇 채널 2 + 폴백 채널 1");
  assert.equal(g1.botChannel.sent.length, 1);
  assert.equal(g1.botChannel.sent[0].embeds.length, 1);
});

// ── 설정 파일 (config/*.yaml) ────────────────────────────────
//
// 봇 전체 동작을 바꾸는 자리다. 권한이 새면 가장 크게 새므로 비운영자 차단을 먼저 잠근다.
// 실제 config/ 폴더는 건드리지 않는다 — 로더의 디렉터리를 임시 폴더로 돌려 둔다.

const configData = require("../../src/config/loader");
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-admincfg-"));

before(() => {
  configData._setConfigDir(CONFIG_DIR);
  fs.writeFileSync(path.join(CONFIG_DIR, "genres.yaml"), ["# 손으로 적은 메모", "defaults:", "  prefetchCount: 1", "genres:", "  팝:", "    sources:", "      - type: keyword", "        keywords:", "          - pop music", ""].join("\n"));
  fs.writeFileSync(path.join(CONFIG_DIR, "ai.yaml"), ["# 손으로 적은 메모", "provider: off", "baseUrl: http://127.0.0.1:11434/v1", "model: gemma3n:e2b", ""].join("\n"));
  // 키는 프로바이더마다 따로 있는 딴 파일이다 — 대시보드로는 값이 나가지 않는다
  fs.writeFileSync(path.join(CONFIG_DIR, "ai-keys.yaml"), ["openai: sk-test-only", 'groq: ""', ""].join("\n"));
});

after(() => {
  configData._setConfigDir(path.join(__dirname, "..", "..", "config"));
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
});

test("설정: 운영자가 아니면 읽지도 쓰지도 못한다", async () => {
  currentUser = { id: "u1" };
  assert.equal((await req("GET", "/api/admin/config/genres")).status, 403);
  assert.equal((await req("PUT", "/api/admin/config/genres", { data: { genres: {} } })).status, 403);
  currentUser = { id: "owner", username: "owner" };
});

test("설정: 모르는 이름은 404", async () => {
  assert.equal((await req("GET", "/api/admin/config/secrets")).status, 404);
  assert.equal((await req("PUT", "/api/admin/config/secrets", { data: {} })).status, 404);
});

test("설정: 읽으면 현재 값이 온다", async () => {
  const { status, json } = await req("GET", "/api/admin/config/genres");
  assert.equal(status, 200);
  assert.deepEqual(json.data.genres.팝.sources, [{ type: "keyword", keywords: ["pop music"] }]);
});

test("설정: 저장하면 값이 바뀌고 주석은 남는다", async () => {
  const { json: before } = await req("GET", "/api/admin/config/genres");
  before.data.genres.팝.sources[0].keywords = ["pop music", "top pop"];

  const { status } = await req("PUT", "/api/admin/config/genres", { data: before.data });
  assert.equal(status, 200);

  const text = fs.readFileSync(path.join(CONFIG_DIR, "genres.yaml"), "utf8");
  assert.match(text, /top pop/);
  assert.match(text, /# 손으로 적은 메모/, "대시보드가 저장해도 손으로 적은 주석은 남아야 한다");
});

// 깨진 값을 파일에 남기느니 거절한다 — 봇이 그 파일로 돈다.
test("설정: 쓸 수 없는 값은 저장 전에 거절한다", async () => {
  const bad = { defaults: {}, genres: { true: { sources: [{ type: "keyword", keywords: [] }] } } };
  const { status, json } = await req("PUT", "/api/admin/config/genres", { data: bad });
  assert.equal(status, 400);
  assert.ok(json.problems.length >= 2, "무엇이 문제인지 모두 알려준다");

  const text = fs.readFileSync(path.join(CONFIG_DIR, "genres.yaml"), "utf8");
  assert.match(text, /top pop/, "거절된 저장은 파일을 건드리지 않는다");
});

test("설정: 내용이 없으면 400", async () => {
  assert.equal((await req("PUT", "/api/admin/config/genres", {})).status, 400);
});

// ── 소스 종류 목록 ────────────────────────────────────────────────────────

// 편집기가 그릴 표는 서버가 준다. 화면이 목록을 따로 들면 소스를 더할 때 한쪽만 고치게 된다.
test("소스 종류: 무엇을 받고 지금 쓸 수 있는지까지 알려준다", async () => {
  // 방영 연도 범위는 평소 AnimeThemes 에 묻는다 — 테스트는 바깥에 나가지 않는다
  require("../../src/autoplay/sources/index")._seedYearRange({ min: 1963, max: 2026 });
  const { status, json } = await req("GET", "/api/admin/source-types");
  assert.equal(status, 200);

  const types = json.types;
  const byType = Object.fromEntries(types.map((t) => [t.type, t]));
  assert.ok(types.length >= 9, "소스 종류가 다 와야 한다");

  // 이름은 그 서비스 표기로 — 내부 코드명을 그대로 보여주지 않는다
  assert.equal(byType.lbradio.label, "ListenBrainz Radio");
  assert.equal(byType.vocadb.label, "VocaDB");

  // 키가 필요한 것은 무엇이 필요한지 밝힌다(화면이 "키 없음"을 띄운다)
  assert.equal(byType.lbradio.needs, "LISTENBRAINZ_TOKEN");
  assert.equal(byType.keyword.needs, null, "키워드는 키가 필요 없다");
  assert.equal(typeof byType.keyword.usable, "boolean");

  // 필수 칸은 need 에서 끌어온다 — 화면이 따로 적지 않는다
  assert.equal(byType.keyword.fields.find((f) => f.key === "keywords").required, true);
  assert.equal(byType.youtube.fields.find((f) => f.key === "url").required, true);
  // "둘 중 하나"는 따로 알려 준다
  assert.deepEqual(byType.lbradio.either, [["tags", "prompt"]]);

  // 고를 값이 정해진 칸은 목록을 같이 준다 — 보일 말과 API 값이 다를 수 있어 짝으로 준다
  const media = byType.animethemes.fields.find((f) => f.key === "mediaFormat");
  assert.equal(media.kind, "enumList");
  assert.ok(
    media.options.some((o) => o.value === "TV Short"),
    "매체 목록에 TV Short 가 있어야 한다",
  );
  // 분기는 계절 이름 대신 분기로 보여준다 — 값은 저쪽 이름 그대로 나가야 한다
  const season = byType.animethemes.fields.find((f) => f.key === "season");
  assert.deepEqual(
    season.options.map((o) => o.value),
    ["Winter", "Spring", "Summer", "Fall"],
  );
  season.options.forEach((one, i) => assert.ok(one.label.startsWith(`${i + 1}분기`), `${one.value} → ${one.label}`));

  // 구간 슬라이더는 고를 수 있는 양 끝을 서버가 알려 준다 — 화면이 올해로 어림잡지 않는다
  const year = byType.animethemes.fields.find((f) => f.key === "yearFrom");
  assert.equal(year.kind, "range");
  assert.equal(year.to, "yearTo");
  assert.ok(year.min > 1900 && year.max >= year.min);

  // 가족 사이트라고 값까지 같지는 않다 — 사이트마다 받는 것만 준다
  const songTypes = (type) => byType[type].fields.find((f) => f.key === "songTypes").options.map((o) => o.value);
  assert.ok(songTypes("touhoudb").includes("Arrangement"), "동방은 어레인지를 받는다");
  assert.ok(!songTypes("vocadb").includes("Arrangement"), "보카로는 어레인지를 받지 않는다");
  assert.ok(!byType.touhoudb.fields.some((f) => f.key === "artistTypes"), "동방에는 분류 자체가 없다");
});

// ── AI 보조 ───────────────────────────────────────────────────────────────

// 판정 테스트는 보기 곡이 아니라 진짜 곡으로 시험한다. 링크 조회는 아무것도 안 보낸다.
test("AI 보조: 유튜브 주소로 후보를 읽는다", async () => {
  const bad = await req("POST", "/api/admin/ai/judge/lookup", { urls: ["https://example.com/노래"] });
  assert.equal(bad.status, 200);
  assert.equal(bad.json.candidates[0].error, "유튜브 주소가 아닙니다.", "못 읽은 줄도 왜 안 됐는지 알려 준다");

  assert.equal((await req("POST", "/api/admin/ai/judge/lookup", { urls: [] })).status, 400);
  assert.equal((await req("POST", "/api/admin/ai/judge/lookup", { urls: new Array(21).fill("https://youtu.be/x") })).status, 400, "한 번에 20개까지");
});

// 목록 형식·장르를 고치면 다시 그린다 — 조회를 다시 하지 않는다.
test("AI 보조: 후보를 프롬프트에 적히는 줄로 그린다", async () => {
  const cands = [
    { url: "a", error: "못 읽음" },
    { url: "b", title: "노래", durationSec: 245 },
  ];
  const got = await req("POST", "/api/admin/ai/judge/lines", { candidates: cands, genre: "재즈", list: { lineFormat: "{{번호}}. {{제목}} ({{길이분}}분, {{장르}})" } });
  assert.equal(got.status, 200);
  assert.deepEqual(got.json.lines, ["1. 노래 (4분, 재즈)"], "못 읽은 것은 빼고 번호는 남은 것만 센다");

  assert.deepEqual((await req("POST", "/api/admin/ai/judge/lines", { candidates: [] })).json.lines, []);
});

// 조회를 안 하고 눌러도 무엇이 나가는지는 보여야 한다 — 보기 곡으로 돌린다.
test("AI 보조: 고른 후보가 없으면 보기 곡으로 판정한다", async () => {
  const got = await req("POST", "/api/admin/ai/judge/run", { candidates: [{ url: "x", error: "못 읽음" }], data: { provider: "off" } });
  assert.equal(got.status, 200);
  assert.ok(got.json.body, "요청은 만들어진다");
});

// 로어북을 붙인 프롬프트는 32kb 를 넘어 413 이 났다. 프롬프트가 오가는 길만 넓혀 두었다.
test("AI 보조: 긴 프롬프트도 받는다", async () => {
  const long = "가".repeat(60000); // 32kb 를 훌쩍 넘는다

  const counted = await req("POST", "/api/admin/ai/tokens", { provider: "off", model: "", texts: [long] });
  assert.equal(counted.status, 200, "토큰 세기는 긴 글을 받아야 한다");
  assert.ok(counted.json.total > 1000);

  const saved = await req("PUT", "/api/admin/ai/prompt", { sections: [{ role: "user", text: `${long} {{목록}}` }] });
  assert.equal(saved.status, 200, "저장도 마찬가지다");

  // 넓힌 것은 프롬프트 길뿐이다 — 나머지는 그대로 좁게 둔다
  const other = await req("PUT", "/api/admin/config/ai", { data: { provider: "off", extra: long } });
  assert.equal(other.status, 413, "딴 길은 여전히 32kb 에서 막힌다");
});

// 값이 본문 어디로 가는지는 모델 프로필이 안다 — 화면이 베껴 두면 한쪽만 고치게 된다.
test("AI 보조: 그 모델이 받는 칸을 알려 준다", async () => {
  const { status, json } = await req("GET", "/api/admin/ai/fields?provider=anthropic&model=claude-opus-5");
  assert.equal(status, 200);
  assert.equal(json.known, true);

  const effort = json.fields.find((f) => f.key === "effort");
  assert.equal(effort.path, "output_config.effort", "경로는 본문 맨 위부터다");
  assert.equal(effort.widget, "select", "위젯도 프로필이 정한다");
  assert.ok(effort.enum.some((e) => e.value === "max"));

  assert.ok(json.models.length > 5, "그 프로바이더가 아는 모델 목록도 준다");
});

test("AI 보조: 프로필이 없는 프로바이더·모델은 빈 손으로", async () => {
  const local = await req("GET", "/api/admin/ai/fields?provider=ollama&model=gemma3n:e2b");
  assert.equal(local.json.known, false, "로컬은 프로필이 없다");
  assert.deepEqual(local.json.fields, []);

  const unknown = await req("GET", "/api/admin/ai/fields?provider=anthropic&model=없는모델");
  assert.equal(unknown.json.known, false);
  assert.deepEqual(unknown.json.fields, [], "모르는 모델이라고 던지지 않는다");
  assert.ok(unknown.json.models.length > 0, "모델 목록은 그대로 준다");
});

// 키는 .env 에 있고 화면으로 내려가면 안 된다. XSS 하나로 새어 나가는 자리다.
test("AI 보조: 키 값은 내려보내지 않고 있는지만 알려 준다", async () => {
  const { status, json } = await req("GET", "/api/admin/ai/state");
  assert.equal(status, 200);
  // 프로바이더마다 있는지 없는지만 — 값은 어디에도 없다
  assert.equal(typeof json.hasKey, "object");
  assert.equal(json.hasKey.openai, true, "키를 적어 둔 프로바이더는 있음");
  assert.equal(json.hasKey.groq, false, "안 적은 것은 없음");
  assert.ok(!("apiKey" in json), "값을 실으면 안 된다");
  // 화면이 기본 프롬프트를 따로 베껴 두면 한쪽만 고치게 된다 — 서버가 준다
  assert.deepEqual(json.defaultSections, require("../../src/autoplay/assist/index").DEFAULT_SECTIONS);

  const body = JSON.stringify(json);
  for (const secret of [process.env.AI_API_KEY, process.env.DISCORD_TOKEN, process.env.CLIENT_SECRET].filter(Boolean)) {
    assert.ok(!body.includes(secret), "응답에 비밀이 섞였다");
  }
});

test("AI 보조: 운영자만 본다", async () => {
  currentUser = { id: "u1" };
  assert.equal((await req("GET", "/api/admin/ai/state")).status, 403);
  assert.equal((await req("GET", "/api/admin/ai/fields?provider=anthropic")).status, 403);
  assert.equal((await req("POST", "/api/admin/ai/models", { data: {} })).status, 403);
  assert.equal((await req("POST", "/api/admin/ai/ping", { data: {} })).status, 403);
  assert.equal((await req("GET", "/api/admin/ai/prompt")).status, 403);
  assert.equal((await req("PUT", "/api/admin/ai/prompt", { sections: [] })).status, 403);
  currentUser = { id: "owner", username: "owner" };
});

// 키는 쓰기 전용이다. 넣을 수는 있어도 되읽을 수는 없다 —
// 운영자 세션이 털려도 덮어쓰기지 읽기가 아니어야 한다.
test("AI 키: 넣을 수는 있어도 되읽을 수는 없다", async () => {
  const saved = await req("PUT", "/api/admin/ai/keys", { keys: { groq: "sk-groq-새키" } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.hasKey.groq, true);
  assert.equal(saved.json.hasKey.openai, true, "적어 보내지 않은 칸은 그대로 둔다");
  assert.ok(!JSON.stringify(saved.json).includes("sk-groq-새키"), "응답에 값이 실리면 안 된다");

  // 파일에는 들어갔다
  assert.match(fs.readFileSync(path.join(CONFIG_DIR, "ai-keys.yaml"), "utf8"), /sk-groq-새키/);

  // 어느 통로로도 값이 돌아나오지 않는다
  const state = await req("GET", "/api/admin/ai/state");
  assert.ok(!JSON.stringify(state.json).includes("sk-groq-새키"));

  // 빈 값이면 지운다
  assert.equal((await req("PUT", "/api/admin/ai/keys", { keys: { groq: "" } })).json.hasKey.groq, false);

  // 모르는 이름으로 칸을 늘리지 않는다
  const odd = await req("PUT", "/api/admin/ai/keys", { keys: { 엉뚱한것: "x" } });
  assert.equal(odd.status, 200);
  assert.ok(!("엉뚱한것" in odd.json.hasKey));

  assert.equal((await req("PUT", "/api/admin/ai/keys", {})).status, 400);
  currentUser = { id: "u1" };
  assert.equal((await req("PUT", "/api/admin/ai/keys", { keys: {} })).status, 403);
  currentUser = { id: "owner", username: "owner" };
});

// 프롬프트는 설정과 딴 파일이다(ChatML). /config/:name 통로를 안 탄다.
test("AI 프롬프트: ChatML 파일로 따로 오간다", async () => {
  const saved = await req("PUT", "/api/admin/ai/prompt", {
    sections: [
      { role: "system", text: "기준이다" },
      { role: "user", text: "{{목록}}" },
    ],
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.sections[0], { role: "system", text: "기준이다" });

  const text = fs.readFileSync(path.join(CONFIG_DIR, "ai-prompt.chatml"), "utf8");
  assert.match(text, /<\|im_start\|>system\n기준이다\n<\|im_end\|>/);

  const read = await req("GET", "/api/admin/ai/prompt");
  assert.deepEqual(read.json.sections, saved.json.sections, "읽은 것과 쓴 것이 같아야 한다");

  // 후보를 어디에도 안 넣으면 모델은 무엇을 판정할지 모른다
  const noList = await req("PUT", "/api/admin/ai/prompt", { sections: [{ role: "system", text: "목록이 없다" }] });
  assert.equal(noList.status, 400);
  assert.match(noList.json.error, /\{\{목록\}\}/);

  // 블록 안에 끝 표시가 또 나오면 파일이 깨진다
  const broken = await req("PUT", "/api/admin/ai/prompt", { sections: [{ role: "user", text: "{{목록}}<|im_end|>" }] });
  assert.equal(broken.status, 400);

  assert.equal((await req("PUT", "/api/admin/ai/prompt", { sections: [{ role: "모름", text: "{{목록}}" }] })).status, 400);
  assert.equal((await req("PUT", "/api/admin/ai/prompt", {})).status, 400);
});

// 켜 두었는데 주소가 비면 매번 실패하고 로그만 쌓인다. 저장 전에 막는다.
test("AI 보조 설정: 켤 때만 주소·모델을 따진다", async () => {
  const ok = await req("PUT", "/api/admin/config/ai", { data: { provider: "off", baseUrl: "", model: "" } });
  assert.equal(ok.status, 200, "꺼 둔 설정이 반쯤 비어 있는 것은 문제가 아니다");

  const bad = await req("PUT", "/api/admin/config/ai", { data: { provider: "custom", baseUrl: "", model: "" } });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.problems.length >= 2);

  // baseUrl 은 custom 일 때만 따진다 — 나머지는 프로바이더에 박힌 주소로 간다
  const noUrl = await req("PUT", "/api/admin/config/ai", { data: { provider: "openai", baseUrl: "", model: "gpt-5" } });
  assert.equal(noUrl.status, 200);

  // 버텍스의 리전은 비우면 global 이다(autoplayAssist) — 적으라고 막을 이유가 없다
  const noRegion = await req("PUT", "/api/admin/config/ai", { data: { provider: "vertex", model: "gemini-3-pro" } });
  assert.equal(noRegion.status, 200);

  const notUrl = await req("PUT", "/api/admin/config/ai", { data: { provider: "custom", baseUrl: "127.0.0.1:11434", model: "m" } });
  assert.equal(notUrl.status, 400, "http:// 로 시작해야 한다");

  const range = await req("PUT", "/api/admin/config/ai", { data: { provider: "off", batchSize: 99 } });
  assert.equal(range.status, 400);

  // 온도는 모델이 받는 칸 하나가 됐다 — 맨 위에 남아 있으면 조용히 무시되므로 막는다
  const moved = await req("PUT", "/api/admin/config/ai", { data: { provider: "off", temperature: 0 } });
  assert.equal(moved.status, 400);
  assert.match(moved.json.problems.join(" "), /params 아래에 모델별로/);

  // 모르는 프로바이더로 저장되면 조용히 안 돈다
  assert.equal((await req("PUT", "/api/admin/config/ai", { data: { provider: "anthropic" } })).status, 400);

  // enabled 는 provider 로 바뀌었다 — 옛 이름을 적으면 알려 준다
  const oldKey = await req("PUT", "/api/admin/config/ai", { data: { provider: "off", enabled: true } });
  assert.equal(oldKey.status, 400);
  assert.match(oldKey.json.error, /provider/);

  // 프롬프트는 딴 파일에 산다 — 설정 파일에 적으면 쓰이지 않으니 알려 준다
  const wrongPlace = await req("PUT", "/api/admin/config/ai", { data: { provider: "off", prompt: "여기 적으면 안 된다" } });
  assert.equal(wrongPlace.status, 400);
  assert.match(wrongPlace.json.error, /ai-prompt\.chatml/);

  // 손으로 적은 주석은 저장해도 남는다(장르·상태 설정과 같은 규약)
  const saved = await req("PUT", "/api/admin/config/ai", { data: { provider: "openai", baseUrl: "http://127.0.0.1:11434/v1", model: "gemma3n:e2b", promptNames: ["기준", "목록"] } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.data.promptNames, ["기준", "목록"], "섹션 이름은 설정 쪽에 남는다");
  assert.match(fs.readFileSync(path.join(CONFIG_DIR, "ai.yaml"), "utf8"), /손으로 적은 메모/);
});

// 나갈 것을 만들어만 본다. 보내지 않는다 — 테스트와 가르는 것이 이 엔드포인트의 요점이다.
test("AI 미리보기: 응답 칸이 없다", async () => {
  const { status, json } = await req("POST", "/api/admin/ai/preview", { data: { provider: "custom", baseUrl: "http://127.0.0.1:1/v1", model: "m" } });
  assert.equal(status, 200);
  assert.equal(json.url, "http://127.0.0.1:1/v1/chat/completions");
  assert.ok(Array.isArray(json.body.messages));
  assert.ok(!("response" in json) && !("status" in json), "보내지 않았으니 응답이 없다");

  assert.equal((await req("POST", "/api/admin/ai/preview", {})).status, 400);
  currentUser = { id: "u1" };
  assert.equal((await req("POST", "/api/admin/ai/preview", { data: {} })).status, 403);
  currentUser = { id: "owner", username: "owner" };
});

test("소스 종류: 운영자만 볼 수 있다", async () => {
  currentUser = { id: "u1" };
  assert.equal((await req("GET", "/api/admin/source-types")).status, 403);
  currentUser = { id: "owner", username: "owner" };
});
