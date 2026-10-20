// 테스트가 한 번도 돌지 않던 이벤트 넷의 지금 동작을 고정한다(구조 리팩터링 0-B).
// 전용 채널 메시지(messageHandler) · 끝난 패널 올리기(panelPin) · 재생목록 더 넣기(playlistMoreHandler) · 모달과 선택 메뉴(modalHandler · 자동재생 장르는 src/discord/interactions/autoplay).
//
// 6단계가 진입점을 얇게 만들며 이것들을 유스케이스로 돌린다. 모듈을 통째로 교체하지 않는다. 권한 판정 · 서버 설정 · 곡 추가 코어는
// 진짜로 돌리고(서버 설정은 임시 DB), 화면 관리자(봇 문맥의 panels)와 트랙 조회(곡 추가 코어의 useLookup 으로 넘긴 가짜)만 가짜로 둔다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, PermissionFlagsBits, type ClientEvents, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import { settingsDb } from "../../src/store/settings-db.ts";
import * as stores from "../../src/store/stores.ts";
import { Player } from "../../src/player/player.ts";
import * as playerEvents from "../../src/player/events.ts";
import { LIFETIME, lifetimesOf } from "../../src/ui/delivery.ts";
import type { Range } from "../../src/sources/lookup.ts";
import type { MoreState } from "../../src/rules/more-choices.ts";
import { fake, fakeWith, fakeBot } from "../helpers/fake.ts";
import { youtube } from "../helpers/tracks.ts";
import { interactionKind } from "../helpers/interaction-kind.ts";
import { fakeAdder } from "../helpers/adder.ts";
import { textsOf } from "../helpers/cv2.ts";
import { frame, noticeReply, post } from "../../src/ui/frame.ts";
import type { Notice } from "../../src/ui/text/notice.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "event-handlers-"));
const audioCache = await import("../../src/store/audio-cache.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
stores.open(TMP);
audioCache.initialize();

const errors = await import("../../src/ui/text/ko/errors.ts");
const settings = await import("../../src/store/guild-settings.ts");
const lookup = await import("../../src/sources/lookup.ts");
const { useDocument, useDefaultDocuments } = await import("../helpers/config-docs.ts");
const More = await import("../../src/usecases/playlist-more.ts");
const addTracks = await import("../../src/usecases/add-tracks.ts");
const messageHandler = (await import("../../src/discord/events/message-handler.ts")).default;
const panelPin = (await import("../../src/discord/events/panel-pin.ts")).default;
const interactionCreate = (await import("../../src/discord/events/interaction-create.ts")).default;

const channelDelete = (await import("../../src/discord/events/channel-delete.ts")).default;
const guildDelete = (await import("../../src/discord/events/guild-delete.ts")).default;
const panelRecords = await import("../../src/store/panel-records.ts");
const { sessions } = await import("../../src/store/player-sessions.ts");

const USER = "111111111111111111";
const OTHER = "222222222222222222";

// 곡 찾기 가짜. 곡 추가 코어에 넘기고, 테스트마다 진짜로 되돌린 뒤 필요한 필드만 바꾼다
const fakeLookup = { ...lookup };
addTracks.useLookup(fakeLookup);
const resolved: { query: string; context?: string | null; range?: Range }[] = [];
before(() => {
  useDocument("genres", "genres:\n  가요:\n    sources:\n      - type: keyword\n        keywords: [가요]\n");
});

after(() => {
  addTracks.useLookup(null);
  useDefaultDocuments();
  audioCache.close();
  stores.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => {
  settings.forgetCache();
  settingsDb.get().exec("DELETE FROM guild_settings;");
  resolved.length = 0;
  Object.assign(fakeLookup, lookup);
  fakeLookup.resolveQuery = async (query, context, range) => {
    resolved.push({ query, context, range });
    return { success: true, isPlaylist: false, tracks: [youtube("aaaaaaaaaaa", { title: "곡" })] };
  };
});

// ── 세계 ──────────────────────────────────────────────────────────────

type Handled = { guildId: string; trackData: { tracks: { id?: string }[] }; who: { username?: string | null } | null };
type World = ReturnType<typeof world>;

// 봇이 있는 음성 채널 · 사용자가 있는 음성 채널 · 모더레이터 여부 · DJ 역할로 세계를 만든다
function world({ botVoice = "v1", userVoice = "v1", moderator = false, roles = [] as string[], handle = async (): Promise<object> => ({ success: true }) }: { botVoice?: string | null; userVoice?: string | null; moderator?: boolean; roles?: string[]; handle?: (trackData: object, responder: unknown) => Promise<object> } = {}) {
  const voice = (id: string | null) => (id ? { id, name: id, permissionsFor: () => ({ has: () => true }) } : null);
  const guild = { id: "g1", name: "서버", members: { me: { id: "bot", voice: { channel: voice(botVoice) } } }, channels: { cache: new Map() }, roles: { cache: new Map([["dj", { id: "dj" }]]) } };
  const member = {
    id: USER,
    user: { id: USER, bot: false },
    displayName: "사용자",
    guild,
    voice: { channel: voice(userVoice) },
    permissions: { has: (p: bigint) => moderator && p === PermissionFlagsBits.ManageGuild },
    roles: { cache: { has: (r: string) => roles.includes(r) } },
    toString: () => `<@${USER}>`,
  };
  const seen: (string | { repin: string })[] = [];
  const handled: Handled[] = [];
  const embeds = {
    seen,
    scheduleIdleRepin: async (_g: unknown, channelId: string) => seen.push({ repin: channelId }),
    updatePlaying: async () => seen.push("update"),
  };
  const player = {
    bindChannels: Player.prototype.bindChannels,
    movePanel: Player.prototype.movePanel,
    restoreSettings: Player.prototype.restoreSettings,
    sessionId: "S1",
    queue: [] as { title: string }[],
    previousTracks: [] as { title: string }[],
    currentTrack: null as { title: string } | null,
    volume: 50,
    textChannel: null,
    skipResult: true,
    releaseLoopForLive() {},
    setVolume(v: number) {
      seen.push(`volume:${v}`);
      this.volume = v;
      return v;
    },
    setAutoplay(g: string) {
      seen.push(`autoplay:${g}`);
    },
    async handleAutoplay() {
      seen.push("handleAutoplay");
    },
    moveInQueue(from: number, to: number) {
      this.queue.splice(to, 0, this.queue.splice(from, 1)[0]);
      return true;
    },
    skip(reason: string): boolean {
      seen.push(`skip:${reason}`);
      return this.skipResult;
    },
  };
  const registered = fake<Player>(player);
  const client = { user: { id: "bot" } };
  const bot = fakeBot({ client, players: new Map([["g1", registered]]), panels: embeds });
  // 곡 담기는 받은 것만 적는다
  fakeAdder(bot, async (_bot, guildId, trackData, who, responder) => {
    handled.push({ guildId, trackData, who });
    return handle(trackData, responder);
  });
  // 조작 뒤 패널 고치기는 플레이어 알림으로 온다
  playerEvents.on("refresh", async (x) => x === registered && seen.push("update"));
  return { guild, member, client, bot, player, seen, handled };
}

// 채널 하나. 보낸 것과 삭제한 것을 모은다
type Payload = { content?: string; components?: Array<{ searching?: string; toJSON?(): unknown }> };

// 안내가 보인 글자(Components V2 의 글자 컴포넌트들)
const said = (notice: Notice) => textsOf(noticeReply(notice)).join("\n");
const textOf = (payload: Payload) => textsOf(payload as { components: Array<{ toJSON(): unknown }> }).join("\n");
type Sent = { id: string; payload: Payload; deleted: boolean; delete(): Promise<boolean> };

function channel(id = "c1") {
  const sent: Sent[] = [];
  return {
    id,
    sent,
    send: async (payload: Payload) => {
      const msg: Sent = { id: `m${sent.length}`, payload, deleted: false, delete: async () => (msg.deleted = true) };
      sent.push(msg);
      return msg;
    },
  };
}

// ── 전용 채널 메시지 ──────────────────────────────────────────────────

// 이벤트가 받는 메시지(그룹 DM 제외)
type Incoming = ClientEvents["messageCreate"][0];
type Reply = { text: string; deleted: boolean; delete(): Promise<boolean> };

// 채널에 보낸 것은 sent 로 본다
function message(w: World, { content = "노래 제목", channelId = "bot-channel", bot = false } = {}) {
  const ch = channel(channelId);
  const msg = fakeWith<Incoming>()({
    id: "user-msg",
    author: { bot },
    guild: w.guild,
    inGuild: () => Boolean(w.guild),
    member: w.member,
    client: w.client,
    channel: ch,
    sent: ch.sent,
    content,
    deleted: false,
    replies: [] as Reply[],
    delete: async () => (msg.deleted = true),
    reply: async (payload: Payload) => {
      const r: Reply = { text: textOf(payload), deleted: false, delete: async () => (r.deleted = true) };
      msg.replies.push(r);
      return r;
    },
  });
  return msg;
}

test("전용 채널: 봇 메시지 · 빈 메시지 · 전용 채널이 아닌 곳은 무시한다", async () => {
  const w = world();
  await settings.setBotChannel("g1", "bot-channel");
  await messageHandler.execute(w.bot, message(w, { bot: true }));
  await messageHandler.execute(w.bot, message(w, { content: "   " }));
  await messageHandler.execute(w.bot, message(w, { channelId: "other" }));
  settings.forgetCache();
  settingsDb.get().exec("DELETE FROM guild_settings;");
  await messageHandler.execute(w.bot, message(w));
  assert.deepEqual(resolved, []);
});

test("전용 채널: 곡을 넣는다. 사용자 메시지를 1.5초 뒤 삭제하고(곧바로 삭제하면 보낸 사람 앱에 유령으로 남는다), 검색 중 자리표시자를 CV2 로 보내고, 코어에 전용채널로 넘긴다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = world();
    await settings.setBotChannel("g1", "bot-channel");
    const msg = message(w, { content: "  노래 제목  " });

    await messageHandler.execute(w.bot, msg);

    assert.equal(msg.deleted, false, "곧바로 지우지 않는다");
    mock.timers.tick(1499);
    await new Promise(setImmediate);
    assert.equal(msg.deleted, false);
    mock.timers.tick(1);
    await new Promise(setImmediate);
    assert.equal(msg.deleted, true);
    assert.deepEqual(msg.sent[0].payload, post(frame({ body: "🔄 **노래 제목** 검색 중..." })));
    assert.equal(resolved[0].query, "노래 제목");
    assert.equal(resolved[0].context, "전용채널.resolveQuery");
    assert.equal(w.handled[0].who?.username, "사용자");
  } finally {
    mock.timers.reset();
  }
});

