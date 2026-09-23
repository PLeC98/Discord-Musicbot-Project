"use strict";

// 테스트가 한 번도 돌지 않던 이벤트 넷의 지금 동작을 고정한다(구조 리팩터링 0-B).
// 전용 채널 메시지(messageHandler) · 끝난 패널 올리기(panelPin) · 재생목록 더 넣기(playlistMoreHandler) · 모달과 선택 메뉴(modalHandler).
//
// 6단계가 입구를 얇게 만들며 이것들을 유스케이스로 돌린다. 모듈을 통째로 바꿔 끼우지 않는다. 권한 판정 · 서버 설정 · 곡 추가 코어는
// 진짜로 돌리고(서버 설정은 임시 DB), 화면 관리자(client.musicEmbedManager)와 트랙 조회(TrackResolver 의 메서드)만 가짜로 둔다.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, beforeEach, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits } = require("discord.js");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "event-handlers-"));
const audioCache = require("../../src/store/audioCache");
audioCache._cacheDir = path.join(TMP, "audio_cache");
audioCache.initialize(path.join(TMP, "cache.db"));

const S = require("../../src/ui/strings");
const settings = require("../../src/store/guildSettings");
const TrackResolver = require("../../src/sources/trackResolver");
const yamlStore = require("../../src/config/yamlStore");
const More = require("../../src/usecases/playlistMore");
const messageHandler = require("../../events/messageHandler");
const panelPin = require("../../events/panelPin");
const playlistMoreHandler = require("../../events/playlistMoreHandler");
const modalHandler = require("../../events/modalHandler");

const USER = "111111111111111111";
const OTHER = "222222222222222222";

const real = { resolveQuery: TrackResolver.resolveQuery, getCollection: TrackResolver.getCollection };
const resolved = [];
const CONFIG_DIR = path.join(TMP, "config");

before(() => {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONFIG_DIR, "genres.yaml"), "genres:\n  가요:\n    sources:\n      - type: keyword\n        keywords: [가요]\n");
  yamlStore._setConfigDir(CONFIG_DIR);
});

after(() => {
  Object.assign(TrackResolver, real);
  yamlStore._setConfigDir(path.join(__dirname, "..", "..", "config"));
  audioCache.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  settings.cache.clear();
  audioCache.db.exec("DELETE FROM guild_settings;");
  resolved.length = 0;
  TrackResolver.resolveQuery = async (query, context, range) => {
    resolved.push({ query, context, range });
    return { success: true, isPlaylist: false, tracks: [{ id: "aaaaaaaaaaa", title: "곡", url: "https://youtu.be/aaaaaaaaaaa" }] };
  };
});

// ── 세계 ──────────────────────────────────────────────────────────────

// 봇이 있는 음성 채널 · 사용자가 있는 음성 채널 · 모더레이터 여부 · DJ 역할로 세계를 만든다
function world({ botVoice = "v1", userVoice = "v1", moderator = false, roles = [], handle = async () => ({ success: true }) } = {}) {
  const voice = (id) => (id ? { id, name: id, permissionsFor: () => ({ has: () => true }) } : null);
  const guild = { id: "g1", name: "서버", members: { me: { id: "bot", voice: { channel: voice(botVoice) } } }, channels: { cache: new Map() }, roles: { cache: new Map([["dj", { id: "dj" }]]) } };
  const member = {
    id: USER,
    user: { id: USER, bot: false },
    displayName: "사용자",
    guild,
    voice: { channel: voice(userVoice) },
    permissions: { has: (p) => moderator && p === PermissionFlagsBits.ManageGuild },
    roles: { cache: { has: (r) => roles.includes(r) } },
    toString: () => `<@${USER}>`,
  };
  const seen = [];
  const embeds = {
    seen,
    createSearchingContainer: (text) => ({ searching: text }),
    handleMusicData: async (guildId, trackData, who, responder) => {
      seen.push({ guildId, trackData, who });
      return handle(trackData, responder);
    },
    scheduleIdleRepin: async (g, channelId) => seen.push({ repin: channelId }),
    updateNowPlayingEmbed: async () => seen.push("update"),
    queueFullMessage: () => "❌ 대기열이 가득 찼어요.",
  };
  const player = {
    sessionId: "S1",
    queue: [],
    previousTracks: [],
    currentTrack: null,
    volume: 50,
    textChannel: null,
    releaseLoopForLive() {},
    setVolume(v) {
      seen.push(`volume:${v}`);
      this.volume = v;
      return v;
    },
    setAutoplay(g) {
      seen.push(`autoplay:${g}`);
    },
    async handleAutoplay() {
      seen.push("handleAutoplay");
    },
    skip(reason) {
      seen.push(`skip:${reason}`);
      return this.skipResult ?? true;
    },
  };
  const client = { players: new Map([["g1", player]]), musicEmbedManager: embeds, user: { id: "bot" } };
  return { guild, member, client, player, seen };
}

