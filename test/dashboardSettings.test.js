"use strict";

// dashboard/server/routes/guilds.js — 서버 설정 GET/PUT + /player 플래그 통합 테스트.
// 실 라우터 + fake Discord client. GuildSettingsManager는 require.cache 주입으로 모킹(실 SQLite 미접촉).

const path = require("node:path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// ── GuildSettingsManager 모킹 (라우터 require 전에) ──────────
const gsmPath = require.resolve(path.join(__dirname, "..", "src", "GuildSettingsManager.js"));
const store = { djRoles: new Map(), botChannel: new Map(), sponsorblock: new Map() };
const gsmCalls = [];
require.cache[gsmPath] = {
  id: gsmPath,
  filename: gsmPath,
  loaded: true,
  exports: {
    getDjRoles: async (g) => store.djRoles.get(g) || [],
    setDjRoles: async (g, ids) => {
      gsmCalls.push(["setDjRoles", g, ids]);
      store.djRoles.set(g, ids);
      return true;
    },
    clearDjRoles: async (g) => {
      gsmCalls.push(["clearDjRoles", g]);
      store.djRoles.delete(g);
    },
    getBotChannel: async (g) => store.botChannel.get(g) || null,
    setBotChannel: async (g, c) => {
      gsmCalls.push(["setBotChannel", g, c]);
      store.botChannel.set(g, c);
      return true;
    },
    clearBotChannel: async (g) => {
      gsmCalls.push(["clearBotChannel", g]);
      store.botChannel.delete(g);
    },
    resolveSponsorBlock: (g) => store.sponsorblock.get(g) || { enabled: true, categories: ["music_offtopic", "intro", "outro"] },
    setSponsorBlock: async (g, patch) => {
      gsmCalls.push(["setSponsorBlock", g, patch]);
      store.sponsorblock.set(g, patch);
      return true;
    },
  },
};

const express = require("express");
const { ChannelType, PermissionFlagsBits } = require("discord.js");

// ── Fake Discord client ──────────────────────────────────────
const GUILD_ID = "100";

function makeRole(id, name, position, color = 0) {
  return { id, name, position, color, hexColor: color ? "#" + color.toString(16).padStart(6, "0") : "#000000" };
}

const roles = new Map([
  [GUILD_ID, makeRole(GUILD_ID, "@everyone", 0)],
  ["r1", makeRole("r1", "DJ", 5, 0x7c6ff6)],
  ["r2", makeRole("r2", "VIP", 3)],
  ["r3", makeRole("r3", "Mod", 8, 0xff0000)],
]);
const channels = new Map([
  ["c1", { id: "c1", name: "general", type: ChannelType.GuildText, rawPosition: 0 }],
  ["c2", { id: "c2", name: "music", type: ChannelType.GuildText, rawPosition: 1 }],
  ["v1", { id: "v1", name: "voice", type: ChannelType.GuildVoice, rawPosition: 2 }],
]);

let currentMember; // 테스트마다 교체 (null = 비멤버)
const guild = {
  id: GUILD_ID,
  name: "TestGuild",
  roles: { cache: roles },
  channels: { cache: channels },
  members: {
    fetch: async () => {
      if (!currentMember) throw new Error("Unknown Member");
      return currentMember;
    },
    me: null,
  },
};
const client = {
  isReady: () => true,
  guilds: { cache: new Map([[GUILD_ID, guild]]) },
  players: new Map(),
};

function modMember() {
  return { permissions: { has: (p) => p === PermissionFlagsBits.ManageGuild }, guild, roles: { cache: new Map() }, voice: {} };
}
function plainMember() {
  return { permissions: { has: () => false }, guild, roles: { cache: new Map() }, voice: {} };
}

// ── 앱 구성 ──────────────────────────────────────────────────
let currentUser;
let server;
let base;

before(async () => {
  currentUser = { id: "u1", username: "tester", isAdmin: false, guilds: [] };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: currentUser };
    next();
  });
  app.locals.discordClient = client;
  app.use("/api/guilds", require("../dashboard/server/routes/guilds.js"));
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

// ── GET /settings ────────────────────────────────────────────