test("전용 채널이 삭제되면 설정을 비우고 패널을 옮긴다. 다른 채널 · DM 이 삭제된 것은 보지 않는다", async () => {
  await settings.setBotChannel("g1", "bot-channel");
  const moved: string[] = [];
  const bot = fakeBot({ panels: { onBotChannelChanged: async (g: { id: string }) => moved.push(g.id) } });
  const guild = { id: "g1", name: "서버" };
  const deleted = (id: string, dm = false) => fake<ClientEvents["channelDelete"][0]>({ id, name: "음악", guild, isDMBased: () => dm });

  await channelDelete.execute(bot, deleted("other"));
  await channelDelete.execute(bot, deleted("bot-channel", true));
  assert.equal(await settings.getBotChannel("g1"), "bot-channel");
  assert.deepEqual(moved, []);

  await channelDelete.execute(bot, deleted("bot-channel"));
  assert.equal(await settings.getBotChannel("g1"), null);
  assert.deepEqual(moved, ["g1"]);
});

test("서버에서 나가면 그 서버의 플레이어를 내리고 저장된 대기열 · 패널 위치를 삭제한다. 서버 설정은 남긴다", async () => {
  await settings.setBotChannel("g-left", "bot-channel");
  await panelRecords.setPanel("g-left", "bot-channel", "m1");
  sessions().append("g-left", [{ title: "a", pageUrl: "https://y/a", requestKey: "https://y/a" }]);
  const disposed: Array<{ reason: string; session: string }> = [];
  const player = { dispose: async (how: { reason: string; session: string }) => void disposed.push(how) };
  const bot = fakeBot({ players: new Map([["g-left", player]]) });
  const guild = fake<ClientEvents["guildDelete"][0]>({ id: "g-left", name: "나간 서버", channels: { cache: new Map([["bot-channel", {}]]) } });

  await guildDelete.execute(bot, guild);

  assert.deepEqual(disposed, [{ reason: "서버에서 나감", session: "remove" }]);
  assert.equal(sessions().load("g-left"), null);
  assert.equal(await panelRecords.getPanel("g-left"), null);
  settings.forgetCache();
  assert.equal(await settings.getBotChannel("g-left"), "bot-channel", "다시 초대하면 그대로 쓴다");
});