// 채널 하나. 보낸 것과 지운 것을 모은다
function channel(id = "c1") {
  const sent = [];
  return {
    id,
    sent,
    send: async (payload) => {
      const msg = { id: `m${sent.length}`, payload, deleted: false, delete: async () => (msg.deleted = true) };
      sent.push(msg);
      return msg;
    },
  };
}

// ── 전용 채널 메시지 ──────────────────────────────────────────────────

function message(w, { content = "노래 제목", channelId = "bot-channel", bot = false } = {}) {
  const ch = channel(channelId);
  const msg = {
    id: "user-msg",
    author: { bot },
    guild: w.guild,
    member: w.member,
    client: w.client,
    channel: ch,
    content,
    deleted: false,
    replies: [],
    delete: async () => (msg.deleted = true),
    reply: async (text) => {
      const r = { text, deleted: false, delete: async () => (r.deleted = true) };
      msg.replies.push(r);
      return r;
    },
  };
  return msg;
}

test("전용 채널: 봇 메시지 · 빈 메시지 · 전용 채널이 아닌 곳은 무시한다", async () => {
  const w = world();
  await settings.setBotChannel("g1", "bot-channel");
  await messageHandler.execute(message(w, { bot: true }));
  await messageHandler.execute(message(w, { content: "   " }));
  await messageHandler.execute(message(w, { channelId: "other" }));
  settings.cache.clear();
  audioCache.db.exec("DELETE FROM guild_settings;");
  await messageHandler.execute(message(w));
  assert.deepEqual(resolved, []);
});

test("전용 채널: 곡을 넣는다. 사용자 메시지를 지우고, 검색 중 자리표시자를 CV2 로 보내고, 코어에 전용채널로 넘긴다", async () => {
  const w = world();
  await settings.setBotChannel("g1", "bot-channel");
  const msg = message(w, { content: "  노래 제목  " });

  await messageHandler.execute(msg);

  assert.equal(msg.deleted, true);
  assert.deepEqual(msg.channel.sent[0].payload, { components: [{ searching: "🔍 **노래 제목** 검색 중..." }], flags: 32768 });
  assert.equal(resolved[0].query, "노래 제목");
  assert.equal(resolved[0].context, "전용채널.resolveQuery");
  assert.equal(w.seen[0].who.username, "사용자");
});

test("전용 채널: 긴 검색어는 자리표시자에서 60자로 자른다", async () => {
  const w = world();
  await settings.setBotChannel("g1", "bot-channel");
  const msg = message(w, { content: "가".repeat(70) });
  await messageHandler.execute(msg);
  assert.equal(msg.channel.sent[0].payload.components[0].searching, `🔍 **${"가".repeat(60)}…** 검색 중...`);
});

test("전용 채널: 권한이 없으면 답하고, 그 답과 사용자 메시지를 5초 뒤 지운다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = world({ botVoice: "v1", userVoice: null });
    await settings.setBotChannel("g1", "bot-channel");
    const msg = message(w);

    await messageHandler.execute(msg);

    assert.deepEqual(
      msg.replies.map((r) => r.text),
      [S.ERR_VOICE_REQUIRED],
    );
    assert.equal(msg.deleted, false);
    mock.timers.tick(5000);
    await new Promise(setImmediate);
    assert.equal(msg.deleted, true);
    assert.equal(msg.replies[0].deleted, true);
    assert.deepEqual(resolved, []);
  } finally {
    mock.timers.reset();
  }
});

test("전용 채널: 봇이 쉬고 있으면 소환할 수 있는지 본다(사용자가 음성에 없으면 거절)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = world({ botVoice: null, userVoice: null });
    await settings.setBotChannel("g1", "bot-channel");
    const msg = message(w);
    await messageHandler.execute(msg);
    assert.deepEqual(
      msg.replies.map((r) => r.text),
      [S.ERR_VOICE_REQUIRED],
    );
  } finally {
    mock.timers.reset();
  }
});

