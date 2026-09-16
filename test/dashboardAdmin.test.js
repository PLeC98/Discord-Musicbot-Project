"use strict";

// dashboard/server/routes/admin.js — 봇 운영자 API 통합 테스트 (상태/서버 목록/나가기/재배포/공지).
// 실 라우터 + fake client. GSM은 require.cache 모킹, REST.put은 프로토타입 패치(실 배포·실 DB 없음).

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

// ── 모킹: GuildSettingsManager (공지 발송이 봇 채널 조회 시 실 DB를 열지 않도록) ──
const gsmPath = require.resolve(path.join(__dirname, "..", "src", "GuildSettingsManager.js"));
let botChannelOf = () => null;
require.cache[gsmPath] = { id: gsmPath, filename: gsmPath, loaded: true, exports: { getBotChannel: async (g) => botChannelOf(g) } };

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
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: currentUser };
    next();
  });
  app.locals.discordClient = client;
  app.use("/api/admin", require("../dashboard/server/routes/admin.js"));
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
  const saved = botChannelOf;
  const guilds = client.guilds.cache;
  client.guilds.cache = new Map(); // 보낼 서버가 없는 상태
  try {
    const r = await req("POST", "/api/admin/broadcast", { message: "아무도 못 받음" });
    assert.equal(r.status, 502);
    assert.equal(r.json.success, false);
    assert.equal(r.json.sent, 0);
  } finally {
    client.guilds.cache = guilds;
    botChannelOf = saved;
  }
});

test("POST broadcast: 봇 채널 우선 발송 + 집계", async () => {
  botChannelOf = (guildId) => (guildId === "300" ? null : `bc-${guildId}`);
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

const configData = require("../src/configDataLoader");
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-admincfg-"));

before(() => {
  configData._setConfigDir(CONFIG_DIR);
  fs.writeFileSync(path.join(CONFIG_DIR, "genres.yaml"), ["# 손으로 적은 메모", "defaults:", "  prefetchCount: 1", "genres:", "  pop:", "    label: 팝", "    keywords:", "      - pop music", ""].join("\n"));
});

after(() => {
  configData._setConfigDir(path.join(__dirname, "..", "config"));
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
  assert.equal(json.data.genres.pop.label, "팝");
});

test("설정: 저장하면 값이 바뀌고 주석은 남는다", async () => {
  const { json: before } = await req("GET", "/api/admin/config/genres");
  before.data.genres.pop.label = "팝송";

  const { status } = await req("PUT", "/api/admin/config/genres", { data: before.data });
  assert.equal(status, 200);

  const text = fs.readFileSync(path.join(CONFIG_DIR, "genres.yaml"), "utf8");
  assert.match(text, /label: 팝송/);
  assert.match(text, /# 손으로 적은 메모/, "대시보드가 저장해도 손으로 적은 주석은 남아야 한다");
});

// 깨진 값을 파일에 남기느니 거절한다 — 봇이 그 파일로 돈다.
test("설정: 쓸 수 없는 값은 저장 전에 거절한다", async () => {
  const bad = { defaults: {}, genres: { pop: { label: "", keywords: [] } } };
  const { status, json } = await req("PUT", "/api/admin/config/genres", { data: bad });
  assert.equal(status, 400);
  assert.ok(json.problems.length >= 2, "무엇이 문제인지 모두 알려준다");

  const text = fs.readFileSync(path.join(CONFIG_DIR, "genres.yaml"), "utf8");
  assert.match(text, /label: 팝송/, "거절된 저장은 파일을 건드리지 않는다");
});

test("설정: 내용이 없으면 400", async () => {
  assert.equal((await req("PUT", "/api/admin/config/genres", {})).status, 400);
});