test("전용 채널: 긴 검색어는 자리표시자에서 60자로 자른다", async () => {
  const w = world();
  await settings.setBotChannel("g1", "bot-channel");
  const msg = message(w, { content: "가".repeat(70) });
  await messageHandler.execute(w.bot, msg);
  assert.equal(textOf(msg.sent[0].payload), `🔄 **${"가".repeat(60)}…** 검색 중...`);
});

test("전용 채널: 권한이 없으면 답하고, 그 답과 사용자 메시지를 경고 수명(10초) 뒤 삭제한다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = world({ botVoice: "v1", userVoice: null });
    await settings.setBotChannel("g1", "bot-channel");
    const msg = message(w);

    await messageHandler.execute(w.bot, msg);

    assert.deepEqual(
      msg.replies.map((r) => r.text),
      [said(errors.notice("must-be-in-same-voice"))],
      "봇이 음성 채널에 있으면 그 채널에 들어오라고 한다",
    );
    mock.timers.tick(9999);
    await new Promise(setImmediate);
    assert.equal(msg.deleted, false);
    assert.equal(msg.replies[0].deleted, false, "답도 같은 수명");
    mock.timers.tick(1);
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
    await messageHandler.execute(w.bot, msg);
    assert.deepEqual(
      msg.replies.map((r) => r.text),
      [said(errors.notice("must-be-in-voice"))],
    );
  } finally {
    mock.timers.reset();
  }
});

