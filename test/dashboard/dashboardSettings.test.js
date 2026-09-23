"use strict";

// dashboard/server/routes/guilds.js — 서버 설정 GET/PUT + /player 플래그 통합 테스트.
// 실 라우터 + fake Discord client. 서버 설정은 진짜를 임시 DB 로 쓴다.

// 봇 운영자 판정은 요청마다 config.dashboard.ownerId와 대조한다 — 세션에 굳은 값이 아니라.
// dotenv는 이미 설정된 process.env를 덮지 않으므로 .env가 있어도 이 값이 이긴다.
process.env.OWNER_ID = "owner";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// ── 서버 설정: 진짜를 임시 DB 로 ──────────────────────────
const { openTempStore, setGuild } = require("../helpers/tempStore");
const temp = openTempStore("dashboard-settings-");
const settings = require("../../src/store/guildSettings");
const config = require("../../config");

// 재생목록 곡 수의 범위는 대기열 상한과 기본값 설정에서 온다. 이 파일은 상한 250 · 기본 50 으로 본다
const savedBot = { maxQueueSize: config.bot.maxQueueSize, playlistAddDefault: config.bot.playlistAddDefault };
config.bot.maxQueueSize = 250;
config.bot.playlistAddDefault = 50;
after(() => {
  Object.assign(config.bot, savedBot);
  temp.close();
});

// 저장된 값을 표에서 바로 읽고 쓴다(Map 과 같은 모양)
const orUndefined = (v) => (v === null || (Array.isArray(v) && v.length === 0) ? undefined : v);
const store = {
  djRoles: {
    get: (g) => orUndefined(settings.table.getDjRoles(g)),
    has: (g) => settings.table.getDjRoles(g).length > 0,
    set: (g, ids) => setGuild(g, { djRoles: ids }),
    delete: (g) => setGuild(g, { djRoles: [] }),
  },
  botChannel: {
    get: (g) => orUndefined(settings.table.getBotChannel(g)),
    has: (g) => settings.table.getBotChannel(g) !== null,
    set: (g, c) => setGuild(g, { botChannel: c }),
    delete: (g) => setGuild(g, { botChannel: null }),
  },
  sponsorblock: { get: (g) => settings.table.getGuildSponsorBlock(g) },
  playlistAdd: {
    get: (g) => settings.table.getPlaylistAddMax(g),
    delete: (g) => setGuild(g, { playlistAddMax: null }),
  },
};

// 아무것도 쓰지 않았는지: 이 서버의 설정 행을 전후로 견준다
const settingsRow = () => temp.db().prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(GUILD_ID) ?? null;

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
const voiceStates = new Map(); // userId -> VoiceState (게이트웨이가 채우는 캐시 흉내)
const guild = {
  id: GUILD_ID,
  name: "TestGuild",
  roles: { cache: roles },
  channels: { cache: channels },
  voiceStates: { cache: voiceStates },
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
  currentUser = { id: "u1", username: "tester", guilds: [] };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: currentUser };
    next();
  });
  app.locals.discordClient = client;
  app.use("/api/guilds", require("../../dashboard/server/routes/guilds.js"));
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

test("GET settings: 비멤버 403 / 봇 운영자는 비멤버여도 200", async () => {
  currentMember = null;
  let r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 403);

  currentUser = { id: "owner", username: "owner", guilds: [] };
  r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 200);
  assert.equal(r.json.canEdit, true);
  currentUser = { id: "u1", username: "tester", guilds: [] };
});

// guilds.js의 운영자 우회 분기도 세션 값이 아니라 현재 OWNER_ID로 판정한다
test("GET settings: 구버전 세션의 isAdmin=true로는 운영자 우회가 되지 않는다", async () => {
  currentMember = null;
  currentUser = { id: "former-owner", username: "이전 운영자", isAdmin: true, guilds: [] };

  assert.equal((await req("GET", `/api/guilds/${GUILD_ID}/settings`)).status, 403);

  currentUser = { id: "u1", username: "tester", guilds: [] };
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
  const rowBefore = settingsRow();

  const r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { djRoleIds: ["r2"], botChannelId: "v1" });
  assert.equal(r.status, 400, "음성 채널은 거부");
  assert.deepEqual(store.djRoles.get(GUILD_ID), ["r1"], "역할 변경도 미반영");
  assert.deepEqual(settingsRow(), rowBefore);
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

test("GET settings: 재생목록 한 번에 넣는 곡 수 — 저장값·실제값·범위", async () => {
  currentMember = modMember();
  store.playlistAdd.delete(GUILD_ID);
  const r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.playlistAdd, { value: null, effective: 50, min: 1, max: 250, default: 50 });
});

