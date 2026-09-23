"use strict";

// 곡 추가 명령(/play · /playfirst · /search · /join · /autoplay · /dashboard)의 지금 동작을 고정한다(구조 리팩터링 0-B).
//
// 6단계가 명령을 얇게 만들고 곡 추가 코어를 usecases/addTracks 로 옮긴다. 입력 · 권한 · 결과마다 무엇을 불렀는지 적어 둔다.
// /join 과 플레이어가 없을 때의 /autoplay 는 진짜 MusicPlayer 를 만들므로 재생 하네스(음성 · ffmpeg 가짜, 임시 DB)를 먼저 부른다.
// 권한 판정 · 서버 설정 · 곡 추가 코어는 진짜, 화면 관리자와 트랙 조회만 가짜다.

const h = require("../helpers/playerHarness");
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { MessageFlags } = require("discord.js");

const S = require("../../src/ui/strings");
const settings = require("../../src/store/guildSettings");
const TrackResolver = require("../../src/sources/trackResolver");
const YouTube = require("../../src/sources/youtube/index");
const More = require("../../src/usecases/playlistMore");
const CacheManager = h.CacheManager;

const USER = "111111111111111111";
const real = { resolveQuery: TrackResolver.resolveQuery, search: YouTube.search, restore: h.MusicPlayer.prototype.restoreFromState };
const resolved = [];
let resolveReply;

after(() => {
  TrackResolver.resolveQuery = real.resolveQuery;
  YouTube.search = real.search;
  h.MusicPlayer.prototype.restoreFromState = real.restore;
});

beforeEach(() => {
  h.reset();
  settings.cache.clear();
  CacheManager.db.exec("DELETE FROM guild_settings; DELETE FROM player_sessions;");
  resolved.length = 0;
  resolveReply = () => ({ success: true, isPlaylist: false, tracks: [{ id: "aaaaaaaaaaa", title: "곡", url: "https://youtu.be/aaaaaaaaaaa" }] });
  TrackResolver.resolveQuery = async (query, context, range) => {
    resolved.push({ query, context, range });
    return resolveReply(query);
  };
});

// ── 세계 ──────────────────────────────────────────────────────────────

function world({ botVoice = "v1", userVoice = "v1", roles = [], canJoin = true, player = "fake", handle = async () => ({ success: true }) } = {}) {
  const voice = (id) => (id ? { id, name: id, permissionsFor: () => ({ has: () => canJoin }) } : null);
  const guild = {
    id: "g1",
    name: "서버",
    members: { me: { id: "bot", voice: { channel: voice(botVoice) } } },
    channels: { cache: new Map([["panel-channel", { id: "panel-channel" }]]) },
    roles: { cache: new Map([["dj", { id: "dj" }]]) },
    voiceAdapterCreator: () => ({}),
  };
  const member = {
    id: USER,
    user: { id: USER },
    displayName: "사용자",
    guild,
    voice: { channel: voice(userVoice) },
    permissions: { has: () => false },
    roles: { cache: { has: (r) => roles.includes(r) } },
    toString: () => `<@${USER}>`,
  };
  const seen = [];
  const embeds = {
    seen,
    createSearchingContainer: (text) => ({ searching: text }),
    createErrorContainer: (text) => ({ error: text }),
    handleMusicData: async (guildId, trackData, who) => {
      seen.push({ handle: trackData, who });
      return handle(trackData);
    },
    updateNowPlayingEmbed: async () => seen.push("update"),
    handlePlaybackEnd: async (_p, { reason }) => seen.push(`end:${reason}`),
    repostIdlePanel: async (_g, ch) => seen.push(`repost:${ch.id}`),
    stopProgressUpdate: (id) => seen.push(`stopProgress:${id}`),
    createNewMusicEmbed: async (p, track, who, _responder, opts) => seen.push({ newEmbed: track.title, who: who.username, opts }),
    deleteWebhookCache: () => {},
  };
  const client = { players: new Map(), musicEmbedManager: embeds, user: { id: "bot" }, guilds: { fetch: async () => null } };
  guild.client = client;
  if (player === "fake") {
    client.players.set("g1", {
      sessionId: "S1",
      queue: [],
      previousTracks: [],
      currentTrack: null,
      autoplay: false,
      textChannel: null,
      releaseLoopForLive() {},
      setAutoplay(v) {
        seen.push(`autoplay:${v}`);
        this.autoplay = v;
      },
    });
  }
  return { guild, member, client, seen, player: client.players.get("g1") };
}