test("전용 채널: 코어가 실패하면 자리표시자를 치우고 ❌ 문장을 8초 동안 보인다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = world();
    await settings.setBotChannel("g1", "bot-channel");
    TrackResolver.resolveQuery = async () => ({ success: false, message: "결과를 찾을 수 없습니다!" });
    const msg = message(w);

    await messageHandler.execute(msg);

    const [loading, err] = msg.channel.sent;
    assert.equal(loading.deleted, true, "자리표시자를 치운다");
    assert.equal(err.payload.content, S.withErrorMark("결과를 찾을 수 없습니다!"));
    mock.timers.tick(7999);
    await new Promise(setImmediate);
    assert.equal(err.deleted, false);
    mock.timers.tick(1);
    await new Promise(setImmediate);
    assert.equal(err.deleted, true);
  } finally {
    mock.timers.reset();
  }
});

test("전용 채널: 코어가 던지면 일반 오류 문장", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = world({
      handle: async () => {
        throw new Error("boom");
      },
    });
    await settings.setBotChannel("g1", "bot-channel");
    const msg = message(w);
    await messageHandler.execute(msg);
    assert.equal(msg.channel.sent.at(-1).payload.content, "❌ 처리 중 오류가 발생했어요.");
  } finally {
    mock.timers.reset();
  }
});

test("전용 채널: 재생목록이 더 남았으면 채널에 더 넣기 메뉴를 띄운다", async () => {
  const w = world();
  await settings.setBotChannel("g1", "bot-channel");
  TrackResolver.resolveQuery = async () => ({ success: true, isPlaylist: true, collection: "playlist", total: 40, nextOffset: 10, tracks: [{ id: "bbbbbbbbbbb", title: "첫 곡" }] });
  const msg = message(w, { content: "https://www.youtube.com/playlist?list=PLabcdefghij" });

  await messageHandler.execute(msg);

  const offer = msg.channel.sent.at(-1);
  assert.ok(offer.payload.components?.length > 0, "메뉴가 붙은 메시지");
  More.clearExpiry(offer.id);
});

// ── 끝난 패널 올리기 ──────────────────────────────────────────────────

test("패널 올리기: 서버 메시지면 그 채널로 끝난 패널을 다시 올리라고 한다", async () => {
  const w = world();
  await panelPin.execute({ guild: w.guild, client: w.client, channel: { id: "c9" } });
  await panelPin.execute({ guild: null, client: w.client, channel: { id: "dm" } });
  assert.deepEqual(w.seen, [{ repin: "c9" }]);
});

// ── 재생목록 더 넣기 ──────────────────────────────────────────────────

const state = (extra = {}) => ({ kind: "ytp", listId: "PLabcdefghij", offset: 10, anchorId: "bbbbbbbbbbb", insertFirst: false, requesterId: USER, ...extra });

function moreInteraction(w, { select = null, modalCount = null, customState = state(), userId = USER, touched = Date.now() } = {}) {
  const log = [];
  const isSelect = select !== null;
  const it = {
    guild: w.guild,
    member: w.member,
    client: w.client,
    channel: channel("c1"),
    user: { id: userId },
    customId: More.encodeState(isSelect ? More.SELECT_PREFIX : More.MODAL_PREFIX, customState),
    values: isSelect ? [select] : [],
    fields: { getTextInputValue: () => modalCount },
    message: { id: `menu-${Math.random()}`, createdTimestamp: touched, editedTimestamp: null },
    isStringSelectMenu: () => isSelect,
    isModalSubmit: () => !isSelect,
    reply: async (p) => log.push(["reply", p.content]),
    deferUpdate: async () => log.push(["deferUpdate"]),
    deleteReply: async () => log.push(["deleteReply"]),
    update: async (p) => log.push(["update", p.content]),
    editReply: async (p) => log.push(["editReply", p.content ?? "(메뉴)"]),
    showModal: async (m) => log.push(["showModal", m.data.custom_id]),
  };
  return { it, log };
}

test("더 넣기: 다른 상호작용 · 모르는 상태는 무시하거나 거절한다", async () => {
  const w = world();
  await playlistMoreHandler.execute({ isStringSelectMenu: () => true, isModalSubmit: () => false, customId: "music_jumpto:x" });
  const { it, log } = moreInteraction(w, { select: "10" });
  it.customId = "plm:zzz:bad:1:x:b";
  await playlistMoreHandler.execute(it);
  assert.deepEqual(log, [["reply", S.withErrorMark("알 수 없는 메뉴예요.")]]);
});

