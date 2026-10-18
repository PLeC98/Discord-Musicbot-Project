// 곡 추가 명령(/play · /playfirst · /search · /join · /autoplay · /dashboard)의 지금 동작을 고정한다(구조 리팩터링 0-B).
//
// 6단계가 명령을 얇게 만들고 곡 추가 코어를 usecases/add-tracks 로 옮긴다. 입력 · 권한 · 결과마다 무엇을 불렀는지 적어 둔다.
// /join 과 플레이어가 없을 때의 /autoplay 는 진짜 Player 를 만들므로 재생 하네스(음성 · ffmpeg 가짜, 임시 DB)를 먼저 부른다.
// 권한 판정 · 서버 설정 · 곡 추가 코어는 진짜, 화면 관리자와 트랙 조회만 가짜다.

import { sessions } from "../../src/store/player-sessions.ts";
import * as playerEvents from "../../src/player/events.ts";
import * as tracks from "../helpers/tracks.ts";
import { command, run as runCommand, runViaEntrance } from "../helpers/commands.ts";
import searchCommand from "../../src/discord/commands/search.ts";
import sink from "../../src/infra/log/sink.ts";
import { LIFETIME, lifetimesOf } from "../../src/ui/delivery.ts";
import type { ChatInputCommandInteraction, Client, Guild, GuildMember, StringSelectMenuInteraction } from "discord.js";
import interactionCreate from "../../src/discord/events/interaction-create.ts";
import * as genreConfig from "../../src/config/genres.ts";
import { Player, type PanelMessage } from "../../src/player/player.ts";
import { PlayerRegistry } from "../../src/player/registry.ts";
import type { Requester } from "../../src/player/track.ts";
import type { LookupResult, Range } from "../../src/sources/lookup.ts";
import type { TrackData } from "../../src/usecases/add-tracks.ts";
import { selectOf } from "../helpers/cv2.ts";
import type { BotContext } from "../../src/app/bot-context.ts";
import { fakeAdder } from "../helpers/adder.ts";
import { fake, fakePlayer, fakeWith, fakeBot } from "../helpers/fake.ts";

import * as h from "../helpers/player-harness.ts";
const { behavior } = h; // 하네스의 가짜 설정
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";

import * as errors from "../../src/ui/text/ko/errors.ts";
import * as settings from "../../src/store/guild-settings.ts";
import * as lookup from "../../src/sources/lookup.ts";
import * as addTracks from "../../src/usecases/add-tracks.ts";
import * as More from "../../src/usecases/playlist-more.ts";
import { settingsDb } from "../../src/store/settings-db.ts";
import { stateDb } from "../../src/store/state-db.ts";
import { useDefaultDocuments } from "../helpers/config-docs.ts";
import { networkError } from "../helpers/errors.ts";
import { interactionKind } from "../helpers/interaction-kind.ts";
import { frame, noticeFrame, noticeReply, post, reply } from "../../src/ui/frame.ts";
import * as replies from "../../src/ui/control-replies.ts";
import { DISCORD_LOOK } from "../../src/ui/mentions.ts";

useDefaultDocuments();

const USER = "111111111111111111";
const resolved: Array<{ query: string; context?: string | null; range?: Range }> = [];
let resolveReply: (query: string) => LookupResult = () => assert.fail("테스트가 조회 답을 정한다");

after(() => {
  addTracks.useLookup(null);
  h.behavior.restore = null;
});

beforeEach(() => {
  h.reset();
  settings._reset();
  settingsDb.get().exec("DELETE FROM guild_settings;");
  stateDb.get().exec("DELETE FROM player_sessions;");
  resolved.length = 0;
  resolveReply = () => ({ success: true, isPlaylist: false, tracks: [tracks.youtube("aaaaaaaaaaa", { title: "곡" })] });
  // 곡 찾기는 가짜. 진입점을 거쳐 곡 추가 코어가 부른다
  addTracks.useLookup({
    ...lookup,
    resolveQuery: async (query: string, context?: string | null, range?: Range) => {
      resolved.push({ query, context, range });
      return resolveReply(query);
    },
  });
});

// ── 세계 ──────────────────────────────────────────────────────────────

type WorldOptions = { botVoice?: string | null; userVoice?: string | null; roles?: string[]; canJoin?: boolean; player?: "fake" | null; handle?: (trackData: TrackData) => Promise<unknown> };