function interaction(w, { options = {}, channelId = "c1" } = {}) {
  const log = [];
  const sentOnChannel = [];
  const it = {
    guild: w.guild,
    member: w.member,
    user: w.member.user,
    client: w.client,
    channel: {
      id: channelId,
      send: async (p) => {
        const m = { id: `ch${sentOnChannel.length}`, payload: p, delete: async () => {} };
        sentOnChannel.push(m);
        return m;
      },
    },
    replied: false,
    deferred: false,
    options: { getString: (n) => options[n] ?? null },
    reply: async (p) => {
      it.replied = true;
      log.push(["reply", p]);
      return { id: "reply-msg" };
    },
    deferReply: async (p) => {
      it.deferred = true;
      log.push(["deferReply", p]);
    },
    editReply: async (p) => {
      log.push(["editReply", p]);
      return { id: "edited-msg" };
    },
    deleteReply: async () => log.push(["deleteReply"]),
    followUp: async (p) => {
      log.push(["followUp", p]);
      return { id: "follow" };
    },
  };
  return { it, log, sentOnChannel };
}

const cmd = (name) => require(`../../commands/${name}.js`);

// ── /play · /playfirst ────────────────────────────────────────────────

test("/play: 권한(재적 규칙)이 없으면 본인에게만 알리고 찾지 않는다", async () => {
  const w = world({ userVoice: "v2" });
  const { it, log } = interaction(w, { options: { query: "노래" } });
  await cmd("play").execute(it, w.client);
  assert.deepEqual(log, [["reply", { content: S.ERR_SAME_CHANNEL, flags: MessageFlags.Ephemeral }]]);
  assert.deepEqual(resolved, []);
});

test("/play: 검색 중 자리표시자를 CV2 로 먼저 답하고 코어에 /play 로 넘긴다", async () => {
  const w = world();
  const { it, log } = interaction(w, { options: { query: "노래" } });
  await cmd("play").execute(it, w.client);
  assert.deepEqual(log[0], ["reply", { components: [{ searching: "**노래** 검색 중..." }], flags: MessageFlags.IsComponentsV2 }]);
  assert.equal(resolved[0].context, "/play.resolveQuery");
  assert.equal(w.seen[0].handle.insertFirst, undefined);
  assert.equal(w.seen[0].who.username, "사용자");
});

test("/play: 코어가 실패하면 오류 컨테이너로 답을 바꾸고, 던지면 ErrorHandler 문장으로", async () => {
  const w = world();
  resolveReply = () => ({ success: false, message: "❌ 결과를 찾을 수 없습니다!" });
  const failed = interaction(w, { options: { query: "없는 노래" } });
  await cmd("play").execute(failed.it, w.client);
  assert.deepEqual(failed.log.at(-1), ["editReply", { components: [{ error: "❌ 결과를 찾을 수 없습니다!" }], flags: MessageFlags.IsComponentsV2 }]);

  resolveReply = () => {
    throw new Error("fetch failed");
  };
  const thrown = interaction(w, { options: { query: "끊김" } });
  await cmd("play").execute(thrown.it, w.client);
  assert.match(thrown.log.at(-1)[1].components[0].error, /네트워크 오류/);
});

test("/play: 답하기 전에 던지면 본인에게만 문장으로", async () => {
  const w = world();
  w.client.musicEmbedManager.createSearchingContainer = () => {
    throw new Error("무언가");
  };
  const { it, log } = interaction(w, { options: { query: "노래" } });
  await cmd("play").execute(it, w.client);
  assert.equal(log[0][1].flags, MessageFlags.Ephemeral);
  assert.match(log[0][1].content, /예상치 못한 오류/);
});

test("/play: 재생목록이 더 남았으면 채널에 더 넣기 메뉴를 띄운다", async () => {
  const w = world();
  resolveReply = () => ({ success: true, isPlaylist: true, collection: "playlist", total: 40, nextOffset: 10, tracks: [{ id: "bbbbbbbbbbb", title: "첫 곡" }] });
  const { it, sentOnChannel } = interaction(w, { options: { query: "https://www.youtube.com/playlist?list=PLabcdefghij" } });
  await cmd("play").execute(it, w.client);
  assert.equal(sentOnChannel.length, 1);
  More.clearExpiry(sentOnChannel[0].id);
});