test("더 넣기: 그만 넣기는 넣은 사람만. 넣은 사람이 누르면 바로 지운다", async () => {
  const w = world();
  const other = moreInteraction(w, { select: "stop", userId: OTHER });
  await playlistMoreHandler.execute(other.it);
  assert.deepEqual(other.log, [["reply", S.withErrorMark("목록을 넣은 사람만 닫을 수 있어요.")]]);

  const mine = moreInteraction(w, { select: "stop" });
  await playlistMoreHandler.execute(mine.it);
  assert.deepEqual(mine.log, [["deferUpdate"], ["deleteReply"]]);
});

test("더 넣기: 시간이 지난 메뉴 · 권한 · 플레이어 없음은 거절", async () => {
  const w = world();
  const old = moreInteraction(w, { select: "10", touched: Date.now() - 31_000 });
  await playlistMoreHandler.execute(old.it);
  assert.deepEqual(old.log, [["reply", S.withErrorMark("시간이 지나 닫힌 메뉴예요. 링크를 다시 넣어 주세요.")]]);

  const noVoice = world({ userVoice: "v2" });
  const denied = moreInteraction(noVoice, { select: "10" });
  await playlistMoreHandler.execute(denied.it);
  assert.deepEqual(denied.log, [["reply", S.withErrorMark(S.ERR_SAME_CHANNEL)]]);

  const empty = world();
  empty.client.players.clear();
  const none = moreInteraction(empty, { select: "10" });
  await playlistMoreHandler.execute(none.it);
  assert.deepEqual(none.log, [["reply", S.withErrorMark(S.ERR_NO_MUSIC)]]);
});

test("더 넣기: 직접 입력은 모달을 띄운다. 숫자가 아니면 거절", async () => {
  const w = world();
  const custom = moreInteraction(w, { select: "custom" });
  await playlistMoreHandler.execute(custom.it);
  assert.equal(custom.log[0][0], "showModal");
  assert.ok(custom.log[0][1].startsWith(`${More.MODAL_PREFIX}:`));

  const bad = moreInteraction(w, { modalCount: "많이" });
  await playlistMoreHandler.execute(bad.it);
  assert.deepEqual(bad.log, [["reply", S.withErrorMark("넣을 곡 수를 1 이상의 숫자로 적어 주세요.")]]);
});

test("더 넣기: 고른 수만큼 이어 받아 넣고, 결과로 메시지를 바꾼 뒤 30초 뒤 지우게 한다", async () => {
  const w = world();
  const asked = [];
  TrackResolver.getCollection = async (url, range) => {
    asked.push({ url, range });
    return { tracks: [{ id: "bbbbbbbbbbb" }, { id: "ccccccccccc", title: "다음" }, { id: "ddddddddddd", title: "다음2" }], total: 12, nextOffset: 12 };
  };
  const { it, log } = moreInteraction(w, { select: "2" });
  try {
    await playlistMoreHandler.execute(it);
  } finally {
    TrackResolver.getCollection = real.getCollection;
    More.clearExpiry(it.message.id);
  }

  assert.deepEqual(log[0], ["update", "⏳ 곡을 가져오는 중…"], "메뉴를 먼저 떼어 두 번 못 누르게 한다");
  assert.deepEqual(asked[0], { url: "https://www.youtube.com/playlist?list=PLabcdefghij", range: { offset: 5, limit: 7 } }, "앵커를 찾으려 다섯 곡(LOOKBACK) 앞부터, 그만큼 더");
  assert.deepEqual(
    w.seen[0].trackData.tracks.map((t) => t.id),
    ["ccccccccccc", "ddddddddddd"],
  );
  assert.equal(log.at(-1)[0], "editReply");
});

// ── 모달 · 선택 메뉴 ──────────────────────────────────────────────────

function menu(w, { customId, values = [], volume = null, select = true } = {}) {
  const log = [];
  const it = {
    guild: w.guild,
    member: w.member,
    client: w.client,
    customId,
    values,
    replied: false,
    deferred: false,
    fields: { getTextInputValue: () => volume },
    isStringSelectMenu: () => select,
    isModalSubmit: () => !select,
    reply: async (p) => {
      it.replied = true;
      log.push(["reply", p.content ?? p.embeds?.[0]?.data?.title]);
    },
    update: async (p) => log.push(["update", p.embeds?.[0]?.data?.title]),
  };
  return { it, log };
}

test("모달: 재생목록 더 넣기(plm · plmm)는 건드리지 않는다. 모르는 모달은 알린다", async () => {
  const w = world();
  const plm = menu(w, { customId: "plm:x" });
  await modalHandler.execute(plm.it);
  assert.deepEqual(plm.log, []);
  const unknown = menu(w, { customId: "who_knows", select: false });
  await modalHandler.execute(unknown.it);
  assert.deepEqual(unknown.log, [["reply", "❌ 알 수 없는 모달!"]]);
});