function world({ botVoice = "v1", userVoice = "v1", roles = [], canJoin = true, player = "fake", handle = async () => ({ success: true }) }: WorldOptions = {}) {
  const voice = (id: string | null) => (id ? { id, name: id, permissionsFor: () => ({ has: () => canJoin }) } : null);
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
    roles: { cache: { has: (r: string) => roles.includes(r) } },
    toString: () => `<@${USER}>`,
  };
  // 패널 관리자가 받은 것. 곡 담기는 handled 에 따로
  const seen: unknown[] = [];
  const handled: Array<{ handle: TrackData; who: Requester | null }> = [];
  const embeds = {
    updatePlaying: async () => seen.push("update"),
    drawEndedPanel: async (_p: unknown, { reason }: { reason: string }) => seen.push(`end:${reason}`),
    repostIdlePanel: async (_g: unknown, ch: { id: string }) => seen.push(`repost:${ch.id}`),
    stopProgressUpdate: (id: string) => seen.push(`stopProgress:${id}`),
    postPlaying: async (_p: unknown, track: { title: string }, _responder: unknown, opts: unknown) => seen.push({ newEmbed: track.title, opts }),
    deleteWebhookCache: () => {},
  };
  const client = fakeWith<Client<true>>()({ user: { id: "bot" }, guilds: { fetch: async () => null } });
  // 운영처럼 진짜 레지스트리. 버려진 플레이어는 알림을 듣고 스스로 뺀다
  const players = new PlayerRegistry();
  players.followDisposals();
  const bot = fakeBot({ client, players, panels: embeds });
  // 곡 담기는 받은 것만 적는다
  fakeAdder(bot, async (_bot, _guildId, trackData, who) => {
    handled.push({ handle: trackData, who });
    return handle(trackData);
  });
  Object.assign(guild, { client });
  // 이미 있는 플레이어(가짜). 테스트가 필드를 바꿔 본다
  const existing = fakePlayer({
    bindChannels: Player.prototype.bindChannels,
    movePanel: Player.prototype.movePanel,
    restoreSettings: Player.prototype.restoreSettings,
    sessionId: "S1",
    queue: [],
    previousTracks: [],
    currentTrack: null,
    autoplay: false as string | false,
    textChannel: null,
    releaseLoopForLive: () => true,
    setAutoplay(v: string | false) {
      seen.push(`autoplay:${v}`);
      this.autoplay = v;
    },
  });
  if (player === "fake") bot.players.set("g1", existing);
  // 조작 뒤 패널 고치기는 플레이어 알림으로 온다
  playerEvents.on("refresh", async (x) => x === existing && seen.push("update"));
  return { guild: fake<Guild>(guild), member: fake<GuildMember>(member), client, bot, seen, handled, player: existing };
}
type World = ReturnType<typeof world>;

// 보낸 응답. 여기서 보는 필드만
type Sent = {
  content?: string;
  flags?: unknown;
  components: Array<{ error?: string; searching?: string; components: Array<{ data: { custom_id?: string } }> }>;
  embeds: Array<{ data: { fields: Array<{ name: string; value: string }> } }>;
};
type Logged = [name: string, payload?: Sent];
// 마지막으로 보낸 것
function lastSent(log: Logged[]) {
  const last = log.at(-1);
  assert.ok(last?.[1], "보낸 것이 있다");
  return last[1];
}

function interaction(w: World, { options = {}, channelId = "c1" }: { options?: Record<string, string>; channelId?: string } = {}) {
  const log: Logged[] = [];
  const sentOnChannel: Array<{ id: string; payload: unknown; delete(): Promise<void> }> = [];
  const it = {
    guild: w.guild,
    member: w.member,
    user: w.member.user,
    client: w.client,
    channel: {
      id: channelId,
      send: async (p: unknown) => {
        const m = { id: `ch${sentOnChannel.length}`, payload: p, delete: async () => {} };
        sentOnChannel.push(m);
        return m;
      },
    },
    replied: false,
    deferred: false,
    options: { getString: (n: string) => options[n] ?? null },
    reply: async (p: Sent) => {
      it.replied = true;
      log.push(["reply", p]);
      return { id: "reply-msg" };
    },
    deferReply: async (p?: Sent) => {
      it.deferred = true;
      log.push(["deferReply", p]);
    },
    editReply: async (p: Sent) => {
      log.push(["editReply", p]);
      return { id: "edited-msg" };
    },
    deleteReply: async () => log.push(["deleteReply"]),
    followUp: async (p: Sent) => {
      log.push(["followUp", p]);
      return { id: "follow" };
    },
  };
  return { it, log, sentOnChannel, bot: w.bot };
}