test("/playfirst: DJ 계층이 필요하고, 맨 앞에 넣으라고 코어에 알린다", async () => {
  await settings.setDjRoles("g1", ["dj"]);
  const denied = world();
  const d = interaction(denied, { options: { query: "노래" } });
  await cmd("playfirst").execute(d.it, denied.client);
  assert.deepEqual(d.log, [["reply", { content: S.ERR_NOT_AUTHORIZED, flags: MessageFlags.Ephemeral }]]);

  const w = world({ roles: ["dj"] });
  const ok = interaction(w, { options: { query: "노래" } });
  await cmd("playfirst").execute(ok.it, w.client);
  assert.equal(resolved[0].context, "/playfirst.resolveQuery");
  assert.equal(w.seen[0].handle.insertFirst, true);
});

test("/playfirst: 실패 · 오류 갈래는 /play 와 같다", async () => {
  const w = world({ roles: ["dj"] });
  resolveReply = () => ({ success: false, message: "❌ 결과를 찾을 수 없습니다!" });
  const failed = interaction(w, { options: { query: "없는 노래" } });
  await cmd("playfirst").execute(failed.it, w.client);
  assert.deepEqual(failed.log.at(-1), ["editReply", { components: [{ error: "❌ 결과를 찾을 수 없습니다!" }], flags: MessageFlags.IsComponentsV2 }]);

  resolveReply = () => {
    throw new Error("fetch failed");
  };
  const thrown = interaction(w, { options: { query: "끊김" } });
  await cmd("playfirst").execute(thrown.it, w.client);
  assert.match(thrown.log.at(-1)[1].components[0].error, /네트워크 오류/);

  w.client.musicEmbedManager.createSearchingContainer = () => {
    throw new Error("무언가");
  };
  const early = interaction(w, { options: { query: "노래" } });
  await cmd("playfirst").execute(early.it, w.client);
  assert.equal(early.log[0][1].flags, MessageFlags.Ephemeral);

  resolveReply = () => ({ success: true, isPlaylist: true, collection: "playlist", total: 40, nextOffset: 10, tracks: [{ id: "bbbbbbbbbbb", title: "첫 곡" }] });
  const more = interaction(world({ roles: ["dj"] }), { options: { query: "https://www.youtube.com/playlist?list=PLabcdefghij" } });
  await cmd("playfirst").execute(more.it, more.it.client);
  assert.equal(more.sentOnChannel.length, 1);
  More.clearExpiry(more.sentOnChannel[0].id);
});

// ── /search ───────────────────────────────────────────────────────────

test("/search: 9개를 찾아 번호 버튼과 취소 버튼을 달고, 결과를 메시지 id 로 기억한다", async () => {
  const asked = [];
  YouTube.search = async (q, n) => {
    asked.push([q, n]);
    return Array.from({ length: 6 }, (_, i) => ({ title: `결과 ${i + 1}`, artist: "채널", duration: i === 0 ? 3725 : 65 }));
  };
  const w = world();
  const { it, log } = interaction(w, { options: { query: "노래" } });
  try {
    await cmd("search").execute(it, w.client);
  } finally {
    YouTube.search = real.search;
  }

  assert.deepEqual(asked, [["노래", 9]]);
  const [, payload] = log.at(-1);
  const fields = payload.embeds[0].data.fields;
  assert.deepEqual(fields.map((f) => [f.name, f.value]).slice(0, 2), [
    ["1. 결과 1", "👤 채널 • ⏱️ 1:02:05"],
    ["2. 결과 2", "👤 채널 • ⏱️ 1:05"],
  ]);
  const ids = payload.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
  assert.deepEqual(ids, ["search_select_0", "search_select_1", "search_select_2", "search_select_3", "search_cancel", "search_select_4", "search_select_5"]);
  const saved = w.client.searchResults.get("edited-msg");
  assert.equal(saved.userId, USER);
  assert.equal(saved.results.length, 6);
});

test("/search: 권한 · 결과 없음 · 오류", async () => {
  const denied = world({ userVoice: "v2" });
  const d = interaction(denied, { options: { query: "x" } });
  await cmd("search").execute(d.it, denied.client);
  assert.deepEqual(d.log.at(-1), ["editReply", { content: S.ERR_SAME_CHANNEL }]);

  YouTube.search = async () => [];
  try {
    const none = interaction(world(), { options: { query: "x" } });
    await cmd("search").execute(none.it, none.it.client);
    assert.deepEqual(none.log.at(-1), ["editReply", { content: "❌ 검색 결과가 없습니다!" }]);

    YouTube.search = async () => {
      throw new Error("boom");
    };
    const err = interaction(world(), { options: { query: "x" } });
    await cmd("search").execute(err.it, err.it.client);
    assert.deepEqual(err.log.at(-1), ["editReply", { content: S.ERR_PROCESSING }]);
  } finally {
    YouTube.search = real.search;
  }
  assert.equal(cmd("search").formatDuration(0), "알 수 없음");
});