test("전용 채널: 코어가 실패하면 자리표시자를 치우고 안내를 그 수준의 수명(경고 10초) 동안 보인다", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const w = world();
    await settings.setBotChannel("g1", "bot-channel");
    fakeLookup.resolveQuery = async () => ({ success: false, code: "no-song-result" });
    const msg = message(w);

    await messageHandler.execute(w.bot, msg);

    const [loading, err] = msg.sent;
    assert.equal(loading.deleted, true, "자리표시자를 치운다");
    assert.equal(textOf(err.payload), said(errors.notice("no-song-result")));
    mock.timers.tick(9999);
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
    await messageHandler.execute(w.bot, msg);
    assert.equal(textOf(msg.sent.at(-1)?.payload ?? {}), said(errors.notice("processing-failed")));
  } finally {
    mock.timers.reset();
  }
});

test("전용 채널: 재생목록이 더 남았으면 채널에 더 넣기 메뉴를 표시한다", async () => {
  const w = world();
  await settings.setBotChannel("g1", "bot-channel");
  fakeLookup.resolveQuery = async () => ({ success: true, isPlaylist: true, collection: "playlist", total: 40, nextOffset: 10, tracks: [youtube("bbbbbbbbbbb", { title: "첫 곡" })] });
  const msg = message(w, { content: "https://www.youtube.com/playlist?list=PLabcdefghij" });

  await messageHandler.execute(w.bot, msg);

  const offer = msg.sent.at(-1);
  assert.ok(offer && (offer.payload.components?.length ?? 0) > 0, "메뉴가 붙은 메시지");
  More.clearExpiry(offer.id);
});

// ── 끝난 패널 올리기 ──────────────────────────────────────────────────

test("패널 올리기: 서버 메시지면 그 채널로 끝난 패널을 다시 올리라고 한다", async () => {
  const w = world();
  await panelPin.execute(w.bot, fake<Incoming>({ guild: w.guild, channel: { id: "c9" } }));
  await panelPin.execute(w.bot, fake<Incoming>({ guild: null, channel: { id: "dm" } }));
  assert.deepEqual(w.seen, [{ repin: "c9" }]);
});

// ── 재생목록 더 넣기 ──────────────────────────────────────────────────

const state = (extra: Partial<MoreState> = {}): MoreState => ({ kind: "ytp", listId: "PLabcdefghij", offset: 10, anchorId: "bbbbbbbbbbb", insertFirst: false, requesterId: USER, ...extra });

type Entry = [string] | [string, string | undefined];
type Menu = StringSelectMenuInteraction<"cached"> | ModalSubmitInteraction<"cached">;
type Shown = { content?: string; embeds?: { data: { title?: string } }[]; components?: Array<{ toJSON(): unknown }> };
// 응답이 보인 글자: 글자 메시지면 그 글자, Components V2 면 글자 컴포넌트들, 임베드면 제목
const shown = (p: Shown) => p.content ?? (p.components ? textsOf(p).join("\n") : p.embeds?.[0]?.data?.title);

