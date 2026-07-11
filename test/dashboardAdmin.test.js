"use strict";

// dashboard/server/routes/admin.js — 관리자 API 통합 테스트 (상태/서버 목록/나가기/재배포/공지).
// 실 라우터 + fake client. GSM은 require.cache 모킹, REST.put은 프로토타입 패치(실 배포·실 DB 없음).

const os = require("node:os");
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
  currentUser = { id: "owner", username: "owner", isAdmin: true };
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

test("requireAdmin: 비로그인 401 / 비관리자 403", async () => {
  currentUser = null;
  assert.equal((await req("GET", "/api/admin/status")).status, 401);

  currentUser = { id: "u1", isAdmin: false };
  assert.equal((await req("GET", "/api/admin/status")).status, 403);

  currentUser = { id: "owner", username: "owner", isAdmin: true };
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