// ── /join ─────────────────────────────────────────────────────────────

test("/join: 음성에 없거나 봇에게 권한이 없으면 거절, 이미 붙어 있으면 그렇다고", async () => {
  const noVoice = world({ userVoice: null, player: null });
  const a = interaction(noVoice);
  await cmd("join").execute(a.it, noVoice.client);
  assert.deepEqual(a.log, [["reply", { content: S.ERR_VOICE_REQUIRED, flags: [64] }]]);

  const noPerm = world({ canJoin: false, player: null });
  const b = interaction(noPerm);
  await cmd("join").execute(b.it, noPerm.client);
  assert.deepEqual(b.log, [["reply", { content: S.ERR_NO_PERMISSIONS, flags: [64] }]]);

  const joined = world();
  joined.player.connection = {};
  const c = interaction(joined);
  await cmd("join").execute(c.it, joined.client);
  assert.deepEqual(c.log, [["reply", { content: "✅ 이미 채널에 접속해 있어요.", flags: [64] }]]);
});

test("/join: 저장된 세션이 없으면 붙기만 하고, 끝난 패널에 joined 로 알리고, 곡 없이 대기하다 나갈 예약을 건다", async () => {
  const w = world({ player: null });
  const { it, log } = interaction(w);

  await cmd("join").execute(it, w.client);

  const player = w.client.players.get("g1");
  assert.ok(player instanceof h.MusicPlayer);
  assert.ok(player.connection, "붙었다");
  assert.deepEqual(log, [["reply", { content: "✅ 음성 채널에 접속했어요!", flags: [64] }]]);
  await new Promise(setImmediate);
  assert.ok(w.seen.includes("end:joined"));
  assert.ok(player.queueEmptyTimer, "곡 없이 대기");
  h.dispose(player);
});

test("/join: 끊긴 채 남은 플레이어는 자원을 놓게 한 뒤 새것으로 바꾼다", async () => {
  const w = world();
  const calls = [];
  Object.assign(w.player, { connection: null, releaseResources: () => calls.push("release"), releaseAudioProtection: () => calls.push("unprotect") });
  const { it } = interaction(w);

  await cmd("join").execute(it, w.client);

  assert.deepEqual(calls, ["release", "unprotect"]);
  assert.notEqual(w.client.players.get("g1"), w.player);
  h.dispose(w.client.players.get("g1"));
});

test("/join: 저장된 세션이 있으면 되살리고 결과를 답한다(재생 · 일시정지 · 곡 없음 · 실패)", async () => {
  CacheManager.sessions.saveSession("g1", { voiceChannelId: "v1", textChannelId: "c1", volume: 100, loop: "off", autoplay: null, pausedManual: false, positionMs: 0, startOffsetMs: 0, requesterId: USER });
  CacheManager.sessions.setCurrent("g1", { title: "저장된 곡", url: "https://youtu.be/ccccccccccc", platform: "youtube", addedAt: 1 });

  const run = async (restore) => {
    h.MusicPlayer.prototype.restoreFromState = restore;
    const w = world({ player: null });
    const { it, log } = interaction(w);
    try {
      await cmd("join").execute(it, w.client);
    } finally {
      h.MusicPlayer.prototype.restoreFromState = real.restore;
      const p = w.client.players.get("g1");
      if (p) h.dispose(p);
    }
    return { log, w };
  };

  const playing = await run(async function () {
    this.currentTrack = { title: "저장된 곡" };
  });
  assert.deepEqual(playing.log[0], ["deferReply", undefined]);
  assert.deepEqual(playing.log[1], ["editReply", { content: "▶️ 이전 세션을 복구했어요! **저장된 곡** 재생 중" }]);

  const paused = await run(async function () {
    this.currentTrack = { title: "저장된 곡" };
    this.paused = true;
  });
  assert.deepEqual(paused.log[1], ["editReply", { content: "⏸️ 이전 세션을 복구했어요! **저장된 곡**. 일시정지 상태예요" }]);

  const empty = await run(async () => {});
  assert.deepEqual(empty.log[1], ["editReply", { content: "✅ 음성 채널에 접속했어요. (세션 복구 실패 - 곡을 찾을 수 없음)" }]);

  const failed = await run(async () => {
    throw new Error("복원 실패");
  });
  assert.deepEqual(failed.log[1], ["editReply", { content: "⚠️ 이전 세션 복구 중 오류가 발생했습니다. `/play`로 다시 시작해 주세요." }]);
  assert.equal(failed.w.client.players.has("g1"), false, "실패하면 레지스트리에서 뺀다");
});

