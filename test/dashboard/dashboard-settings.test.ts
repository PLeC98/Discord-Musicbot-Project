// src/dashboard/routes/guild-settings.ts, player.ts, guild-list.ts(guilds.ts 로 묶는다): 서버 설정 GET/PATCH + /player 플래그 + 서버 목록 통합 테스트.
// 실 라우터 + fake Discord client. 서버 설정은 진짜를 임시 DB 로 쓴다.

// 봇 운영자 판정은 세션에 굳은 값이 아니라 요청마다 config.dashboard.ownerId와 대조한다.
// dotenv는 이미 설정된 process.env를 덮지 않으므로 .env가 있어도 이 값이 이긴다.
process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { Player } from "../../src/player/player.ts";
import { fakePlayer, fakeBot } from "../helpers/fake.ts";
import { signedInAs, requestJson, type ProblemReply } from "../helpers/dashboard.ts";

/** 이 테스트가 읽는 답의 필드(서버 설정, 플레이어, 서버 목록) */
type Reply = ProblemReply & {
  guildName?: string;
  cards?: string[];
  channel?: { botChannelId: string | null; channels: { id: string; name: string }[] };
  dj?: { djRoleIds: string[]; roles: { id: string; name: string; color: string | null }[] };
  sponsorblock?: { masterEnabled: boolean; enabled: boolean; categories: string[] | null; defaultCategories: string[] };
  values?: Record<string, unknown>;
  conflicts?: string[];
  current?: Record<string, unknown>;
  playlistAdd?: unknown;
  agePlace?: string;
  stay?: { on: boolean; channel: { id: string; name: string } | null; refusal: string | null };
  normalize?: { on: boolean; refusal: string | null };
  hasSettings?: boolean;
  canControl?: boolean;
  canAdd?: boolean;
  hasPlayer?: boolean;
  botInVoice?: boolean;
  userInVoice?: boolean;
  sameVoice?: boolean;
  guilds?: { id: string; listening: boolean }[];
};