test("자동재생 장르: 틀고 있지 않으면 바로 뽑고, 틀고 있으면 패널만 갱신. 모르는 장르 · 권한은 거절", async () => {
  const w = world();
  const pick = menu(w, { customId: "autoplay_genre:x", values: ["가요"] });
  await modalHandler.execute(pick.it);
  assert.deepEqual(w.seen, ["autoplay:가요", "handleAutoplay"]);
  assert.deepEqual(pick.log, [["update", "🎲 자동 재생이 활성화되었습니다"]]);

  const w2 = world();
  w2.player.currentTrack = { title: "지금 곡" };
  await modalHandler.execute(menu(w2, { customId: "autoplay_genre:x", values: ["가요"] }).it);
  assert.deepEqual(w2.seen, ["autoplay:가요", "update"]);

  const unknown = menu(world(), { customId: "autoplay_genre:x", values: ["없는장르"] });
  await modalHandler.execute(unknown.it);
  assert.match(unknown.log[0][1], /알 수 없는 장르입니다: `없는장르`/);

  await settings.setDjRoles("g1", ["dj"]);
  const denied = menu(world(), { customId: "autoplay_genre:x", values: ["가요"] });
  await modalHandler.execute(denied.it);
  assert.deepEqual(denied.log, [["reply", S.ERR_NOT_AUTHORIZED]]);
});

test("볼륨 모달: 0~100 숫자만. 적용한 값으로 답한다", async () => {
  const w = world();
  const ok = menu(w, { customId: "volume_modal", volume: "35", select: false });
  await modalHandler.execute(ok.it);
  assert.deepEqual(w.seen, ["volume:35"]);
  assert.deepEqual(ok.log, [["reply", "🔊 볼륨이 변경되었습니다"]]);
  assert.equal(modalHandler.createVolumeBar(35), "`▓▓▓▓▓▓▓░░░░░░░░░░░░░` 35%");

  for (const bad of ["abc", "101", "-1"]) {
    const r = menu(world(), { customId: "volume_modal", volume: bad, select: false });
    await modalHandler.execute(r.it);
    assert.deepEqual(r.log, [["reply", "❌ 볼륨은 0에서 100 사이의 숫자여야 합니다!"]], bad);
  }
});

test("대기열 점프: 고른 곡을 맨 앞으로 옮기고 jump 로 넘긴다. 못 넘기면 되돌린다", async () => {
  const w = world();
  const [a, b, c] = [{ title: "A" }, { title: "B" }, { title: "C" }];
  w.player.queue = [a, b, c];
  const jump = menu(w, { customId: "music_jumpto:u:S1", values: ["2"] });
  await modalHandler.execute(jump.it);
  assert.deepEqual(w.player.queue, [c, a, b]);
  assert.deepEqual(w.seen, ["skip:jump"]);
  assert.deepEqual(jump.log, [["reply", "⏭️ **C**로 이동했습니다!"]]);

  const w2 = world();
  w2.player.queue = [a, b, c];
  w2.player.skipResult = false;
  const fail = menu(w2, { customId: "music_jumpto:u:S1", values: ["1"] });
  await modalHandler.execute(fail.it);
  assert.deepEqual(w2.player.queue, [a, b, c], "되돌린다");
  assert.deepEqual(fail.log, [["reply", "❌ 곡으로 이동하지 못했습니다!"]]);
});

test("대기열 점프: 옛 세션의 메뉴 · 없는 번호는 거절", async () => {
  const w = world();
  w.player.queue = [{ title: "A" }];
  const stale = menu(w, { customId: "music_jumpto:u:OLD", values: ["0"] });
  await modalHandler.execute(stale.it);
  assert.deepEqual(stale.log, [["reply", S.ERR_SESSION_INVALID]]);
  const bad = menu(w, { customId: "music_jumpto:u:S1", values: ["5"] });
  await modalHandler.execute(bad.it);
  assert.deepEqual(bad.log, [["reply", "❌ 선택한 곡을 대기열에서 찾을 수 없습니다!"]]);
});

test("모달: 처리 중 던지면 일반 오류 문장", async () => {
  const w = world();
  w.player.setVolume = () => {
    throw new Error("boom");
  };
  const r = menu(w, { customId: "volume_modal", volume: "10", select: false });
  await modalHandler.execute(r.it);
  assert.deepEqual(r.log, [["reply", S.ERR_PROCESSING]]);
});