// ── /play · /playfirst ────────────────────────────────────────────────

test("/play: 권한(재적 규칙)이 없으면 본인에게만 알리고 찾지 않는다", async () => {
  const w = world({ userVoice: "v2" });
  const { it, log } = interaction(w, { options: { query: "노래" } });
  await runCommand(await command("play"), it, w.bot);
  assert.deepEqual(log, [["reply", noticeReply(errors.notice("must-be-in-same-voice"))]]);
  assert.deepEqual(resolved, []);

  // 봇이 쉬면 소환할 수 있어야 한다(봇에게 연결 · 말하기 권한)
  const idle = world({ botVoice: null, canJoin: false });
  const j = interaction(idle, { options: { query: "노래" } });
  await runCommand(await command("play"), j.it, idle.bot);
  assert.deepEqual(j.log, [["reply", noticeReply(errors.notice("permission-voice"))]]);
  assert.deepEqual(resolved, []);
});

test("/play: 검색 중 자리표시자를 본인에게 CV2 로 먼저 답하고 코어에 /play 로 넘긴다", async () => {
  const w = world();
  const { it, log } = interaction(w, { options: { query: "노래" } });
  await runCommand(await command("play"), it, w.bot);
  assert.deepEqual(log[0], ["reply", reply(frame({ body: "🔍 **노래** 검색 중..." }))], "처음부터 Components V2 로 답해야 안내 · 메뉴로 고칠 수 있다");
  assert.equal(resolved[0].context, "play.resolveQuery");
  assert.equal(w.handled[0].handle.insertFirst, undefined);
  assert.equal(w.handled[0].who?.username, "사용자");
});

test("/play: 코어가 실패하면 오류 컨테이너로 답을 바꾸고, 던지면 진입점이 그 오류의 문장으로 바꾼다", async () => {
  const w = world();
  resolveReply = () => ({ success: false, code: "no-song-result" });
  const failed = interaction(w, { options: { query: "없는 노래" } });
  await runCommand(await command("play"), failed.it, w.bot);
  assert.deepEqual(failed.log.at(-1), ["editReply", post(noticeFrame(errors.notice("no-song-result")))]);

  resolveReply = () => {
    throw networkError();
  };
  const thrown = interaction(w, { options: { query: "끊김" } });
  await runViaEntrance(await command("play"), thrown.it, w.bot);
  assert.equal(thrown.log.length, 2, "검색 중 자리를 바꿀 뿐 따로 알리지 않는다");
  assert.deepEqual(lastSent(thrown.log), post(noticeFrame(errors.notice("network-error"))));
});

test("/play: 답하기 전에 던지면 진입점이 본인에게만 알린다", async () => {
  const w = world();
  const { it, log } = interaction(w, { options: { query: "노래" } });
  it.options.getString = () => {
    throw new Error("무언가");
  };
  await runViaEntrance(await command("play"), it, w.bot);
  assert.deepEqual(log, [["reply", noticeReply(errors.notice("command-failed"))]]);
});

test("/play: 재생목록이 더 남았으면 검색 중 자리표시자(본인)를 더 넣기 메뉴로 고친다. 없으면 그 자리표시자를 삭제한다", async () => {
  const w = world();
  resolveReply = () => ({ success: true, isPlaylist: true, collection: "playlist", total: 40, nextOffset: 10, tracks: [tracks.youtube("bbbbbbbbbbb", { title: "첫 곡" })] });
  const { it, log, sentOnChannel } = interaction(w, { options: { query: "https://www.youtube.com/playlist?list=PLabcdefghij" } });
  await runCommand(await command("play"), it, w.bot);
  assert.ok(selectOf(lastSent(log) as never), "검색 중 자리를 메뉴로");
  assert.equal(log.at(-1)?.[0], "editReply");
  assert.equal(sentOnChannel.length, 0, "메뉴는 채널에 올리지 않는다");
  More.clearExpiry("edited-msg");

  resolveReply = () => ({ success: true, isPlaylist: false, tracks: [tracks.youtube("ccccccccccc", { title: "한 곡" })] });
  const single = interaction(world(), { options: { query: "노래" } });
  await runCommand(await command("play"), single.it, single.bot);
  assert.deepEqual(single.log.at(-1), ["deleteReply"]);
});