// ── 서버 설정: 진짜를 임시 DB 로 ──────────────────────────
const { openTempStore, setGuild, whenSettingsBroken } = await import("../helpers/temp-store.ts");
const { createGuildsRouter } = await import("../../src/dashboard/routes/guilds.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const temp = openTempStore("dashboard-settings-");
const settings = await import("../../src/store/guild-settings.ts");
const config = (await import("../../src/config/index.ts")).default;
const documents = await import("../../src/config/documents.ts");
const { shownValues } = await import("../../src/dashboard/settings-values.ts");
const { errorHandler } = await import("../../src/dashboard/middleware/error-handler.ts");

// 재생목록 곡 수의 범위는 대기열 상한과 기본값 설정에서 온다. 이 파일은 상한 250, 기본 50 으로 본다
const savedBot = { maxQueueSize: config.bot.maxQueueSize, playlistAddDefault: config.bot.playlistAddDefault };
config.bot.maxQueueSize = 250;
config.bot.playlistAddDefault = 50;
after(() => {
  Object.assign(config.bot, savedBot);
  temp.close();
});

// 저장된 값을 표에서 바로 읽고 쓴다(Map 과 같은 모양)
const orUndefined = <T>(v: T) => (v === null || (Array.isArray(v) && v.length === 0) ? undefined : v);
const store = {
  djRoles: {
    get: (g: string) => orUndefined(settings.table.getDjRoles(g)),
    has: (g: string) => settings.table.getDjRoles(g).length > 0,
    set: (g: string, ids: string[]) => setGuild(g, { djRoles: ids }),
    delete: (g: string) => setGuild(g, { djRoles: [] }),
  },
  botChannel: {
    get: (g: string) => orUndefined(settings.table.getBotChannel(g)),
    has: (g: string) => settings.table.getBotChannel(g) !== null,
    set: (g: string, c: string) => setGuild(g, { botChannel: c }),
    delete: (g: string) => setGuild(g, { botChannel: null }),
  },
  sponsorblock: { get: (g: string) => settings.table.getGuildSponsorBlock(g) },
  playlistAdd: {
    get: (g: string) => settings.table.getPlaylistAddMax(g),
    delete: (g: string) => setGuild(g, { playlistAddMax: null }),
  },
};

// 아무것도 쓰지 않았는지: 이 서버의 설정 행을 전후로 비교한다
const settingsRow = () => temp.settings().prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(GUILD_ID) ?? null;

import express from "express";
import { ChannelType, PermissionFlagsBits, type Guild } from "discord.js";

// ── Fake Discord client ──────────────────────────────────────
const GUILD_ID = "100";

function makeRole(id: string, name: string, position: number, color = 0) {
  return { id, name, position, color, hexColor: color ? "#" + color.toString(16).padStart(6, "0") : "#000000" };
}

const roles = new Map<string, ReturnType<typeof makeRole> & { tags?: { botId: string } }>([
  [GUILD_ID, makeRole(GUILD_ID, "@everyone", 0)],
  ["r1", makeRole("r1", "DJ", 5, 0x7c6ff6)],
  ["r2", makeRole("r2", "VIP", 3)],
  ["r3", makeRole("r3", "Mod", 8, 0xff0000)],
  // 봇 역할(디스코드가 봇에 붙인 역할). DJ 역할 목록에 없고 저장도 하지 않는다
  ["rbot", { ...makeRole("rbot", "뮤직봇", 9), tags: { botId: "bot" } }],
]);
// 음성 채널 v1 을 보는 사람이 볼 수 있는가(비공개 채널 흉내)
let voiceVisible = true;
const channels = new Map([
  ["c1", { id: "c1", name: "general", type: ChannelType.GuildText, rawPosition: 0 }],
  ["c2", { id: "c2", name: "music", type: ChannelType.GuildText, rawPosition: 1 }],
  ["v1", { id: "v1", name: "voice", type: ChannelType.GuildVoice, rawPosition: 2, permissionsFor: () => ({ has: () => voiceVisible }) }],
]);

let currentMember: object | null; // 테스트마다 교체 (null = 비멤버)
const voiceStates = new Map<string, object>(); // userId -> VoiceState (게이트웨이가 채우는 캐시 흉내)
const guild = {
  id: GUILD_ID,
  name: "TestGuild",
  roles: { cache: roles },
  channels: { cache: channels },
  voiceStates: { cache: voiceStates },
  members: {
    // 이 테스트의 세션에는 디스코드 토큰이 없어 서버 목록은 멤버 캐시로 고른다. 캐시는 지금 멤버인지를 그대로 비춘다
    cache: { has: () => currentMember !== null },
    fetch: async () => {
      if (!currentMember) throw new Error("Unknown Member");
      return currentMember;
    },
    me: null as object | null,
  },
  ownerId: "owner-of-guild",
  // 봇이 서버에서 나간 횟수(봇 내보내기)
  leave: async () => void leaves.push("leave"),
};
const leaves: string[] = [];
const client = {
  isReady: () => true,
  guilds: { cache: new Map([[GUILD_ID, guild]]) },
};
const players = new Map<string, Player>();

function modMember() {
  return { id: "u1", user: { tag: "tester#0" }, permissions: { has: (p: bigint) => p === PermissionFlagsBits.ManageGuild }, guild, roles: { cache: new Map() }, voice: {} };
}
function plainMember() {
  return { id: "u1", user: { tag: "tester#0" }, permissions: { has: () => false }, guild, roles: { cache: new Map() }, voice: {} };
}

// 역할 순서: 봇의 가장 높은 역할이 3. kicker 는 멤버 추방 권한이 있고 가장 높은 역할이 position
const roleAt = (position: number) => ({ position, comparePositionTo: (other: { position: number }) => position - other.position });
function kicker(position = 5) {
  return { id: "u1", user: { tag: "tester#0" }, permissions: { has: (p: bigint) => p === PermissionFlagsBits.KickMembers }, isCommunicationDisabled: () => false, guild, roles: { cache: new Map(), highest: roleAt(position) }, voice: {} };
}
const withBotRole = () => (guild.members.me = { voice: { channel: null }, _roles: ["r3"], roles: { highest: roleAt(3) } });

/** DJ 역할(r1)을 정한 서버에서. 그래야 역할 없는 멤버가 일반 사용자다(DJ 역할이 없는 서버는 모두가 DJ) */
async function withDjRole<T>(fn: () => Promise<T>) {
  store.djRoles.set(GUILD_ID, ["r1"]);
  try {
    return await fn();
  } finally {
    store.djRoles.delete(GUILD_ID);
  }
}

// ── 앱 구성 ──────────────────────────────────────────────────
let currentUser: object | null;
// 권한 수준 오버라이드(세션의 viewAs). 테스트가 걸고 되돌린다
let currentViewAs: string | undefined;
let server: Server;
let base: string;

before(async () => {
  currentUser = { id: "u1", username: "tester" };
  const app = express();
  app.use(express.json());
  app.use(signedInAs(() => currentUser));
  app.use((req, _res, next) => {
    if (currentViewAs) Object.assign(req.session, { viewAs: currentViewAs });
    next();
  });
  app.locals.bot = fakeBot({ client, players, panels: { onBotChannelChanged: async () => {}, panelChannel: async () => null } });
  app.use("/api/guilds", createGuildsRouter({ stream: createPlayerStream() }));
  app.use(errorHandler);
  server = await listenForFetch(app);
  base = baseUrl(server);
});

after(() => server.close());

const req = (method: string, urlPath: string, body?: unknown) => requestJson<Reply>(base, method, urlPath, body);

// 화면처럼 바꿀 필드만, 지금 보여 주는 값(from)과 함께 보낸다. sponsorblock 은 준 하위 키만
function bodyOf(changes: Record<string, unknown>) {
  const now = shownValues(guild as unknown as Guild, settings.read(GUILD_ID)) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, to] of Object.entries(changes)) {
    if (key === "sponsorblock" && to && typeof to === "object") {
      const was = now.sponsorblock as Record<string, unknown>;
      out.sponsorblock = Object.fromEntries(Object.entries(to).map(([sub, value]) => [sub, { from: was[sub], to: value }]));
    } else out[key] = { from: now[key], to };
  }
  return out;
}
const save = (changes: Record<string, unknown>) => req("PATCH", `/api/guilds/${GUILD_ID}/settings`, bodyOf(changes));

// ── GET /settings ────────────────────────────────────────────

test("GET settings: 서버 관리자. 현황 + 드롭다운 목록", async () => {
  currentMember = modMember();
  store.djRoles.set(GUILD_ID, ["r1", "deleted-role"]);
  store.botChannel.set(GUILD_ID, "c2");

  const r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 200);
  assert.equal(r.json.guildName, "TestGuild");
  assert.deepEqual(r.json.dj?.djRoleIds, ["r1"], "삭제된 역할은 응답에서 필터링");
  assert.equal(r.json.channel?.botChannelId, "c2");
  assert.deepEqual(
    r.json.dj?.roles.map((x) => x.id),
    ["r3", "r1", "r2"],
    "@everyone, 봇 역할 제외 + position 내림차순",
  );
  assert.equal(r.json.dj?.roles.find((x) => x.id === "r2")?.color, null, "무색 역할은 color null");
  assert.deepEqual(
    r.json.channel?.channels.map((x) => x.id),
    ["c1", "c2"],
    "일반 텍스트 채널만",
  );
});

test("GET settings: 일반 사용자는 보이는 카드가 없어 403(가장 낮은 카드는 DJ), 카드의 값을 싣지 않는다", async () => {
  currentMember = plainMember();
  const r = await withDjRole(() => req("GET", `/api/guilds/${GUILD_ID}/settings`));
  assert.deepEqual([r.status, r.json.code], [403, "must-dj"]);
  assert.deepEqual(
    ["cards", "stay", "channel", "dj", "sponsorblock", "playlistAdd", "agePlace"].filter((key) => key in r.json),
    [],
  );
});