// 메뉴 메시지 id 는 따로 돌려준다(모달 상호작용은 메시지가 없을 수 있다)
function moreInteraction(w: World, { select = null, modalCount = null, customState = state(), customId = undefined, userId = USER, touched = Date.now(), mine = false }: { select?: string | null; modalCount?: string | null; customState?: ReturnType<typeof state>; customId?: string; userId?: string; touched?: number; mine?: boolean } = {}) {
  const log: Entry[] = [];
  const isSelect = select !== null;
  const messageId = `menu-${Math.random()}`;
  const room = channel("c1");
  const it = fakeWith<Menu>()({
    guild: w.guild,
    member: w.member,
    client: w.client,
    channel: room,
    user: { id: userId },
    replied: false,
    deferred: false,
    customId: customId ?? More.encodeState(isSelect ? More.SELECT_PREFIX : More.MODAL_PREFIX, customState),
    values: isSelect ? [select] : [],
    fields: { getTextInputValue: () => modalCount },
    message: { id: messageId, createdTimestamp: touched, editedTimestamp: null, flags: { has: (flag: number) => mine && flag === MessageFlags.Ephemeral } },
    ...interactionKind(isSelect ? "select" : "modal"),
    isFromMessage: () => true,
    reply: async (p: Shown) => log.push(["reply", shown(p)]),
    deferUpdate: async () => log.push(["deferUpdate"]),
    deleteReply: async () => log.push(["deleteReply"]),
    update: async (p: Shown) => {
      it.replied = true;
      log.push(["update", shown(p)]);
    },
    editReply: async (p: Shown) => log.push(["editReply", shown(p) ?? "(메뉴)"]),
    showModal: async (m: { data: { custom_id: string } }) => log.push(["showModal", m.data.custom_id]),
  });
  return { it, log, messageId, room, bot: w.bot };
}

test("더 넣기: 모르는 상태는 거절한다", async () => {
  const w = world();
  const { it, log } = moreInteraction(w, { select: "10", customId: "plm:zzz:bad:1:x:b" });
  await interactionCreate.execute(w.bot, it);
  assert.deepEqual(log, [["reply", said(errors.notice("more-unknown-menu"))]]);
});

test("더 넣기: 그만 넣기는 넣은 사람만. 넣은 사람이 누르면 바로 삭제한다", async () => {
  const w = world();
  const other = moreInteraction(w, { select: "stop", userId: OTHER });
  await interactionCreate.execute(other.bot, other.it);
  assert.deepEqual(other.log, [["reply", said(errors.notice("more-not-requester-close"))]]);

  const mine = moreInteraction(w, { select: "stop" });
  await interactionCreate.execute(mine.bot, mine.it);
  assert.deepEqual(mine.log, [["deferUpdate"], ["deleteReply"]]);
});

test("더 넣기: 시간이 지난 메뉴 · 권한 · 플레이어 없음은 거절", async () => {
  const w = world();
  const old = moreInteraction(w, { select: "10", touched: Date.now() - More.LIFETIME_MS - 1_000 });
  await interactionCreate.execute(old.bot, old.it);
  assert.deepEqual(old.log, [["reply", said(errors.notice("more-expired"))]]);

  const noVoice = world({ userVoice: "v2" });
  const denied = moreInteraction(noVoice, { select: "10" });
  await interactionCreate.execute(denied.bot, denied.it);
  assert.deepEqual(denied.log, [["reply", said(errors.notice("must-be-in-same-voice"))]]);

  const empty = world();
  empty.bot.players.clear();
  const none = moreInteraction(empty, { select: "10" });
  await interactionCreate.execute(none.bot, none.it);
  assert.deepEqual(none.log, [["reply", said(errors.notice("no-song"))]]);
});

test("더 넣기: 직접 입력은 모달을 연다. 숫자가 아니면 거절", async () => {
  const w = world();
  const custom = moreInteraction(w, { select: "custom" });
  await interactionCreate.execute(custom.bot, custom.it);
  assert.equal(custom.log[0][0], "showModal");
  assert.ok(custom.log[0][1]?.startsWith(`${More.MODAL_PREFIX}:`));

  const bad = moreInteraction(w, { modalCount: "많이" });
  await interactionCreate.execute(bad.bot, bad.it);
  assert.deepEqual(bad.log, [["reply", said(errors.notice("more-bad-count"))]]);
});