// ── /autoplay ─────────────────────────────────────────────────────────

test("/autoplay: 켜져 있으면 끄고 30초짜리 다시 고르기 메뉴를, 꺼져 있으면 장르 메뉴를", async () => {
  const on = world();
  on.player.autoplay = "가요";
  const a = interaction(on);
  await cmd("autoplay").execute(a.it, on.client);
  assert.deepEqual(on.seen, ["autoplay:false", "update"]);
  assert.match(JSON.stringify(a.log[0][1]), /autoplay_genre/);

  const off = world();
  const b = interaction(off);
  await cmd("autoplay").execute(b.it, off.client);
  assert.deepEqual(off.seen, []);
  assert.match(JSON.stringify(b.log[0][1]), /autoplay_genre/);
});

test("/autoplay: DJ 계층이 필요하고, 봇이 쉬면 소환할 수 있어야 한다. 플레이어가 없으면 만든다", async () => {
  await settings.setDjRoles("g1", ["dj"]);
  const denied = world();
  const d = interaction(denied);
  await cmd("autoplay").execute(d.it, denied.client);
  assert.deepEqual(d.log, [["reply", { content: S.ERR_NOT_AUTHORIZED, flags: [64] }]]);

  const idle = world({ botVoice: null, userVoice: null, roles: ["dj"] });
  const i = interaction(idle);
  await cmd("autoplay").execute(i.it, idle.client);
  assert.deepEqual(i.log, [["reply", { content: S.ERR_VOICE_REQUIRED, flags: [64] }]]);

  const fresh = world({ player: null, roles: ["dj"] });
  const f = interaction(fresh);
  await cmd("autoplay").execute(f.it, fresh.client);
  const created = fresh.client.players.get("g1");
  assert.ok(created instanceof h.MusicPlayer);
  h.dispose(created);
});

// ── /dashboard ────────────────────────────────────────────────────────

test("/dashboard: 전용 채널이 있으면 그 채널에서만(권한 무관), 없으면 DJ 계층", async () => {
  await settings.setBotChannel("g1", "panel-channel");
  await settings.setDjRoles("g1", ["dj"]);
  const w = world();
  const elsewhere = interaction(w, { channelId: "c1" });
  await cmd("dashboard").execute(elsewhere.it, w.client);
  assert.deepEqual(elsewhere.log, [["reply", { content: "❌ 이 명령어는 <#panel-channel> 채널에서만 사용할 수 있습니다!", flags: [64] }]]);

  const inPanel = interaction(w, { channelId: "panel-channel" });
  await cmd("dashboard").execute(inPanel.it, w.client);
  assert.ok(w.seen.includes("repost:panel-channel"), "DJ 가 아니어도 전용 채널에서는 된다");

  await settings.clearBotChannel("g1");
  const noChannel = world();
  const n = interaction(noChannel);
  await cmd("dashboard").execute(n.it, noChannel.client);
  assert.deepEqual(n.log, [["reply", { content: S.ERR_NOT_AUTHORIZED, flags: [64] }]]);
});

test("/dashboard: 곡이 없으면 끝난 패널을 여기에 다시 올리고, 있으면 새 패널을 여기에 만든다", async () => {
  const idle = world();
  const a = interaction(idle, { channelId: "c7" });
  await cmd("dashboard").execute(a.it, idle.client);
  assert.deepEqual(a.log, [["deferReply", { flags: [64] }], ["deleteReply"]]);
  assert.deepEqual(idle.seen, ["repost:c7"]);

  const busy = world();
  busy.player.currentTrack = { title: "지금 곡" };
  busy.player.nowPlayingMessage = {};
  const b = interaction(busy, { channelId: "c8" });
  await cmd("dashboard").execute(b.it, busy.client);
  assert.equal(busy.player.nowPlayingMessage, null);
  assert.equal(busy.player.textChannel.id, "c8");
  assert.deepEqual(busy.seen, ["stopProgress:g1", { newEmbed: "지금 곡", who: "사용자", opts: { reuse: false } }]);
});