test("GET settings: 모더레이터 — 현황 + 드롭다운 목록", async () => {
  currentMember = modMember();
  store.djRoles.set(GUILD_ID, ["r1", "deleted-role"]);
  store.botChannel.set(GUILD_ID, "c2");

  const r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 200);
  assert.equal(r.json.canEdit, true);
  assert.equal(r.json.guildName, "TestGuild");
  assert.deepEqual(r.json.djRoleIds, ["r1"], "삭제된 역할은 응답에서 필터링");
  assert.equal(r.json.botChannelId, "c2");
  assert.deepEqual(
    r.json.roles.map((x) => x.id),
    ["r3", "r1", "r2"],
    "@everyone 제외 + position 내림차순",
  );
  assert.equal(r.json.roles.find((x) => x.id === "r2").color, null, "무색 역할은 color null");
  assert.deepEqual(
    r.json.channels.map((x) => x.id),
    ["c1", "c2"],
    "일반 텍스트 채널만",
  );
});

test("GET settings: 일반 멤버는 조회도 403 (모더레이터 전용)", async () => {
  currentMember = plainMember();
  const r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 403);
});

test("GET settings: 비멤버 403 / 봇 소유자는 비멤버여도 200", async () => {
  currentMember = null;
  let r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 403);

  currentUser = { id: "owner", username: "owner", isAdmin: true, guilds: [] };
  r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 200);
  assert.equal(r.json.canEdit, true);
  currentUser = { id: "u1", username: "tester", isAdmin: false, guilds: [] };
});

// ── GET /player의 canManage (⚙ 버튼 표시 기준) ───────────────

test("GET player: canManage — 일반 멤버 false / 모더레이터 true", async () => {
  currentMember = plainMember();
  let r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.status, 200);
  assert.equal(r.json.canManage, false);

  currentMember = modMember();
  r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.canManage, true);
});

// ── PUT /settings ────────────────────────────────────────────

test("PUT settings: 일반 멤버 403", async () => {
  currentMember = plainMember();
  const r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { djRoleIds: ["r1"] });
  assert.equal(r.status, 403);
});

test("PUT settings: 정상 저장 — 중복·유령 역할 정리", async () => {
  currentMember = modMember();
  const r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { djRoleIds: ["r1", "r2", "r1", "ghost"], botChannelId: "c1" });
  assert.equal(r.status, 200);
  assert.deepEqual(store.djRoles.get(GUILD_ID), ["r1", "r2"]);
  assert.equal(store.botChannel.get(GUILD_ID), "c1");
});

test("PUT settings: 빈 배열 = DJ 해제, null = 채널 해제", async () => {
  currentMember = modMember();
  let r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { djRoleIds: [] });
  assert.equal(r.status, 200);
  assert.equal(store.djRoles.has(GUILD_ID), false);

  r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { botChannelId: null });
  assert.equal(r.status, 200);
  assert.equal(store.botChannel.has(GUILD_ID), false);
});

test("PUT settings: SponsorBlock 저장 — 유효 카테고리만 통과", async () => {
  currentMember = modMember();
  const r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { sponsorblock: { enabled: false, categories: ["intro", "outro", "bogus"] } });
  assert.equal(r.status, 200);
  assert.deepEqual(store.sponsorblock.get(GUILD_ID), { enabled: false, categories: ["intro", "outro"] });
});

test("GET settings: SponsorBlock 유효값·카테고리 목록 포함", async () => {
  currentMember = modMember();
  const r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 200);
  assert.ok(r.json.sponsorblock);
  assert.equal(typeof r.json.sponsorblock.masterEnabled, "boolean");
  assert.ok(Array.isArray(r.json.sponsorblock.available) && r.json.sponsorblock.available.length === 9);
});

test("PUT settings: 검증 실패 시 아무것도 적용하지 않음 (부분 저장 방지)", async () => {
  currentMember = modMember();
  store.djRoles.set(GUILD_ID, ["r1"]);
  gsmCalls.length = 0;

  const r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { djRoleIds: ["r2"], botChannelId: "v1" });
  assert.equal(r.status, 400, "음성 채널은 거부");
  assert.deepEqual(store.djRoles.get(GUILD_ID), ["r1"], "역할 변경도 미반영");
  assert.equal(gsmCalls.length, 0);
});

test("PUT settings: 형식 오류 400 (배열 아님 / 25개 초과)", async () => {
  currentMember = modMember();
  let r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { djRoleIds: "r1" });
  assert.equal(r.status, 400);

  const many = Array.from({ length: 26 }, (_, i) => {
    const id = `x${i}`;
    roles.set(id, makeRole(id, `x${i}`, 1));
    return id;
  });
  r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { djRoleIds: many });
  assert.equal(r.status, 400, "디스코드 셀렉트 메뉴 25개 한계와 정합");
});