test("PUT settings: 재생목록 한 번에 넣는 곡 수 — 저장 / null은 기본값 / 범위 밖·소수는 400", async () => {
  currentMember = modMember();
  let r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { playlistAddMax: 120 });
  assert.equal(r.status, 200);
  assert.equal(store.playlistAdd.get(GUILD_ID), 120);

  r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { playlistAddMax: null });
  assert.equal(r.status, 200);
  assert.equal(store.playlistAdd.get(GUILD_ID), null);

  const rowBefore = settingsRow();
  for (const bad of [0, 251, 12.5, "50"]) {
    r = await req("PUT", `/api/guilds/${GUILD_ID}/settings`, { playlistAddMax: bad, botChannelId: "c2" });
    assert.equal(r.status, 400, `거부: ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(settingsRow(), rowBefore, "다른 설정도 함께 미반영");
});

// ── GET /player의 음성 재적 플래그 ───────────────────────────
// 회귀 대상: botInVoice/userInVoice만 보면 "같은 서버 다른 채널"을 구분하지 못한다.
// 조작 가능 여부(checkVoice)의 실제 기준은 채널 일치라, 대시보드가 그걸 그대로 표현해야 한다.

// 앞선 PUT 테스트가 DJ 역할을 남겨두면 "전원 DJ" 전제가 깨진다 — 이 절은 매번 초기화하고 시작한다.
const noDjRoles = () => store.djRoles.delete(GUILD_ID);
const noVoice = () => voiceStates.clear();

// 실 VoiceState는 channelId와 channel을 모두 갖는다 — 한쪽만 두면 라우터와 permissions.js 중
// 하나만 만족시켜 통과 여부가 뒤바뀐다.
const voiceState = (channelId) => (channelId ? { channelId, channel: { id: channelId } } : { channelId: null, channel: null });

// 라우터는 guild.voiceStates에서, permissions.js는 member.voice에서 읽는다. 실제로는 같은 출처이므로
// 픽스처도 반드시 함께 맞춘다 — 한쪽만 두면 통과 여부가 갈려 테스트가 거짓말을 한다.
function inVoice(channelId, userId = "u1") {
  voiceStates.set(userId, voiceState(channelId));
  return { id: userId, permissions: { has: () => false }, guild, roles: { cache: new Map() }, voice: voiceState(channelId) };
}

test("GET player: 봇이 음성에 없으면 sameVoice는 거짓", async () => {
  noDjRoles();
  noVoice();
  guild.members.me = null;
  currentMember = inVoice("v1");

  const r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.botInVoice, false);
  assert.equal(r.json.userInVoice, true);
  assert.equal(r.json.sameVoice, false);
});

test("GET player: 같은 서버 다른 채널은 sameVoice가 거짓이고 조작이 막힌다", async () => {
  noDjRoles();
  noVoice();
  guild.members.me = { voice: voiceState("v1") };
  currentMember = inVoice("v2");

  const r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.botInVoice, true);
  assert.equal(r.json.userInVoice, true, "둘 다 참이라 이 둘만으로는 구분되지 않는다");
  assert.equal(r.json.sameVoice, false);
  assert.equal(r.json.canControl, false);
  assert.equal(r.json.canAdd, false);
});

test("GET player: 같은 채널이면 sameVoice가 참이고 조작이 열린다", async () => {
  noDjRoles();
  noVoice();
  guild.members.me = { voice: voiceState("v1") };
  currentMember = inVoice("v1");

  const r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.sameVoice, true);
  assert.equal(r.json.canControl, true, "DJ 역할 미설정 서버는 전원 DJ");
  assert.equal(r.json.canAdd, true);
});

test("GET player: 음성 밖이면 sameVoice 거짓 / 모더레이터는 그래도 조작 가능", async () => {
  noDjRoles();
  noVoice();
  guild.members.me = { voice: voiceState("v1") };
  currentMember = plainMember();

  let r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.userInVoice, false);
  assert.equal(r.json.sameVoice, false);
  assert.equal(r.json.canControl, false);

  // 모더레이터는 checkVoice 면제 — 화면을 가리는 조건(sameVoice)과 조작 권한이 갈린다
  currentMember = modMember();
  r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.sameVoice, false);
  assert.equal(r.json.canControl, true);

  guild.members.me = null;
  currentMember = plainMember();
  noVoice();
});

// ── GET /api/guilds의 listening (전역 재생 바가 대상 서버를 찾는 기준) ──

test("GET guilds: listening — 봇과 같은 채널일 때만 참", async () => {
  currentMember = plainMember();
  currentUser = { id: "u1", username: "tester", guilds: [{ id: GUILD_ID, name: "TestGuild", permissions: "0" }] };

  // 봇이 음성에 없음
  noVoice();
  guild.members.me = null;
  let r = await req("GET", "/api/guilds");
  assert.equal(r.json.guilds[0].listening, false);

  // 봇은 v1, 사용자는 v2
  guild.members.me = { voice: voiceState("v1") };
  voiceStates.set("u1", voiceState("v2"));
  r = await req("GET", "/api/guilds");
  assert.equal(r.json.guilds[0].listening, false, "같은 서버라도 다른 채널이면 거짓");

  // 둘 다 v1
  voiceStates.set("u1", voiceState("v1"));
  r = await req("GET", "/api/guilds");
  assert.equal(r.json.guilds[0].listening, true);

  noVoice();
  guild.members.me = null;
  currentUser = { id: "u1", username: "tester", guilds: [] };
});

// 멤버 캐시는 비어 있을 수 있지만 음성 상태는 게이트웨이가 항상 채운다 —
// 목록 라우트가 members.cache에 의존하면 여기서 조용히 거짓이 된다.
test("GET guilds: listening은 멤버 캐시가 비어 있어도 판정된다", async () => {
  currentMember = plainMember(); // members.fetch만 성공, members.cache에는 없음
  currentUser = { id: "u1", username: "tester", guilds: [{ id: GUILD_ID, name: "TestGuild", permissions: "0" }] };
  guild.members.me = { voice: voiceState("v1") };
  voiceStates.set("u1", voiceState("v1"));

  const r = await req("GET", "/api/guilds");
  assert.equal(r.json.guilds[0].listening, true);

  noVoice();
  guild.members.me = null;
  currentUser = { id: "u1", username: "tester", guilds: [] };
});

// 봇의 음성 재적(디스코드 상태)과 플레이어 존재(봇 내부 상태)는 어긋날 수 있다.
// 조작 엔드포인트는 전부 플레이어를 요구하므로, 화면이 botInVoice만 보고 곡 추가 폼을 열면 409가 난다.
test("GET player: hasPlayer는 botInVoice와 별개로 판정된다", async () => {
  noDjRoles();
  noVoice();
  guild.members.me = { voice: voiceState("v1") };
  currentMember = inVoice("v1");
  client.players.delete(GUILD_ID);

  let r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.botInVoice, true, "디스코드는 봇이 음성에 있다고 본다");
  assert.equal(r.json.hasPlayer, false, "그런데 플레이어는 없다 — 조작은 전부 409");
  assert.equal(r.json.canAdd, true, "권한은 통과하므로 이것만 보면 폼이 열린다");

  client.players.set(GUILD_ID, { getStatus: () => ({ playing: false, paused: false, volume: 100, loop: false }), isPlaybackActive: () => false, currentTrack: null, previousTracks: [], queue: [] });
  r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.hasPlayer, true);

  client.players.delete(GUILD_ID);
  noVoice();
  guild.members.me = null;
  currentMember = plainMember();
});