test("GET settings: DJ 는 상주 모드와 볼륨 정규화 카드만 보고, 서버 관리자 카드의 값(역할, 채널 목록)은 오지 않는다", async () => {
  currentMember = plainMember();
  const r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.cards, ["stay", "normalize"]);
  assert.deepEqual(
    ["channel", "dj", "sponsorblock", "playlistAdd", "agePlace"].filter((key) => key in r.json),
    [],
  );
  assert.deepEqual(r.json.stay, { on: false, channel: null, refusal: "must-be-in-voice" }, "봇이 쉬고 음성 채널 밖이면 켤 수 없다(봇을 부를 채널이 없다)");
  assert.deepEqual(r.json.normalize, { on: false, refusal: null }, "볼륨 정규화는 봇이 음성 채널 밖이어도 바꿀 수 있다");
});

test("GET settings: 비멤버 403. 봇 운영자도 비멤버면 403, 멤버여도 서버 관리자가 아니면 403(서버 안 우대 없음)", async () => {
  currentMember = null;
  let r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 403);

  currentUser = { id: "owner", username: "owner" };
  r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.deepEqual([r.status, r.json.code], [403, "no-guild-access"]);

  currentMember = plainMember();
  r = await withDjRole(() => req("GET", `/api/guilds/${GUILD_ID}/settings`));
  assert.deepEqual([r.status, r.json.code], [403, "must-dj"]);
  currentMember = null;
  currentUser = { id: "u1", username: "tester" };
});

test("GET settings: 구버전 세션의 isAdmin=true로는 운영자 우회가 되지 않는다", async () => {
  currentMember = null;
  currentUser = { id: "former-owner", username: "이전 운영자", isAdmin: true };

  assert.equal((await req("GET", `/api/guilds/${GUILD_ID}/settings`)).status, 403);

  currentUser = { id: "u1", username: "tester" };
});

// ── GET /player의 hasSettings (⚙ 버튼 표시 기준) ───────────────

test("GET player: hasSettings 는 보이는 카드가 있는지. 일반 사용자 false / DJ, 서버 관리자 true", async () => {
  currentMember = plainMember();
  let r = await withDjRole(() => req("GET", `/api/guilds/${GUILD_ID}/player`));
  assert.equal(r.status, 200);
  assert.equal(r.json.hasSettings, false);

  r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.hasSettings, true, "DJ 역할이 없는 서버는 모두가 DJ 라 상주 모드 카드가 보인다");

  currentMember = modMember();
  r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.hasSettings, true);
});

// ── PATCH /settings ────────────────────────────────────────────

test("PATCH settings: 일반 사용자, DJ 모두 403(저장 본문으로 고칠 카드는 서버 관리자 것뿐), 아무것도 반영하지 않는다(빈 본문도)", async () => {
  currentMember = plainMember();
  for (const asUser of [true, false]) {
    if (asUser) store.djRoles.set(GUILD_ID, ["r1"]);
    const before = settingsRow();
    for (const body of [{ djRoleIds: ["r1"] }, {}, { agePlace: "all" }, { playlistAddMax: null, botChannelId: "c1" }]) {
      const r = await save(body);
      assert.deepEqual([r.status, r.json.code], [403, "must-server-manager"], `${asUser ? "일반" : "DJ"} ${JSON.stringify(body)}`);
    }
    assert.deepEqual(settingsRow(), before);
    if (asUser) store.djRoles.delete(GUILD_ID);
  }
});

test("PATCH settings: 정상 저장. 중복, 유령 역할 정리", async () => {
  currentMember = modMember();
  const r = await save({ djRoleIds: ["r1", "r2", "r1", "ghost", "rbot"], botChannelId: "c1" });
  assert.equal(r.status, 200);
  assert.deepEqual(store.djRoles.get(GUILD_ID), ["r1", "r2"]);
  assert.equal(store.botChannel.get(GUILD_ID), "c1");
});

test("PATCH settings: 쓰기가 실패하면 settings-save-failed(원래 오류 문장은 싣지 않는다)이고 아무것도 바뀌지 않는다", async () => {
  currentMember = modMember();
  store.botChannel.set(GUILD_ID, "c1");
  const rolesBefore = store.djRoles.get(GUILD_ID);
  const body = bodyOf({ djRoleIds: ["r2"], botChannelId: null });
  const r = await whenSettingsBroken(() => req("PATCH", `/api/guilds/${GUILD_ID}/settings`, body));
  assert.equal(r.status, 500);
  const problem = r.json as unknown as ProblemReply;
  assert.equal(problem.code, "settings-save-failed");
  assert.equal("detail" in problem, false);
  assert.equal(store.botChannel.get(GUILD_ID), "c1");
  assert.deepEqual(store.djRoles.get(GUILD_ID), rolesBefore);
});

test("PATCH settings: 빈 배열 = DJ 해제, null = 채널 해제", async () => {
  currentMember = modMember();
  let r = await save({ djRoleIds: [] });
  assert.equal(r.status, 200);
  assert.equal(store.djRoles.has(GUILD_ID), false);

  r = await save({ botChannelId: null });
  assert.equal(r.status, 200);
  assert.equal(store.botChannel.has(GUILD_ID), false);
});

test("PATCH settings: SponsorBlock 저장. 유효 카테고리만 통과", async () => {
  currentMember = modMember();
  const r = await save({ sponsorblock: { enabled: false, categories: ["intro", "outro", "bogus"] } });
  assert.equal(r.status, 200);
  assert.deepEqual(store.sponsorblock.get(GUILD_ID), { enabled: false, categories: ["intro", "outro"] });
});

// 선택할 수 있는 구간, 이름, 설명은 화면이 rules/sponsor-categories 를 직접 읽는다
test("GET settings: SponsorBlock 켬 여부, 선택한 구간", async () => {
  currentMember = modMember();
  const r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 200);
  assert.ok(r.json.sponsorblock);
  assert.equal(typeof r.json.sponsorblock?.masterEnabled, "boolean");
  assert.equal(typeof r.json.sponsorblock?.enabled, "boolean");
  assert.deepEqual(r.json.sponsorblock?.defaultCategories, config.sponsorblock.categories);
});

