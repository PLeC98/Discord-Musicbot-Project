// 표시 · 설정 명령과 SponsorBlock 설정 화면의 지금 동작을 고정한다(구조 리팩터링 0-B).
// /nowplaying · /queue · /help · /system · /cachestatus · /setchannel · /setdjrole · /sponsorblock, 그리고 sponsorConfigHandler.
//
// 6단계가 표시 명령을 ui/ 의 같은 조각으로, 설정 명령을 store/guildSettings 로 돌린다. 문구 전부가 아니라 "무엇을 골라 담았나 ·
// 무엇을 저장했나"를 본다. 서버 설정과 캐시 통계는 진짜 저장소(임시 DB)로 돈다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, PermissionFlagsBits } from "discord.js";

import { createRequire } from "node:module";
import * as storeDb from "../../src/store/db.ts";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "commands-info-"));
const audioCache = await import("../../src/store/audioCache.ts");
const trackLookup = await import("../../src/store/trackLookup.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
audioCache.initialize(path.join(TMP, "cache.db"));

const config = (await import("../../config.ts")).default;
const S = await import("../../src/ui/strings.ts");
const settings = await import("../../src/store/guildSettings.ts");
const SponsorBlock = await import("../../src/sources/sponsorBlock.ts");
const sponsorConfig = (await import("../../events/sponsorConfigHandler.js")).default;

after(() => {
  audioCache.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => {
  settings._reset();
  storeDb.get().exec("DELETE FROM guild_settings; DELETE FROM track_lookup; DELETE FROM audio_cache;");
});

const cmd = (name) => require(`../../commands/${name}.ts`);
const fieldsOf = (payload) => Object.fromEntries((payload.embeds[0].data.fields || []).map((f) => [f.name, f.value]));

function interaction({ player = null, options = {}, userId = "u1", guildRoles = [], manage = true, channelId = "c1" } = {}) {
  const log = [];
  const seen = [];
  const client = {
    players: new Map(player ? [["g1", player]] : []),
    guilds: { cache: new Map([["g1", { memberCount: 5 }]]) },
    user: { username: "뮤직봇", displayAvatarURL: () => "https://avatar.test/a.png" },
    musicEmbedManager: { onBotChannelChanged: async () => seen.push("movePanel") },
  };
  client.guilds.cache.reduce = (fn, init) => [...client.guilds.cache.values()].reduce(fn, init);
  const it = {
    guild: { id: "g1", roles: { cache: new Map(guildRoles.map((r) => [r, { id: r }])) } },
    user: { id: userId },
    member: { id: userId },
    client,
    channel: { id: channelId, toString: () => `<#${channelId}>` },
    memberPermissions: { has: (p) => manage && p === PermissionFlagsBits.ManageGuild },
    replied: false,
    deferred: false,
    options: { getString: (n) => options[n] ?? null, getInteger: (n) => options[n] ?? null, getChannel: (n) => options[n] ?? null },
    reply: async (p) => {
      it.replied = true;
      log.push(["reply", p]);
    },
    deferReply: async (p) => {
      it.deferred = true;
      log.push(["deferReply", p]);
    },
    editReply: async (p) => log.push(["editReply", p]),
    fetchReply: async () => ({ id: "reply-msg" }),
  };
  return { it, log, seen, client };
}

// ── /nowplaying ───────────────────────────────────────────────────────

function nowPlayer(track, status = { playing: true, paused: false, volume: 70, loop: "track" }) {
  return { currentTrack: track, getCurrentTime: () => 90_000, getStatus: () => status };
}

test("/nowplaying: 플레이어나 곡이 없으면 본인에게만 알린다", async () => {
  const none = interaction();
  await cmd("nowplaying").execute(none.it, none.client);
  assert.equal(none.log[0][1].embeds[0].data.description, "현재 재생 중인 음악이 없습니다!");
  assert.equal(none.log[0][1].flags, MessageFlags.Ephemeral);

  const idle = interaction({ player: nowPlayer(null) });
  await cmd("nowplaying").execute(idle.it, idle.client);
  assert.equal(idle.log[0][1].embeds[0].data.description, "현재 재생 중인 노래가 없습니다!");
});

test("/nowplaying: 가수 · 앨범 · 플랫폼 · 진행 · 요청자 · 상태를 담는다", async () => {
  const track = { title: "곡", url: "https://youtu.be/x", artist: "가수", album: "앨범", platform: "youtube", duration: 200, requestedBy: { id: "u9" }, thumbnail: "https://thumb" };
  const { it, log, client } = interaction({ player: nowPlayer(track) });

  await cmd("nowplaying").execute(it, client);

  const f = fieldsOf(log[0][1]);
  assert.equal(f["🎤 아티스트"], "가수");
  assert.equal(f["💿 앨범"], "앨범");
  assert.match(f["🎵 플랫폼"], /YouTube/);
  assert.match(f["⏱️ 진행"], /^`1:30` ▬+●▬+ `3:20`$/, "재생 패널과 같은 막대");
  assert.equal(f["👤 요청자"], "<@u9>");
  assert.equal(f["📊 상태"], "▶️ 재생 중 • 🔊 70% • 🔂 트랙 반복");
  assert.equal(log[0][1].embeds[0].data.thumbnail.url, "https://thumb");
});

test("/nowplaying: 멈춤 · 중지 · 대기열 반복, 길이를 모르면 진행을 뺀다, 던지면 오류 문장", async () => {
  const paused = interaction({ player: nowPlayer({ title: "곡", url: "u", platform: "direct", duration: 0 }, { playing: false, paused: true, volume: 10, loop: "queue" }) });
  await cmd("nowplaying").execute(paused.it, paused.client);
  const f = fieldsOf(paused.log[0][1]);
  assert.equal(f["📊 상태"], "⏸️ 일시정지 • 🔊 10% • 🔁 대기열 반복");
  assert.equal(f["⏱️ 진행"], undefined);

  const stopped = interaction({ player: nowPlayer({ title: "곡", url: "u" }, { playing: false, paused: false, volume: 1, loop: false }) });
  await cmd("nowplaying").execute(stopped.it, stopped.client);
  assert.equal(fieldsOf(stopped.log[0][1])["📊 상태"], "⏹️ 중지됨 • 🔊 1%");

  const broken = interaction({
    player: {
      currentTrack: { title: "곡" },
      getCurrentTime: () => {
        throw new Error("x");
      },
    },
  });
  await cmd("nowplaying").execute(broken.it, broken.client);
  assert.equal(broken.log[0][1].embeds[0].data.description, "현재 재생 중인 정보를 가져오는 중 오류가 발생했습니다!");
});

// ── /queue ────────────────────────────────────────────────────────────

const queuePlayer = (current, queue) => ({ getQueue: () => ({ current, queue }) });

test("/queue: 플레이어가 없거나 비었으면 알린다", async () => {
  const none = interaction();
  await cmd("queue").execute(none.it, none.client);
  assert.deepEqual(none.log[0][1], { content: S.ERR_NO_MUSIC, flags: [64] });
  const empty = interaction({ player: queuePlayer(null, []) });
  await cmd("queue").execute(empty.it, empty.client);
  assert.deepEqual(empty.log[0][1], { content: S.ERR_NO_SONGS_IN_QUEUE, flags: [64] });
});

test("/queue: 쪽마다 나눠 보이고, 현재 곡은 첫 쪽에만. 없는 쪽은 마지막 쪽으로", async () => {
  const queue = Array.from({ length: 25 }, (_, i) => ({ title: `곡${i + 1}`, pageUrl: `u${i}`, duration: 60 }));
  const first = interaction({ player: queuePlayer({ title: "지금", pageUrl: "now" }, queue) });
  await cmd("queue").execute(first.it, first.client);
  const p1 = first.log[0][1];
  assert.equal(fieldsOf(p1)["🎵 현재 재생 중"], "**[지금](now)**");
  assert.equal(p1.embeds[0].data.footer.text, "총 26개의 노래 • 1/3 페이지");

  const last = interaction({ player: queuePlayer({ title: "지금", pageUrl: "now" }, queue), options: { page: 9 } });
  await cmd("queue").execute(last.it, last.client);
  const p3 = last.log[0][1];
  assert.equal(fieldsOf(p3)["🎵 현재 재생 중"], undefined);
  assert.match(fieldsOf(p3)["📋 다음 노래들 (25개)"], /곡21/);
  assert.equal(p3.embeds[0].data.footer.text, "총 26개의 노래 • 3/3 페이지");
});

// ── /help · /system ───────────────────────────────────────────────────

test("/help: 명령 묶음과 통계를 담고 새로고침 버튼을 단다", async () => {
  const { it, log, client } = interaction({ player: { any: 1 } });
  await cmd("help").execute(it, client);
  const f = fieldsOf(log[0][1]);
  assert.ok(f["🎵 재생"].includes("`/play <곡/URL>`"));
  assert.match(f["📊 통계"], /서버:\*\* 1개/);
  assert.match(f["📊 통계"], /활성 서버:\*\* 1개/);
  assert.equal(log[0][1].components[0].components[0].data.custom_id, "help_refresh");
  assert.equal((await import("../../commands/help.ts")).formatUptime(90061), "1일 1시간 1분");
});

test("/help: 모든 명령을 적는다", async () => {
  const { it, log, client } = interaction();
  await cmd("help").execute(it, client);
  const text = Object.values(fieldsOf(log[0][1])).join("\n");
  const names = fs
    .readdirSync(path.join(import.meta.dirname, "../../commands"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => f.replace(/\.ts$/, ""))
    .filter((name) => name !== "help");
  assert.deepEqual(
    names.filter((name) => !text.includes(`\`/${name}`)),
    [],
  );
});

test("/help: 만들다 던지면 오류 임베드", async () => {
  const { it, log, client } = interaction();
  client.user.displayAvatarURL = () => {
    throw new Error("x");
  };
  await cmd("help").execute(it, client);
  assert.equal(log[0][1].embeds[0].data.description, "도움말을 불러오는 중 오류가 발생했습니다!");
});

test("/system: 봇 운영자만. 운영자면 미뤄 두고 시스템 상태로 바꾼다", async () => {
  const saved = config.dashboard.ownerId;
  config.dashboard.ownerId = "owner";
  try {
    const other = interaction({ userId: "u1" });
    await cmd("system").execute(other.it, other.client);
    assert.deepEqual(other.log, [["reply", { content: "❌ 봇 운영자만 사용할 수 있습니다!", flags: MessageFlags.Ephemeral }]]);

    const owner = interaction({ userId: "owner" });
    await cmd("system").execute(owner.it, owner.client);
    assert.deepEqual(owner.log[0], ["deferReply", { flags: MessageFlags.Ephemeral }]);
    const f = fieldsOf(owner.log[1][1]);
    assert.match(f["🎵 봇 현황"], /서버:\*\* 1개/);
    assert.equal(owner.log[1][1].components[0].components[0].data.custom_id, "system_refresh");
  } finally {
    config.dashboard.ownerId = saved;
  }
});

// ── /cachestatus ──────────────────────────────────────────────────────

test("/cachestatus: 캐시 통계를 담는다(재생 수 · 플랫폼 분포 · TOP · 최근)", async () => {
  const seed = (key, title, plays) => {
    const file = audioCache.getFilePath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x".repeat(1000));
    audioCache.recordDownloadStart(key, { title });
    audioCache.recordDownloadComplete(key, file, 1000, { title }, { durationSec: 125 });
    for (let i = 0; i < plays; i++) audioCache.recordPlayback(key);
  };
  seed("yt:aaaaaaaaaaa", "많이 튼 곡", 3);
  seed("sc:1", "사운드클라우드", 0);
  seed("dl:abc", "직접", 1);
  trackLookup.recordTrackLookup({ requestKey: "https://youtu.be/aaaaaaaaaaa", pageUrl: "https://youtu.be/aaaaaaaaaaa", audioUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa", platform: "youtube", title: "많이 튼 곡", artist: "가수" });

  const { it, log, client } = interaction();
  await cmd("cachestatus").execute(it, client);

  assert.deepEqual(log[0], ["deferReply", { flags: MessageFlags.Ephemeral }]);
  const f = fieldsOf(log[1][1]);
  assert.match(f["▶️ 재생 통계"], /총 재생 횟수:\*\* 4회/);
  assert.match(f["▶️ 재생 통계"], /한 번도 안 재생:\*\* 1개/);
  assert.equal(f["🌐 플랫폼 분포"], "🔴 YouTube: **1**개\n🟠 SoundCloud: **1**개\n🔗 직접 링크: **1**개");
  assert.match(f["🔧 기타"], /URL 매핑:\*\* 1개/);
  assert.match(f["🏆 재생 TOP 5"], /^`1\.` \*\*많이 튼 곡\*\*\. 3회 \(2:05\)/);
});

// ── 설정 명령 ─────────────────────────────────────────────────────────

test("/setchannel: 지정하면 저장하고 안내한 뒤 패널을 옮긴다. 채널을 안 주면 지금 채널", async () => {
  const { it, log, seen, client } = interaction({ channelId: "c5" });
  await cmd("setchannel").execute(it, client);
  settings._reset();
  assert.equal(await settings.getBotChannel("g1"), "c5");
  assert.equal(log[0][1].embeds[0].data.title, "✅ 봇 채널 설정됨");
  assert.deepEqual(seen, ["movePanel"], "안내 뒤에 옮긴다");

  const other = interaction({ options: { channel: { id: "c6", toString: () => "<#c6>" } } });
  await cmd("setchannel").execute(other.it, other.client);
  settings._reset();
  assert.equal(await settings.getBotChannel("g1"), "c6");
});

test("/setchannel remove: 지우고 패널을 옮긴 뒤 안내. 저장 실패는 본인에게만", async () => {
  await settings.setBotChannel("g1", "c5");
  const { it, log, seen, client } = interaction({ options: { action: "remove" } });
  await cmd("setchannel").execute(it, client);
  settings._reset();
  assert.equal(await settings.getBotChannel("g1"), null);
  assert.deepEqual(seen, ["movePanel"]);
  assert.equal(log[0][1].embeds[0].data.title, "🔧 봇 채널 제거됨");

  // 저장이 실패하게 DB 를 잠깐 닫는다(표를 부르면 던진다)
  audioCache.close();
  try {
    const failed = interaction();
    await cmd("setchannel").execute(failed.it, failed.client);
    assert.deepEqual(failed.log[0][1], { content: "❌ 채널 설정 중 오류가 발생했어요.", flags: MessageFlags.Ephemeral });
  } finally {
    audioCache.initialize(path.join(TMP, "cache.db"));
  }
});

test("/setdjrole: 서버에 남아 있는 역할만 지금 DJ 로 보이고 메뉴의 기본값으로 둔다", async () => {
  await settings.setDjRoles("g1", ["r1", "gone"]);
  const { it, log, client } = interaction({ guildRoles: ["r1", "r2"] });
  await cmd("setdjrole").execute(it, client);
  const payload = log[0][1];
  assert.match(payload.embeds[0].data.description, /^현재 DJ 역할: <@&r1>\n/);
  assert.deepEqual(
    payload.components[0].components[0].data.default_values.map((v) => v.id),
    ["r1"],
  );
  assert.deepEqual(
    payload.components[1].components.map((b) => b.data.custom_id),
    ["djrole:save", "djrole:cancel"],
  );

  settings._reset();
  storeDb.get().exec("DELETE FROM guild_settings;");
  const none = interaction();
  await cmd("setdjrole").execute(none.it, none.client);
  assert.match(none.log[0][1].embeds[0].data.description, /모든 유저/);
});

// ── /sponsorblock 과 설정 화면 ────────────────────────────────────────

function sbInteraction({ customId, values = [], messageId = "reply-msg", manage = true } = {}) {
  const log = [];
  const it = {
    customId,
    values,
    guild: { id: "g1" },
    message: { id: messageId },
    memberPermissions: { has: (p) => manage && p === PermissionFlagsBits.ManageGuild },
    isStringSelectMenu: () => customId === "sb:cats",
    isButton: () => customId !== "sb:cats",
    reply: async (p) => log.push(["reply", p.content]),
    deferUpdate: async () => log.push(["deferUpdate"]),
    update: async (p) => log.push(["update", p.embeds[0].data.title, p.embeds[0].data.description ?? null, p.components.length]),
  };
  return { it, log };
}

test("/sponsorblock: 지금 설정으로 화면을 띄우고 보류 상태를 메시지 id 로 남긴다", async () => {
  const { it, log, client } = interaction();
  await cmd("sponsorblock").execute(it, client);
  assert.equal(log[0][1].flags, MessageFlags.Ephemeral);
  assert.deepEqual(
    log[0][1].components[1].components.map((b) => b.data.custom_id),
    ["sb:toggle", "sb:save", "sb:cancel"],
  );

  // 보류 상태를 이어받는지: 토글하면 사용 → 미사용
  const toggle = sbInteraction({ customId: "sb:toggle" });
  await sponsorConfig.execute(toggle.it);
  assert.match(toggle.log[0][2], /미사용/);
});

test("SponsorBlock 화면: 서버 관리 권한이 필요하고, 다른 상호작용은 무시한다", async () => {
  const denied = sbInteraction({ customId: "sb:save", manage: false });
  await sponsorConfig.execute(denied.it);
  assert.deepEqual(denied.log, [["reply", "❌ 서버 관리 권한이 필요해요."]]);
  const other = sbInteraction({ customId: "music_skip" });
  other.it.isButton = () => true;
  await sponsorConfig.execute(other.it);
  assert.deepEqual(other.log, []);
});

test("SponsorBlock 화면: 고르고 저장하면 모르는 구간은 빼고 저장한다. 보류가 없으면 지금 설정에서 시작한다", async () => {
  const pick = sbInteraction({ customId: "sb:cats", values: ["intro", "nope", "intro", "outro"], messageId: "m-save" });
  await sponsorConfig.execute(pick.it);
  assert.deepEqual(pick.log, [["deferUpdate"]]);

  const save = sbInteraction({ customId: "sb:save", messageId: "m-save" });
  await sponsorConfig.execute(save.it);
  settings._reset();
  assert.deepEqual(await settings.getSponsorBlock("g1"), { enabled: true, categories: ["intro", "outro"] });
  assert.equal(save.log[0][1], "⏭️ SponsorBlock 설정 저장됨");
  assert.match(save.log[0][2], /인트로\/인터미션, 아웃트로\/엔드카드/);
  assert.ok(SponsorBlock.SKIP_CATEGORIES.includes("intro"));
});

test("SponsorBlock 화면: 끄고 저장하면 미사용, 구간을 비우고 저장하면 사실상 미적용, 취소하면 그대로 닫는다", async () => {
  const toggle = sbInteraction({ customId: "sb:toggle", messageId: "m-off" });
  await sponsorConfig.execute(toggle.it);
  const save = sbInteraction({ customId: "sb:save", messageId: "m-off" });
  await sponsorConfig.execute(save.it);
  assert.match(save.log[0][2], /구간: 미사용/);

  settings._reset();
  storeDb.get().exec("DELETE FROM guild_settings;"); // 앞에서 끈 채로 저장한 값을 지워, 새 보류가 "사용"에서 시작하게
  const empty = sbInteraction({ customId: "sb:cats", values: [], messageId: "m-empty" });
  await sponsorConfig.execute(empty.it);
  const saveEmpty = sbInteraction({ customId: "sb:save", messageId: "m-empty" });
  await sponsorConfig.execute(saveEmpty.it);
  assert.match(saveEmpty.log[0][2], /선택된 구간 없음\(사실상 미적용\)/);

  const cancel = sbInteraction({ customId: "sb:cancel", messageId: "m-cancel" });
  await sponsorConfig.execute(cancel.it);
  assert.deepEqual(cancel.log, [["update", "⏭️ SponsorBlock 설정 취소됨", "변경 사항 없이 닫았어요.", 0]]);
});

test("SponsorBlock 화면: 전역이 꺼져 있으면 적용되지 않는다고 적는다", () => {
  const saved = config.sponsorblock.enabled;
  config.sponsorblock.enabled = false;
  try {
    const msg = sponsorConfig.buildSponsorConfigMessage({ enabled: true, categories: [] });
    assert.match(msg.embeds[0].data.description, /전역 설정에서 SponsorBlock이 꺼져/);
  } finally {
    config.sponsorblock.enabled = saved;
  }
});