test("더 넣기: 선택한 수만큼 이어 받아 넣고, 채널의 메뉴는 결과로 고치고 본인 메뉴는 삭제하고 결과를 모두에게", async () => {
  const w = world();
  const asked: { url: string; range?: Range }[] = [];
  fakeLookup.getCollection = async (url, range) => {
    asked.push({ url, range });
    return { tracks: [youtube("bbbbbbbbbbb"), youtube("ccccccccccc", { title: "다음" }), youtube("ddddddddddd", { title: "다음2" })], total: 12, nextOffset: 12 };
  };
  const { it, log, messageId } = moreInteraction(w, { select: "2" });
  try {
    await interactionCreate.execute(w.bot, it);
  } finally {
    More.clearExpiry(messageId);
  }

  assert.deepEqual(log[0], ["update", "🔄 곡을 가져오는 중…"], "메뉴를 먼저 떼어 두 번 못 누르게 한다");
  assert.deepEqual(asked[0], { url: "https://www.youtube.com/playlist?list=PLabcdefghij", range: { offset: 5, limit: 7 } }, "앵커를 찾으려 다섯 곡(LOOKBACK) 앞부터, 그만큼 더");
  assert.deepEqual(
    w.handled[0].trackData.tracks.map((t) => t.id),
    ["ccccccccccc", "ddddddddddd"],
  );
  assert.equal(log.at(-1)?.[0], "editReply");
  assert.match(String(log.at(-1)?.[1]), /^✅ 재생목록에서 2곡을 더 넣었어요\./, "결과로 고친다");

  const own = moreInteraction(world(), { select: "2", mine: true });
  try {
    await interactionCreate.execute(own.bot, own.it);
  } finally {
    More.clearExpiry(own.messageId);
  }
  assert.deepEqual(own.log.at(-1), ["deleteReply"], "본인 메뉴는 지운다");
  assert.match(textOf(own.room.sent.at(-1)?.payload ?? {}), /^✅ 재생목록에서 2곡을 더 넣었어요\./, "결과는 모두에게");
});

// ── 모달 · 선택 메뉴 ──────────────────────────────────────────────────

function menu(w: World, { customId, values = [], volume = null, select = true }: { customId: string; values?: string[]; volume?: string | null; select?: boolean }) {
  const log: Entry[] = [];
  const room = channel("c1");
  const it = fakeWith<Menu>()({
    guild: w.guild,
    member: w.member,
    client: w.client,
    customId,
    values,
    replied: false,
    deferred: false,
    channel: room,
    fields: { getTextInputValue: () => volume },
    ...interactionKind(select ? "select" : "modal"),
    isFromMessage: () => true,
    reply: async (p: Shown) => {
      it.replied = true;
      log.push(["reply", shown(p)]);
    },
    update: async (p: Shown) => {
      it.replied = true;
      log.push(["update", shown(p)?.split("\n")[0]]);
    },
    deferUpdate: async () => {
      it.deferred = true;
      log.push(["deferUpdate"]);
    },
    deleteReply: async () => log.push(["deleteReply"]),
  });
  return { it, log, room, bot: w.bot };
}

test("모달: 모르는 모달은 알린다", async () => {
  const w = world();
  const unknown = menu(w, { customId: "who_knows", select: false });
  await interactionCreate.execute(unknown.bot, unknown.it);
  assert.deepEqual(unknown.log, [["reply", said(errors.notice("unknown-interaction"))]]);
});