test("GET settings: SponsorBlock 구간을 정하지 않은 서버는 null(운영자 기본 구간을 따름), 전역 스위치가 꺼져도 서버의 설정을 보인다", async () => {
  currentMember = modMember();
  settings.table.setGuildSponsorBlock(GUILD_ID, { enabled: false, categories: null });
  const saved = config.sponsorblock.enabled;
  config.sponsorblock.enabled = false;
  try {
    const sb = (await req("GET", `/api/guilds/${GUILD_ID}/settings`)).json.sponsorblock;
    assert.deepEqual([sb?.masterEnabled, sb?.enabled, sb?.categories], [false, false, null]);
  } finally {
    config.sponsorblock.enabled = saved;
  }
});

test("PATCH settings: 검증 실패 시 아무것도 적용하지 않음 (부분 저장 방지)", async () => {
  currentMember = modMember();
  store.djRoles.set(GUILD_ID, ["r1"]);
  const rowBefore = settingsRow();

  const r = await save({ djRoleIds: ["r2"], botChannelId: "v1" });
  assert.equal(r.status, 400, "음성 채널은 거부");
  assert.deepEqual(store.djRoles.get(GUILD_ID), ["r1"], "역할 변경도 미반영");
  assert.deepEqual(settingsRow(), rowBefore);
});

test("PATCH settings: 형식 오류 400 (배열 아님 / 25개 초과)", async () => {
  currentMember = modMember();
  let r = await save({ djRoleIds: "r1" });
  assert.equal(r.status, 400);

  const many = Array.from({ length: 26 }, (_, i) => {
    const id = `x${i}`;
    roles.set(id, makeRole(id, `x${i}`, 1));
    return id;
  });
  r = await save({ djRoleIds: many });
  assert.equal(r.status, 400, "디스코드 셀렉트 메뉴 25개 한계와 정합");
});

test("GET settings: 재생목록 한 번에 넣는 곡 수. 저장값, 실제값, 범위", async () => {
  currentMember = modMember();
  store.playlistAdd.delete(GUILD_ID);
  const r = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.playlistAdd, { value: null, effective: 50, min: 1, max: 250, default: 50 });
});