test("/playfirst: DJ 계층이 필요하고, 맨 앞에 넣으라고 코어에 알린다", async () => {
  await settings.setDjRoles("g1", ["dj"]);
  const denied = world();
  const d = interaction(denied, { options: { query: "노래" } });
  await runCommand(await command("playfirst"), d.it, denied.bot);
  assert.deepEqual(d.log, [["reply", noticeReply(errors.notice("must-dj"))]]);

  const w = world({ roles: ["dj"] });
  const ok = interaction(w, { options: { query: "노래" } });
  await runCommand(await command("playfirst"), ok.it, w.bot);
  assert.equal(resolved[0].context, "playfirst.resolveQuery");
  assert.equal(w.handled[0].handle.insertFirst, true);
});

test("/play 와 /playfirst 는 같은 길이다. 넣을 위치와 진입점 이름만 다르다", async () => {
  const through = async (name: string) => {
    const w = world({ roles: ["dj"] });
    resolved.length = 0;
    const i = interaction(w, { options: { query: "노래" } });
    await runCommand(await command(name), i.it, w.bot);
    return { handle: w.handled[0].handle, context: resolved[0].context, log: i.log };
  };
  const play = await through("play");
  const first = await through("playfirst");
  assert.deepEqual([play.handle.insertFirst, first.handle.insertFirst], [undefined, true]);
  assert.deepEqual({ ...first.handle, insertFirst: undefined }, { ...play.handle, insertFirst: undefined });
  assert.deepEqual([play.context, first.context], ["play.resolveQuery", "playfirst.resolveQuery"]);
  assert.deepEqual(first.log, play.log, "답하는 모양도 같다");
});