test("자동재생 장르: 틀고 있지 않으면 바로 선택하고, 틀고 있으면 패널만 갱신. 모르는 장르 · 권한은 거절", async () => {
  const w = world();
  const pick = menu(w, { customId: "autoplay:genre", values: ["가요"] });
  await interactionCreate.execute(pick.bot, pick.it);
  assert.deepEqual(w.seen, ["autoplay:가요", "handleAutoplay"]);
  assert.deepEqual(pick.log, [["deferUpdate"], ["deleteReply"]], "장르 메뉴(본인)는 지운다");
  assert.match(textOf(pick.room.sent[0]?.payload ?? {}), /^### 🎲 자동재생을 시작할게요!/, "켠 결과는 모두에게");
  assert.deepEqual(lifetimesOf(pick.it), [LIFETIME.result], "결과 수명 뒤 지운다");

  const w2 = world();
  w2.player.currentTrack = { title: "지금 곡" };
  await interactionCreate.execute(w2.bot, menu(w2, { customId: "autoplay:genre", values: ["가요"] }).it);
  assert.deepEqual(w2.seen, ["autoplay:가요", "update"]);

  const unknown = menu(world(), { customId: "autoplay:genre", values: ["없는장르"] });
  await interactionCreate.execute(unknown.bot, unknown.it);
  assert.match(unknown.log[0][1] ?? "", /`없는장르`는 없어졌어요/);

  await settings.setDjRoles("g1", ["dj"]);
  const denied = menu(world(), { customId: "autoplay:genre", values: ["가요"] });
  await interactionCreate.execute(denied.bot, denied.it);
  assert.deepEqual(denied.log, [["reply", said(errors.notice("must-dj"))]]);
});

test("볼륨 모달: 0~100 숫자만. 적용한 값으로 답한다", async () => {
  const w = world();
  const ok = menu(w, { customId: "panel:volume", volume: "35", select: false });
  await interactionCreate.execute(ok.bot, ok.it);
  assert.deepEqual(w.seen, ["volume:35"]);
  assert.match(String(ok.log[0][1]), /^### 🔊 볼륨을 조절했어요!\n\*\*\d+%\*\* → \*\*35%\*\*\n-# 👤 요청한 사람 /);

  // "50abc" 를 50 으로 읽지 않는다(parseInt 가 그랬다)
  for (const bad of ["abc", "101", "-1", "50abc", "3.5"]) {
    const r = menu(world(), { customId: "panel:volume", volume: bad, select: false });
    await interactionCreate.execute(r.bot, r.it);
    assert.deepEqual(r.log, [["reply", "### ✏️ 정해진 범위의 숫자로 입력해 주세요!\n볼륨은 0에서 100 까지의 숫자로 적어야 해요."]], bad);
  }
});

test("대기열 점프: 선택한 곡을 맨 앞으로 옮기고 jump 로 넘긴다. 못 넘기면 되돌린다", async () => {
  const w = world();
  const [a, b, c] = [{ title: "A" }, { title: "B" }, { title: "C", pageUrl: "https://c.test" }];
  w.player.queue = [a, b, c];
  const jump = menu(w, { customId: "panel:jump:S1", values: ["2"] });
  await interactionCreate.execute(jump.bot, jump.it);
  assert.deepEqual(w.player.queue, [c, a, b]);
  assert.deepEqual(w.seen, ["skip:jump"]);
  assert.deepEqual(jump.log, [["reply", "### ⏭️ 선택한 곡으로 건너뛰었어요!\n**[C](https://c.test)**를 재생할게요."]]);

  const w2 = world();
  w2.player.queue = [a, b, c];
  w2.player.skipResult = false;
  const fail = menu(w2, { customId: "panel:jump:S1", values: ["1"] });
  await interactionCreate.execute(fail.bot, fail.it);
  assert.deepEqual(w2.player.queue, [a, b, c], "되돌린다");
  assert.deepEqual(fail.log, [["reply", said(errors.notice("switch-failed"))]]);
});

test("대기열 점프: 옛 세션의 메뉴 · 없는 번호는 거절", async () => {
  const w = world();
  w.player.queue = [{ title: "A" }];
  const stale = menu(w, { customId: "panel:jump:OLD", values: ["0"] });
  await interactionCreate.execute(stale.bot, stale.it);
  assert.deepEqual(stale.log, [["reply", said(errors.notice("stale-session"))]]);
  const bad = menu(w, { customId: "panel:jump:S1", values: ["5"] });
  await interactionCreate.execute(bad.bot, bad.it);
  assert.deepEqual(bad.log, [["reply", said(errors.notice("jump-target-gone"))]]);
});

test("모달: 처리 중 던지면 일반 오류 문장", async () => {
  const w = world();
  w.player.setVolume = () => {
    throw new Error("boom");
  };
  const r = menu(w, { customId: "panel:volume", volume: "10", select: false });
  await interactionCreate.execute(r.bot, r.it);
  assert.deepEqual(r.log, [["reply", said(errors.notice("processing-failed"))]]);
});