test("PATCH settings: 재생목록 한 번에 넣는 곡 수. 저장 / null은 기본값 / 범위 밖, 소수는 400", async () => {
  currentMember = modMember();
  let r = await save({ playlistAddMax: 120 });
  assert.equal(r.status, 200);
  assert.equal(store.playlistAdd.get(GUILD_ID), 120);

  r = await save({ playlistAddMax: null });
  assert.equal(r.status, 200);
  assert.equal(store.playlistAdd.get(GUILD_ID), null);

  const rowBefore = settingsRow();
  for (const bad of [0, 251, 12.5, "50"]) {
    r = await save({ playlistAddMax: bad, botChannelId: "c2" });
    assert.equal(r.status, 400, `거부: ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(settingsRow(), rowBefore, "다른 설정도 함께 미반영");
});

test("연령 제한 콘텐츠를 틀 곳: 운영자가 꺼 두었으면 카드가 없다(저장은 받는다), 켜면 기본은 연령 제한 채널에서만, 모든 채널로 저장, 되돌리기, 모르는 값은 400", async () => {
  currentMember = modMember();
  documents._use("age-content", { enabled: false, changedAt: 1 });
  const off = (await req("GET", `/api/guilds/${GUILD_ID}/settings`)).json;
  assert.deepEqual([off.agePlace, off.cards?.includes("agePlace")], [undefined, false]);

  documents._use("age-content", { enabled: true, changedAt: 2 });
  assert.equal((await req("GET", `/api/guilds/${GUILD_ID}/settings`)).json.agePlace, "channel");
  assert.equal((await save({ agePlace: "all" })).status, 200);
  assert.equal(settings.table.getAgePlace(GUILD_ID), "all");
  assert.equal((await req("GET", `/api/guilds/${GUILD_ID}/settings`)).json.agePlace, "all");
  assert.equal((await save({ agePlace: "nsfw" })).status, 400);
  assert.equal((await save({ agePlace: "channel" })).status, 200);
  assert.equal(settings.table.getAgePlace(GUILD_ID), "channel");
  documents._use("age-content");
});

// ── GET /player의 음성 채널 접속 플래그 ───────────────────────────
// botInVoice/userInVoice만 보면 "같은 서버 다른 채널"을 구분하지 못한다.
// 조작 가능 여부(checkVoice)의 실제 기준은 채널 일치라, 대시보드가 그걸 그대로 표현해야 한다.

// 앞선 저장 테스트가 DJ 역할을 남겨두면 "전원 DJ" 전제가 깨진다. 이 절은 매번 초기화하고 시작한다.
const noDjRoles = () => store.djRoles.delete(GUILD_ID);
const noVoice = () => voiceStates.clear();

// 실 VoiceState는 channelId와 channel을 모두 갖는다. 한쪽만 두면 라우터와 permissions.ts 중
// 하나만 만족시켜 통과 여부가 뒤바뀐다.
const voiceState = (channelId: string | null) => (channelId ? { channelId, channel: { id: channelId } } : { channelId: null, channel: null });

// 라우터는 guild.voiceStates에서, permissions.ts는 member.voice에서 읽는다. 실제로는 같은 출처이므로
// 픽스처도 반드시 함께 맞춘다. 한쪽만 두면 통과 여부가 갈려 테스트가 거짓말을 한다.
function inVoice(channelId: string | null, userId = "u1") {
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

test("GET player: 음성 밖이면 sameVoice 거짓 / 서버 관리자는 그래도 조작 가능", async () => {
  noDjRoles();
  noVoice();
  guild.members.me = { voice: voiceState("v1") };
  currentMember = plainMember();

  let r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.userInVoice, false);
  assert.equal(r.json.sameVoice, false);
  assert.equal(r.json.canControl, false);

  // 서버 관리자는 checkVoice 면제라 화면을 가리는 조건(sameVoice)과 조작 권한이 갈린다
  currentMember = modMember();
  r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.sameVoice, false);
  assert.equal(r.json.canControl, true);

  guild.members.me = null;
  currentMember = plainMember();
  noVoice();
});

// ── GET /api/guilds 의 후보 ──

test("GET player, settings: 설정 버튼과 카드는 권한 수준 오버라이드로 낮출 수는 있어도 올릴 수는 없다", async () => {
  noVoice();
  currentUser = { id: "owner", username: "운영자" };
  try {
    // want: [설정 버튼, 읽기, 서버 관리자 카드 쓰기, 읽은 카드]. DJ 역할을 정한 서버라 역할 없는 멤버는 일반 사용자다
    await withDjRole(async () => {
      for (const [member, viewAs, want] of [
        [modMember, "user", [false, 403, 403, undefined]],
        [modMember, "dj", [true, 200, 403, ["stay", "normalize"]]],
        [modMember, "server-manager", [true, 200, 200, ["stay", "normalize", "channel", "dj", "sponsorblock", "playlistAdd"]]],
        [plainMember, "server-manager", [false, 403, 403, undefined]],
      ] as const) {
        currentMember = member();
        currentViewAs = viewAs;
        const r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
        const read = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
        const write = await save({ playlistAddMax: null });
        assert.deepEqual([r.json.hasSettings, read.status, write.status, read.json.cards?.filter((card) => card !== "agePlace")], want, `${member.name}: ${viewAs} 보기`);
      }
    });
  } finally {
    currentViewAs = undefined;
    currentUser = { id: "u1", username: "tester" };
  }
});

// ── POST /settings/stay(상주 모드) ───────────────────────────

type StayReply = ProblemReply & { on?: boolean; channel?: { id: string; name: string } | null; refusal?: string | null };
const stayReq = (body: unknown) => requestJson<StayReply>(base, "POST", `/api/guilds/${GUILD_ID}/settings/stay`, body);

test("POST settings/stay: 일반 사용자 403, on 이 참, 거짓이 아니면 400, DJ 가 봇을 부를 수 없으면 디스코드 /247 과 같은 거절", async () => {
  currentMember = plainMember();
  const user = await withDjRole(() => stayReq({ on: true }));
  assert.deepEqual([user.status, user.json.code], [403, "must-dj"]);

  currentMember = modMember();
  for (const body of [{ on: "true" }, {}, { on: 1 }, null]) assert.equal((await stayReq(body)).status, 400, JSON.stringify(body));

  currentMember = plainMember();
  const out = await stayReq({ on: true });
  assert.deepEqual([out.status, out.json.code], [409, "must-be-in-voice"], "봇이 쉬고 DJ 가 음성 채널 밖");
});

test("POST settings/stay: 봇이 음성에 있으면 그 채널에 켜고, 끄고, 답은 바뀐 뒤의 카드. 설정 읽기도 같은 카드", async () => {
  players.set(GUILD_ID, fakePlayer({ voice: { isAlive: () => true }, voiceChannel: channels.get("v1"), idle: { reconsider() {} } }));
  currentMember = modMember();
  try {
    const on = await stayReq({ on: true });
    assert.deepEqual([on.status, on.json.on, on.json.channel, on.json.refusal], [200, true, { id: "v1", name: "voice" }, null]);
    assert.deepEqual((await req("GET", `/api/guilds/${GUILD_ID}/settings`)).json.stay, { on: true, channel: { id: "v1", name: "voice" }, refusal: null });
    voiceVisible = false;
    assert.deepEqual((await req("GET", `/api/guilds/${GUILD_ID}/settings`)).json.stay, { on: true, channel: null, refusal: null }, "볼 수 없는 채널이면 켜졌다는 것만(비공개 채널의 이름을 알리지 않는다)");
    voiceVisible = true;
    assert.equal((await stayReq({ on: true })).status, 200, "이미 켜져 있으면 그대로");

    currentMember = plainMember();
    currentViewAs = undefined;
    const read = await withDjRole(() => req("GET", `/api/guilds/${GUILD_ID}/settings`));
    assert.equal(read.status, 403, "일반 사용자는 켜져 있어도 카드를 보지 않는다");

    currentMember = modMember();
    const off = await stayReq({ on: false });
    assert.deepEqual([off.status, off.json.on, off.json.channel], [200, false, null]);
  } finally {
    voiceVisible = true;
    await stayReq({ on: false });
    players.delete(GUILD_ID);
  }
});

// ── POST /settings/normalize(볼륨 정규화) ───────────────────────────

type NormalizeReply = ProblemReply & { on?: boolean; refusal?: string | null };
const normalizeReq = (body: unknown) => requestJson<NormalizeReply>(base, "POST", `/api/guilds/${GUILD_ID}/settings/normalize`, body);

test("POST settings/normalize: 일반 사용자 403, on 이 boolean 이 아니면 400, 봇이 다른 음성 채널에 있으면 디스코드 /normalize 와 같은 거절", async () => {
  currentMember = plainMember();
  const user = await withDjRole(() => normalizeReq({ on: true }));
  assert.deepEqual([user.status, user.json.code], [403, "must-dj"]);

  currentMember = modMember();
  for (const body of [{ on: "true" }, {}, { on: 1 }, null]) assert.equal((await normalizeReq(body)).status, 400, JSON.stringify(body));

  guild.members.me = { voice: { channel: channels.get("v1") } };
  try {
    currentMember = plainMember();
    const elsewhere = await normalizeReq({ on: true });
    assert.deepEqual([elsewhere.status, elsewhere.json.code], [409, "must-be-in-same-voice"]);
    const read = await req("GET", `/api/guilds/${GUILD_ID}/settings`);
    assert.deepEqual(read.json.normalize, { on: false, refusal: "must-be-in-same-voice" }, "카드에도 같은 까닭");
    const notDj = await withDjRole(() => normalizeReq({ on: true }));
    assert.deepEqual([notDj.status, notDj.json.code], [409, "must-be-in-same-voice"], "DJ 가 아니어도 다른 채널이면 명령과 같이 채널부터 본다");
    assert.equal(settings.resolveNormalize(GUILD_ID), false);
  } finally {
    guild.members.me = null;
  }
});

test("POST settings/normalize: 권한 수준 오버라이드를 일반 사용자로 두면 설정을 바꿀 수 없다", async () => {
  currentUser = { id: "owner", username: "운영자" };
  currentMember = modMember();
  currentViewAs = "user";
  try {
    const r = await withDjRole(() => normalizeReq({ on: true }));
    assert.deepEqual([r.status, r.json.code], [403, "must-dj"]);
    assert.equal(settings.resolveNormalize(GUILD_ID), false);
  } finally {
    currentViewAs = undefined;
    currentUser = { id: "u1", username: "tester" };
    await settings.setNormalize(GUILD_ID, false);
  }
});

test("POST settings/normalize: 봇이 음성 채널 밖이어도 DJ 가 켜고 끈다. 응답은 바뀐 뒤의 카드이고 설정 읽기도 같다", async () => {
  currentMember = plainMember();
  try {
    const on = await normalizeReq({ on: true });
    assert.deepEqual([on.status, on.json.on, on.json.refusal], [200, true, null]);
    assert.equal(settings.resolveNormalize(GUILD_ID), true);
    assert.deepEqual((await req("GET", `/api/guilds/${GUILD_ID}/settings`)).json.normalize, { on: true, refusal: null });
    assert.equal((await normalizeReq({ on: true })).status, 200, "이미 켜져 있으면 그대로");
    const off = await normalizeReq({ on: false });
    assert.deepEqual([off.status, off.json.on], [200, false]);
  } finally {
    await settings.setNormalize(GUILD_ID, false);
  }
});

// ── POST /settings/leave(봇 내보내기) ───────────────────────────

const leaveReq = () => requestJson<ProblemReply>(base, "POST", `/api/guilds/${GUILD_ID}/settings/leave`);

test("봇 내보내기: 디스코드에서 봇을 추방할 수 있는 사람(추방 권한, 역할이 봇보다 위)만 카드와 설정 버튼을 보고 내보낸다. 일반 사용자여도", async () => {
  withBotRole();
  leaves.length = 0;
  try {
    currentMember = kicker();
    const read = await withDjRole(() => req("GET", `/api/guilds/${GUILD_ID}/settings`));
    assert.deepEqual([read.status, read.json.cards], [200, ["leave"]], "DJ 가 아닌 사람에게는 이 카드 하나");
    assert.equal((await withDjRole(() => req("GET", `/api/guilds/${GUILD_ID}/player`))).json.hasSettings, true);

    for (const [member, why] of [
      [kicker(3), "봇과 같은 높이"],
      [modMember(), "서버 관리 권한만 있고 추방 권한이 없다"],
    ] as const) {
      currentMember = member;
      const r = await leaveReq();
      assert.deepEqual([r.status, r.json.code], [403, "cannot-kick-bot"], why);
      assert.ok(!(await req("GET", `/api/guilds/${GUILD_ID}/settings`)).json.cards?.includes("leave"), why);
    }
    assert.deepEqual(leaves, [], "막힌 요청은 나가지 않았다");

    currentMember = kicker();
    assert.equal((await leaveReq()).status, 200);
    assert.deepEqual(leaves, ["leave"]);
  } finally {
    leaves.length = 0;
    guild.members.me = null;
  }
});

test("봇 내보내기: 재생 중이면 플레이어를 먼저 정리하고 나간다(세션도 지운다). 권한 수준 오버라이드 중이면 추방 권한이 있어도 막는다", async () => {
  withBotRole();
  leaves.length = 0;
  const order: string[] = [];
  players.set(GUILD_ID, fakePlayer({ dispose: async (opts: { end: string; session: string }) => void order.push(`dispose:${opts.end}:${opts.session}`) }));
  const leave = guild.leave;
  guild.leave = async () => void order.push("leave");
  try {
    currentMember = kicker();
    currentUser = { id: "owner", username: "운영자" };
    currentViewAs = "server-manager";
    const viewing = await leaveReq();
    assert.deepEqual([viewing.status, viewing.json.code], [403, "cannot-kick-bot"]);
    assert.deepEqual(order, []);

    currentViewAs = undefined;
    assert.equal((await leaveReq()).status, 200);
    assert.deepEqual(order, ["dispose:dashboard-leave:remove", "leave"]);
  } finally {
    guild.leave = leave;
    currentViewAs = undefined;
    currentUser = { id: "u1", username: "tester" };
    players.delete(GUILD_ID);
    guild.members.me = null;
  }
});

test("GET guilds: 봇이 있는 서버 중 사용자가 멤버인 곳만 돌려준다. 운영자도 멤버가 아니면 보이지 않는다", async () => {
  noVoice();
  currentUser = { id: "u1", username: "tester" };
  currentMember = modMember();
  let r = await req("GET", "/api/guilds");
  assert.deepEqual(
    r.json.guilds?.map((g) => g.id),
    [GUILD_ID],
  );

  currentMember = plainMember();
  r = await req("GET", "/api/guilds");
  assert.deepEqual(
    r.json.guilds?.map((g) => g.id),
    [GUILD_ID],
    "일반 멤버",
  );

  currentMember = null; // 나간 서버
  r = await req("GET", "/api/guilds");
  assert.deepEqual(r.json.guilds, []);

  currentUser = { id: "owner", username: "운영자" };
  r = await req("GET", "/api/guilds");
  assert.deepEqual(r.json.guilds, [], "운영자도 멤버가 아니면 보이지 않는다");

  currentUser = { id: "u1", username: "tester" };
  currentMember = plainMember();
});

// ── GET /api/guilds 의 상태 넷(서버 목록) ──

test("GET guilds: 상태는 유휴(봇이 음성 밖), 대기 중(곡 없음, 여는 중), 재생 중, 일시정지", async () => {
  currentMember = plainMember();
  currentUser = { id: "u1", username: "tester" };
  const stateNow = async () => ((await req("GET", "/api/guilds")).json.guilds as { state: string }[] | undefined)?.[0]?.state;
  // 멈춤은 플레이어 값이다. 가짜는 오디오가 멈춘 것을 멈춤으로 둔다
  const withStatus = (status: string | undefined) => fakePlayer({ audioPlayer: { state: { status } }, paused: status === "paused" });
  try {
    guild.members.me = null;
    players.set(GUILD_ID, withStatus("playing"));
    assert.equal(await stateNow(), "idle", "플레이어가 남아 있어도 봇이 음성 밖이면 유휴");

    guild.members.me = { voice: voiceState("v1") };
    players.delete(GUILD_ID);
    assert.equal(await stateNow(), "waiting", "참가했지만 곡이 없다");
    players.set(GUILD_ID, withStatus("idle"));
    assert.equal(await stateNow(), "waiting", "곡을 여는 중");
    players.set(GUILD_ID, withStatus("playing"));
    assert.equal(await stateNow(), "playing");
    players.set(GUILD_ID, withStatus("paused"));
    assert.equal(await stateNow(), "paused");
    players.set(GUILD_ID, withStatus("autopaused"));
    assert.equal(await stateNow(), "paused", "듣는 연결이 끊겨 멈춘 것도 멈춤");
  } finally {
    players.delete(GUILD_ID);
    guild.members.me = null;
  }
});

// ── GET /api/guilds의 listening (전역 재생 바가 대상 서버를 찾는 기준) ──

test("GET guilds: listening. 봇과 같은 채널일 때만 참", async () => {
  currentMember = plainMember();
  currentUser = { id: "u1", username: "tester" };

  // 봇이 음성에 없음
  noVoice();
  guild.members.me = null;
  let r = await req("GET", "/api/guilds");
  assert.equal(r.json.guilds?.[0].listening, false);

  // 봇은 v1, 사용자는 v2
  guild.members.me = { voice: voiceState("v1") };
  voiceStates.set("u1", voiceState("v2"));
  r = await req("GET", "/api/guilds");
  assert.equal(r.json.guilds?.[0].listening, false, "같은 서버라도 다른 채널이면 거짓");

  // 둘 다 v1
  voiceStates.set("u1", voiceState("v1"));
  r = await req("GET", "/api/guilds");
  assert.equal(r.json.guilds?.[0].listening, true);

  noVoice();
  guild.members.me = null;
  currentUser = { id: "u1", username: "tester" };
});

// 멤버 캐시는 비어 있을 수 있지만 음성 상태는 게이트웨이가 항상 채운다.
// 목록 라우트가 members.cache에 의존하면 여기서 조용히 거짓이 된다.
test("GET guilds: listening은 멤버 캐시가 비어 있어도 판정된다", async () => {
  currentMember = plainMember(); // members.fetch만 성공, members.cache에는 없음
  currentUser = { id: "u1", username: "tester" };
  guild.members.me = { voice: voiceState("v1") };
  voiceStates.set("u1", voiceState("v1"));

  const r = await req("GET", "/api/guilds");
  assert.equal(r.json.guilds?.[0].listening, true);

  noVoice();
  guild.members.me = null;
  currentUser = { id: "u1", username: "tester" };
});

// 봇의 음성 채널 접속(디스코드 상태)과 플레이어 존재(봇 내부 상태)는 어긋날 수 있다.
// 조작 엔드포인트는 전부 플레이어를 요구하므로, 화면이 botInVoice만 보고 곡 추가 폼을 열면 409가 난다.
test("GET player: hasPlayer는 botInVoice와 별개로 판정된다", async () => {
  noDjRoles();
  noVoice();
  guild.members.me = { voice: voiceState("v1") };
  currentMember = inVoice("v1");
  players.delete(GUILD_ID);

  let r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.botInVoice, true, "디스코드는 봇이 음성에 있다고 본다");
  assert.equal(r.json.hasPlayer, false, "그런데 플레이어는 없다 — 조작은 전부 409");
  assert.equal(r.json.canAdd, true, "권한은 통과하므로 이것만 보면 폼이 열린다");

  players.set(GUILD_ID, fakePlayer({ currentTrack: null, previousTracks: [], queue: [], pause: { userPaused: false, heldBy: null } }));
  r = await req("GET", `/api/guilds/${GUILD_ID}/player`);
  assert.equal(r.json.hasPlayer, true);

  players.delete(GUILD_ID);
  noVoice();
  guild.members.me = null;
  currentMember = plainMember();
});

test("PATCH settings: 받은 필드만 바꾸고 보내지 않은 필드는 그대로다(다른 곳에서 바꾼 값을 지킨다). 답은 보낸 키의 저장된 값(거른 역할)", async () => {
  currentMember = modMember();
  store.botChannel.set(GUILD_ID, "c1");
  const body = bodyOf({ djRoleIds: ["r1", "ghost"] });
  store.botChannel.set(GUILD_ID, "c2"); // 화면을 연 뒤 디스코드 쪽에서 바꿨다
  const r = await req("PATCH", `/api/guilds/${GUILD_ID}/settings`, body);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.values, { djRoleIds: ["r1"] });
  assert.equal(store.botChannel.get(GUILD_ID), "c2");
});

test("PATCH settings: 읽은 값(from)이 지금 값과 다르면 409 와 부딪힌 키, 그 키의 지금 값만 싣고 아무것도 바꾸지 않는다. 이미 바꾸려는 값이면 성공", async () => {
  currentMember = modMember();
  store.djRoles.set(GUILD_ID, ["r1"]);
  store.playlistAdd.delete(GUILD_ID);
  const body = bodyOf({ djRoleIds: ["r2"], playlistAddMax: 80 });
  store.djRoles.set(GUILD_ID, ["r1", "r2"]); // 그사이 다른 곳이 바꿨다
  const rowBefore = settingsRow();
  const r = await req("PATCH", `/api/guilds/${GUILD_ID}/settings`, body);
  assert.deepEqual([r.status, r.json.code, r.json.conflicts, r.json.current], [409, "config-changed", ["djRoleIds"], { djRoleIds: ["r1", "r2"] }]);
  assert.deepEqual(settingsRow(), rowBefore);

  const same = bodyOf({ playlistAddMax: 90 });
  store.playlistAdd.delete(GUILD_ID);
  settings.table.setPlaylistAddMax(GUILD_ID, 90); // 다른 곳이 이미 같은 값으로
  assert.equal((await req("PATCH", `/api/guilds/${GUILD_ID}/settings`, same)).status, 200);
});

test("PATCH settings: 지워진 역할만 다르면 충돌이 아니다. 운영자가 기본 구간을 바꿔도 기본을 따르는 서버의 구간은 충돌이 아니다", async () => {
  currentMember = modMember();
  roles.set("gone", makeRole("gone", "지워질 역할", 2));
  store.djRoles.set(GUILD_ID, ["r1", "gone"]);
  const body = bodyOf({ djRoleIds: ["r2"] });
  roles.delete("gone");
  assert.equal((await req("PATCH", `/api/guilds/${GUILD_ID}/settings`, body)).status, 200);

  settings.table.setGuildSponsorBlock(GUILD_ID, { enabled: true, categories: null });
  const sbBody = bodyOf({ sponsorblock: { categories: ["intro"] } });
  const saved = [...config.sponsorblock.categories];
  config.sponsorblock.categories = ["filler"];
  try {
    assert.equal((await req("PATCH", `/api/guilds/${GUILD_ID}/settings`, sbBody)).status, 200);
  } finally {
    config.sponsorblock.categories = saved;
  }
});

test("PATCH settings: SponsorBlock 은 보낸 하위 키만 바꾼다. 켜기만 바꾸면 구간은 기본을 따르는 그대로(null), 전역 스위치가 꺼져도 답은 저장한 값", async () => {
  currentMember = modMember();
  settings.table.setGuildSponsorBlock(GUILD_ID, { enabled: null, categories: null });
  const saved = config.sponsorblock.enabled;
  config.sponsorblock.enabled = false;
  try {
    const r = await save({ sponsorblock: { enabled: false } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.values, { sponsorblock: { enabled: false } });
    assert.deepEqual(store.sponsorblock.get(GUILD_ID), { enabled: false, categories: null });
  } finally {
    config.sponsorblock.enabled = saved;
  }
});

test("PATCH settings: 빈 패치(빈 본문, 하위 키가 없는 sponsorblock)는 nothing-to-save. 저장값이 지금 범위 밖이어도 from 으로 막지 않는다", async () => {
  currentMember = modMember();
  for (const body of [{}, { sponsorblock: {} }]) {
    const r = await req("PATCH", `/api/guilds/${GUILD_ID}/settings`, body);
    assert.deepEqual([r.status, r.json.code], [400, "nothing-to-save"], JSON.stringify(body));
  }
  settings.table.setPlaylistAddMax(GUILD_ID, 999); // 운영자가 대기열 상한을 줄여 범위 밖이 된 저장값
  const r = await req("PATCH", `/api/guilds/${GUILD_ID}/settings`, { playlistAddMax: { from: 999, to: 100 } });
  assert.equal(r.status, 200);
  assert.equal(store.playlistAdd.get(GUILD_ID), 100);
});

test("PATCH settings: 권한을 먼저 본다. DJ 는 읽은 값이 틀려도 409 가 아니라 403 이고 서버 관리자 카드의 값을 받지 못한다", async () => {
  currentMember = plainMember();
  const r = await req("PATCH", `/api/guilds/${GUILD_ID}/settings`, { djRoleIds: { from: ["nope"], to: ["r1"] } });
  assert.deepEqual([r.status, r.json.code, r.json.current], [403, "must-server-manager", undefined]);
});

test("GET settings: 서버 설정을 읽지 못하면 오류로 답한다(기본값을 보이면 그것을 기준으로 저장하게 된다)", async () => {
  currentMember = modMember();
  const r = await whenSettingsBroken(() => req("GET", `/api/guilds/${GUILD_ID}/settings`));
  assert.deepEqual([r.status, r.json.code], [503, "storage-unavailable"]);
});

test("PATCH settings: 모양이 틀리면 bad-settings 400 에 필드별 문제(JSON Pointer, 코드), 아무것도 반영하지 않는다", async () => {
  currentMember = modMember();
  const rowBefore = settingsRow();
  const cases: Array<[unknown, string, string]> = [
    [{ djRoleIds: { from: [], to: "r1" } }, "/djRoleIds/to", "bad-dj-roles"],
    [{ sponsorblock: { categories: { from: null, to: [1] } } }, "/sponsorblock/categories/to/0", "bad-sponsor-categories"],
    [{ sponsorblock: "on" }, "/sponsorblock", "bad-sponsorblock"],
    [{ sponsorblock: { enabled: { from: true, to: "yes" } } }, "/sponsorblock/enabled/to", "bad-sponsorblock"],
    [{ botChannelId: { from: null, to: 5 } }, "/botChannelId/to", "bad-bot-channel"],
    [{ botChannelId: "c1" }, "/botChannelId", "bad-bot-channel"],
    [[1, 2], "", "bad-settings"],
  ];
  for (const [body, pointer, code] of cases) {
    const r = await req("PATCH", `/api/guilds/${GUILD_ID}/settings`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.json, { type: "/problems/bad-settings", code: "bad-settings", status: 400, title: "Invalid server settings", errors: [{ pointer, code }] });
  }
  const range = await req("PATCH", `/api/guilds/${GUILD_ID}/settings`, { playlistAddMax: { from: null, to: 0 } });
  assert.deepEqual(range.json.errors, [{ pointer: "/playlistAddMax/to", code: "playlist-limit-out-of-range", min: settings.playlistAddLimits().min, max: settings.playlistAddLimits().max }], "곡 수는 범위를 같이 싣는다");
  assert.deepEqual(settingsRow(), rowBefore);
});

// ── POST /player/join ────────────────────────────────────────

// 부르는 사람은 서버를 연 그 멤버다(대역 멤버도 거기서 걸린다). 운영자도 멤버가 아니면 서버를 열지 못한다
test("POST join: 멤버가 아닌 운영자는 no-guild-access, 음성 밖의 멤버는 must-be-in-voice", async () => {
  currentMember = null;
  currentUser = { id: "owner", username: "운영자" };
  const owner = await req("POST", `/api/guilds/${GUILD_ID}/player/join`);
  assert.deepEqual([owner.status, owner.json.code], [403, "no-guild-access"]);

  currentMember = plainMember();
  currentUser = { id: "u1", username: "tester" };
  const away = await req("POST", `/api/guilds/${GUILD_ID}/player/join`);
  assert.deepEqual([away.status, away.json.code], [409, "must-be-in-voice"]);
  assert.equal(players.has(GUILD_ID), false, "부르지 못했으면 플레이어를 만들지 않는다");
});