test("/playfirst: 실패 · 오류 분기는 /play 와 같다", async () => {
  const w = world({ roles: ["dj"] });
  resolveReply = () => ({ success: false, code: "no-song-result" });
  const failed = interaction(w, { options: { query: "없는 노래" } });
  await runCommand(await command("playfirst"), failed.it, w.bot);
  assert.deepEqual(failed.log.at(-1), ["editReply", post(noticeFrame(errors.notice("no-song-result")))]);

  resolveReply = () => {
    throw networkError();
  };
  const thrown = interaction(w, { options: { query: "끊김" } });
  await runViaEntrance(await command("playfirst"), thrown.it, w.bot);
  assert.deepEqual(lastSent(thrown.log), post(noticeFrame(errors.notice("network-error"))));

  const early = interaction(w, { options: { query: "노래" } });
  early.it.options.getString = () => {
    throw new Error("무언가");
  };
  await runViaEntrance(await command("playfirst"), early.it, w.bot);
  assert.deepEqual(early.log[0][1]?.flags, [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);

  resolveReply = () => ({ success: true, isPlaylist: true, collection: "playlist", total: 40, nextOffset: 10, tracks: [tracks.youtube("bbbbbbbbbbb", { title: "첫 곡" })] });
  const more = interaction(world({ roles: ["dj"] }), { options: { query: "https://www.youtube.com/playlist?list=PLabcdefghij" } });
  await runCommand(await command("playfirst"), more.it, more.bot);
  assert.ok(selectOf(lastSent(more.log) as never), "검색 중 자리를 메뉴로");
  More.clearExpiry("edited-msg");
});

// ── /search ───────────────────────────────────────────────────────────

test("/search: 9개를 찾아 번호 버튼과 취소 버튼을 단다. 버튼은 검색한 사람 · 번호 · 영상 ID 를 싣는다", async () => {
  const asked: Array<[string, number]> = [];
  const search = async (q: string, n: number) => {
    asked.push([q, n]);
    return Array.from({ length: 6 }, (_, i) => tracks.youtube(`v${i}`, { title: `결과 ${i + 1}`, artist: "채널", duration: i === 0 ? 3725 : 65 }));
  };
  const w = world();
  const { it, log } = interaction(w, { options: { query: "노래" } });
  const from = sink.buffer.length;
  await searchCommand.execute(fake<ChatInputCommandInteraction<"cached">>(it), w.bot, { search });

  assert.deepEqual(asked, [["노래", 9]]);
  assert.deepEqual(log[0], ["deferReply", { flags: MessageFlags.Ephemeral }], "검색 결과는 본인에게만");
  assert.deepEqual(lifetimesOf(it), [LIFETIME.menu], "고르는 화면은 메뉴 수명 뒤 지운다");
  assert.deepEqual(
    sink.buffer
      .slice(from)
      .filter((e) => e.text.startsWith("곡 검색"))
      .map((e) => `${e.level} ${e.text}`),
    ['info 곡 검색: /search | 사용자 | "노래" → 결과 6개'],
    "검색어와 결과 수를 남긴다",
  );
  const payload = lastSent(log);
  const fields = payload.embeds[0].data.fields;
  assert.deepEqual(fields.map((f) => [f.name, f.value]).slice(0, 2), [
    ["1. 결과 1", "👤 채널 • ⏱️ 1:02:05"],
    ["2. 결과 2", "👤 채널 • ⏱️ 1:05"],
  ]);
  const ids = payload.components.flatMap((row) => row.components.map((b) => b.data.custom_id));
  const pick = (n: number) => `search:pick:${USER}:${n + 1}:v${n}`;
  assert.deepEqual(ids, [pick(0), pick(1), pick(2), pick(3), `search:cancel:${USER}`, pick(4), pick(5)]);
});

test("/search: 권한 · 결과 없음 · 오류", async () => {
  const denied = world({ userVoice: "v2" });
  const d = interaction(denied, { options: { query: "x" } });
  await runCommand(await command("search"), d.it, denied.bot);
  // 권한을 먼저 보고 거절은 본인에게만(공개로 미루지 않는다)
  assert.deepEqual(d.log, [["reply", noticeReply(errors.notice("must-be-in-same-voice"))]]);
  const noJoin = world({ botVoice: null, canJoin: false });
  const j = interaction(noJoin, { options: { query: "x" } });
  await runCommand(await command("search"), j.it, noJoin.bot);
  assert.deepEqual(j.log, [["reply", noticeReply(errors.notice("permission-voice"))]], "봇이 쉬면 소환할 수 있어야 한다");

  const none = interaction(world(), { options: { query: "x" } });
  const from = sink.buffer.length;
  await searchCommand.execute(fake<ChatInputCommandInteraction<"cached">>(none.it), none.bot, { search: async () => [] });
  assert.deepEqual(none.log.slice(-2), [["deleteReply"], ["followUp", noticeReply(errors.notice("no-search-results"))]], "미뤄 둔 자리를 지우고 본인에게만");
  assert.ok(sink.buffer.slice(from).some((e) => e.text === '곡 검색: /search | 사용자 | "x" → 결과 없음'));

  // 검색이 던지면 진입점이 남기고, 미뤄 둔 답을 삭제한 뒤 본인에게만 그 종류의 안내로 알린다
  const offline = async () => {
    throw networkError();
  };
  const err = interaction(world(), { options: { query: "x" } });
  const offlineSearch = { ...searchCommand, execute: (i: ChatInputCommandInteraction<"cached">, c: BotContext) => searchCommand.execute(i, c, { search: offline }) };
  await runViaEntrance(offlineSearch, err.it, err.bot);
  assert.deepEqual(
    err.log.map(([name]) => name),
    ["deferReply", "deleteReply", "followUp"],
  );
  assert.deepEqual(err.log[2][1], noticeReply(errors.notice("network-error")));
});

// ── /join ─────────────────────────────────────────────────────────────

test("/join: 음성에 없거나 봇에게 권한이 없으면 거절, 이미 붙어 있으면 그렇다고", async () => {
  const noVoice = world({ userVoice: null, player: null });
  const a = interaction(noVoice);
  await runCommand(await command("join"), a.it, noVoice.bot);
  assert.deepEqual(a.log, [["reply", noticeReply(errors.notice("must-be-in-voice"))]]);

  const noPerm = world({ canJoin: false, player: null });
  const b = interaction(noPerm);
  await runCommand(await command("join"), b.it, noPerm.bot);
  assert.deepEqual(b.log, [["reply", noticeReply(errors.notice("permission-voice"))]]);

  const joined = world();
  joined.player.voice = fake<Player["voice"]>({ isAlive: () => true });
  const c = interaction(joined);
  await runCommand(await command("join"), c.it, joined.bot);
  assert.deepEqual(c.log, [["reply", reply(replies.alreadyJoined())]]);
  assert.deepEqual(lifetimesOf(c.it), [LIFETIME.glance], "아무것도 바뀌지 않았다");
});

test("/join: 봇이 다른 음성 채널에 있으면 옮기지 않고 거절한다(대시보드 부르기와 같은 규칙)", async () => {
  const w = world({ botVoice: "v2", userVoice: "v1", player: null });
  const { it, log } = interaction(w);
  await runCommand(await command("join"), it, w.bot);
  assert.deepEqual(log, [["reply", noticeReply(errors.notice("bot-in-other-voice"))]]);
  assert.equal(w.bot.players.has("g1"), false);
});

test("/join: 음성 채널에 붙지 못하면 만든 플레이어를 버리고 본인에게 알린다", async () => {
  const w = world({ player: null });
  behavior.connect = () => {
    throw new Error("붙지 못함");
  };
  const { it, log } = interaction(w);
  try {
    await runCommand(await command("join"), it, w.bot);
  } finally {
    behavior.connect = null;
  }
  assert.deepEqual(log, [["reply", noticeReply(errors.notice("voice-failed"))]]);
  assert.equal(w.bot.players.has("g1"), false, "붙지 못한 플레이어가 남지 않는다");
});

test("/join: 저장된 세션이 없으면 붙기만 하고, 끝난 패널에 joined 로 알리고, 곡 없이 대기하다 나갈 예약을 건다", async () => {
  const w = world({ player: null });
  const { it, log } = interaction(w);
  // 끝난 패널로 알리는 것은 플레이어 알림을 거친다
  const off = playerEvents.on("ended", async (_p, reason) => w.seen.push(`end:${reason}`));

  try {
    await runCommand(await command("join"), it, w.bot);
  } finally {
    off();
  }

  const player = w.bot.players.get("g1");
  assert.ok(player instanceof h.Player);
  try {
    assert.ok(player.connection, "붙었다");
    assert.deepEqual(log, [["reply", { ...post(replies.joined()), withResponse: true }]], "모두에게");
    assert.ok(w.seen.includes("end:joined"));
    assert.ok(player.idle.emptyTimer, "곡 없이 대기");
  } finally {
    h.dispose(player);
  }
});

test("/join: 붙지 않은 채 남은 플레이어는 저장된 세션을 남긴 채 버리고 새것으로 바꾼다", async () => {
  const w = world();
  const calls: string[] = [];
  // 진짜처럼 버림을 알린다. 레지스트리에서 빼기는 실제 경로(알림)로
  const dispose = async (o: { session: string }) => {
    calls.push(`dispose:${o.session}`);
    playerEvents.disposed(w.player, "replaced");
  };
  Object.assign(w.player, { voice: { isAlive: () => false }, guild: w.guild, dispose });
  const { it } = interaction(w);

  await runCommand(await command("join"), it, w.bot);

  assert.deepEqual(calls, ["dispose:keep"]);
  const replaced = w.bot.players.get("g1");
  assert.ok(replaced);
  assert.notEqual(replaced, w.player);
  h.dispose(replaced);
});

test('/join: 저장된 세션이 있으면 "불러오는 중"을 본인에게 먼저 답하고, 그 메시지를 삭제하고 결과는 모두에게(재생 · 일시정지 · 틀다 실패 · 연달아 실패 · 오류)', async () => {
  sessions().saveSession("g1", { voiceChannelId: "v1", textChannelId: "c1", volume: 100, loopMode: "off", autoplay: null, pausedManual: false, positionMs: 0 });
  sessions().setCurrent("g1", tracks.youtube("ccccccccccc", { title: "저장된 곡" }));

  const run = async (restore: (this: Player, record: unknown, options?: { announce?: boolean }) => Promise<void>) => {
    h.behavior.restore = restore;
    const w = world({ player: null });
    const { it, log, sentOnChannel } = interaction(w);
    try {
      await runCommand(await command("join"), it, w.bot);
    } finally {
      h.behavior.restore = null;
      const p = w.bot.players.get("g1");
      if (p) h.dispose(p);
    }
    // 모두에게 보낸 결과
    const shown = () => sentOnChannel.map((m) => m.payload);
    return { log, w, it, shown };
  };

  const options: unknown[] = [];
  const playing = await run(async function (_record, given) {
    options.push(given);
    this.currentTrack = tracks.youtube("ccccccccccc", { title: "저장된 곡" });
  });
  assert.deepEqual(options, [{ announce: false }], "채널 알림은 내지 않는다(이 응답이 말한다)");
  const saved = tracks.youtube("ccccccccccc", { title: "저장된 곡" });
  assert.deepEqual(playing.log, [["reply", reply(replies.restoring())], ["deleteReply"]]);
  assert.deepEqual(playing.shown(), [post(replies.restored(saved, false))]);
  assert.match(JSON.stringify(playing.shown()), /을 듣고 있었어요\. 이어서 재생할게요!/);
  assert.deepEqual(lifetimesOf(playing.it), [LIFETIME.result], "결과 수명 뒤 지운다");

  const paused = await run(async function () {
    this.currentTrack = tracks.youtube("ccccccccccc", { title: "저장된 곡" });
    this.paused = true;
  });
  assert.deepEqual(paused.shown(), [post(replies.restored(saved, true))]);

  // 복원한 결과(restoreFromState)로 분기한다. 테스트의 가짜는 복원한 뒤의 상태로 결과를 낸다(곡 있음 · 대기열만 남음 · 둘 다 없음)
  const nothingLeft = await run(async () => {});
  assert.deepEqual(nothingLeft.shown(), [post(noticeFrame(errors.notice("restore-nothing-left")))]);

  const stopped = await run(async function () {
    this.queue.push(tracks.youtube("ddddddddddd"), tracks.youtube("eeeeeeeeeee"));
  });
  assert.deepEqual(stopped.shown(), [post(noticeFrame(errors.notice("restore-failed-in-row", { left: 2 })))]);

  const failed = await run(async () => {
    throw new Error("복원 실패");
  });
  assert.deepEqual(failed.shown(), [post(noticeFrame(errors.notice("restore-failed")))]);
  assert.equal(failed.w.bot.players.has("g1"), false, "실패하면 레지스트리에서 뺀다");
});

// ── /autoplay ─────────────────────────────────────────────────────────

test("/autoplay: 켜져 있으면 끄고 다시 선택 메뉴를, 꺼져 있으면 장르 메뉴를", async () => {
  const on = world();
  on.player.autoplay = "가요";
  const a = interaction(on);
  await runCommand(await command("autoplay"), a.it, on.bot);
  assert.deepEqual(on.seen, ["autoplay:false", "update"]);
  assert.match(JSON.stringify(a.log[0][1]), /autoplay:genre/);

  const off = world();
  const b = interaction(off);
  await runCommand(await command("autoplay"), b.it, off.bot);
  assert.deepEqual(off.seen, []);
  assert.match(JSON.stringify(b.log[0][1]), /autoplay:genre/);
});

test("/autoplay: DJ 계층이 필요하고, 봇이 쉬면 소환할 수 있어야 한다. 플레이어가 없으면 만들지 않고 메뉴만 표시한다", async () => {
  await settings.setDjRoles("g1", ["dj"]);
  const denied = world();
  const d = interaction(denied);
  await runCommand(await command("autoplay"), d.it, denied.bot);
  assert.deepEqual(d.log, [["reply", noticeReply(errors.notice("must-dj"))]]);

  const idle = world({ botVoice: null, userVoice: null, roles: ["dj"] });
  const i = interaction(idle);
  await runCommand(await command("autoplay"), i.it, idle.bot);
  assert.deepEqual(i.log, [["reply", noticeReply(errors.notice("must-be-in-voice"))]]);

  const fresh = world({ player: null, roles: ["dj"] });
  const f = interaction(fresh);
  await runCommand(await command("autoplay"), f.it, fresh.bot);
  assert.equal(fresh.bot.players.has("g1"), false, "메뉴만 닫아도 빈 플레이어가 남지 않게, 고른 뒤에 만든다");
  assert.match(JSON.stringify(f.log[0][1]), /"autoplay:genre"/);
});

test("/autoplay 장르 선택: 플레이어가 없으면 선택한 그때 만들어 장르를 걸고 첫 곡을 선택해 튼다", async () => {
  const fresh = world({ player: null, roles: ["dj"] });
  const [genre] = Object.keys(genreConfig.genres().genres); // 지금 설정에 있는 장르
  behavior.autoplay = () => tracks.youtube("apapapapapa", { title: "뽑은 곡" });
  behavior.stream = () => ({ url: "https://media.test/ap", duration: 100 });
  const log: unknown[] = [];
  const pick = fakeWith<StringSelectMenuInteraction<"cached">>()({
    guild: fresh.guild,
    member: fresh.member,
    client: fresh.client,
    channel: { id: "c1", send: async () => ({}) },
    customId: "autoplay:genre",
    values: [genre],
    ...interactionKind("select"),
    reply: async (m: unknown) => log.push(["reply", m]),
    async deferUpdate(this: { deferred: boolean }) {
      this.deferred = true;
      log.push("deferUpdate");
    },
    deleteReply: async () => log.push("deleteReply"),
  });

  await interactionCreate.execute(fresh.bot, pick);

  const created = fresh.bot.players.get("g1");
  assert.ok(created instanceof h.Player, JSON.stringify(log));
  assert.equal(created.autoplay, genre);
  assert.equal(created.currentTrack?.title, "뽑은 곡", "틀고 있지 않았으니 첫 곡을 뽑아 튼다");
  h.dispose(created);
  behavior.autoplay = null;
  behavior.stream = null;
});

test("/autoplay 장르 선택: 플레이어가 없는데 부를 수 없으면(음성 채널 밖) 만들지 않고 거절한다", async () => {
  const away = world({ player: null, roles: ["dj"], botVoice: null, userVoice: null });
  const [genre] = Object.keys(genreConfig.genres().genres);
  const log: unknown[] = [];
  const pick = fakeWith<StringSelectMenuInteraction<"cached">>()({
    guild: away.guild,
    member: away.member,
    client: away.client,
    channel: { id: "c1", send: async () => ({}) },
    customId: "autoplay:genre",
    values: [genre],
    ...interactionKind("select"),
    reply: async (m: unknown) => log.push(m),
    update: async () => log.push("update"),
  });

  await interactionCreate.execute(away.bot, pick);

  assert.deepEqual(log, [noticeReply(errors.notice("must-be-in-voice"))]);
  assert.equal(away.bot.players.has("g1"), false);
});

// ── /dashboard ────────────────────────────────────────────────────────

test("/dashboard: 전용 채널이 있으면 그 채널에서만(권한 무관), 없으면 DJ 계층", async () => {
  await settings.setBotChannel("g1", "panel-channel");
  await settings.setDjRoles("g1", ["dj"]);
  const w = world();
  const elsewhere = interaction(w, { channelId: "c1" });
  await runCommand(await command("dashboard"), elsewhere.it, w.bot);
  assert.deepEqual(elsewhere.log, [["reply", noticeReply(errors.notice("only-in-bot-channel", { channelId: "panel-channel" }, DISCORD_LOOK))]]);

  const inPanel = interaction(w, { channelId: "panel-channel" });
  await runCommand(await command("dashboard"), inPanel.it, w.bot);
  assert.ok(w.seen.includes("repost:panel-channel"), "DJ 가 아니어도 전용 채널에서는 된다");

  await settings.clearBotChannel("g1");
  const noChannel = world();
  const n = interaction(noChannel);
  await runCommand(await command("dashboard"), n.it, noChannel.bot);
  assert.deepEqual(n.log, [["reply", noticeReply(errors.notice("must-dj"))]]);
});

test("/dashboard: 곡이 없으면 끝난 패널을 여기에 다시 올리고, 있으면 새 패널을 여기에 만든다", async () => {
  const idle = world();
  const a = interaction(idle, { channelId: "c7" });
  await runCommand(await command("dashboard"), a.it, idle.bot);
  assert.deepEqual(a.log, [["deferReply", { flags: MessageFlags.Ephemeral }], ["deleteReply"]]);
  assert.deepEqual(idle.seen, ["repost:c7"]);

  const busy = world();
  busy.player.currentTrack = tracks.youtube("ddddddddddd", { title: "지금 곡" });
  busy.player.nowPlayingMessage = fake<PanelMessage>({});
  const b = interaction(busy, { channelId: "c8" });
  await runCommand(await command("dashboard"), b.it, busy.bot);
  assert.equal(busy.player.nowPlayingMessage, null);
  assert.equal(busy.player.textChannel?.id, "c8");
  assert.deepEqual(busy.seen, ["stopProgress:g1", { newEmbed: "지금 곡", opts: { reuse: false } }]);
});
