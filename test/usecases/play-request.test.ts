// src/usecases/add-tracks.ts — 곡 추가 경로의 단일 코어.
//
// 회귀 대상: 슬래시 명령/전용 채널/검색 선택은 handleMusicData를, 대시보드는 addTrack을 타서
// 코어가 둘로 갈려 있었다. 같은 버그를 두 번 고쳐야 했고 요청자 모양도 서로 달랐다.

import { test, after } from "node:test";
import assert from "node:assert/strict";

// ── 모킹 (playRequest보다 먼저 — 실 SQLite/네트워크 미접촉) ──────────────
import { openTempStore, setGuild } from "../helpers/temp-store.ts";
import config from "../../src/config/index.ts";
import * as errors from "../../src/ui/text/ko/errors.ts";
import type { Guild, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { BotContext } from "../../src/app/bot-context.ts";
import { Player } from "../../src/player/player.ts";
import type { TrackInfo } from "../../src/player/track.ts";
import type { Collection, LookupResult, Range } from "../../src/sources/lookup.ts";
import type { CollectionResult, Lookup, PlaybackRequest, TrackData } from "../../src/usecases/add-tracks.ts";
import type { MoreState } from "../../src/rules/more-choices.ts";
import type { Responder } from "../../src/ui/now-playing-panel.ts";
import { fakeAdder } from "../helpers/adder.ts";
import { fake, fakePlayer, fakeWith } from "../helpers/fake.ts";
import { codedError } from "../../src/rules/error-kind.ts";
import sink from "../../src/infra/log/sink.ts";
import logger from "../../src/infra/log/logger.ts";
import { networkError } from "../helpers/errors.ts";
import { addFailureMessage } from "../../src/ui/error-messages.ts";
import { plainText } from "../helpers/notice.ts";
import { frame } from "../../src/ui/frame.ts";

const store = openTempStore("play-request-");
after(() => store.close());
setGuild("g1", { playlistAddMax: 50 });

// 시험마다 정하는 조회 · 모음 답
let mockResolve: (query: string) => LookupResult = () => assert.fail("시험이 조회 답을 정하지 않았다");
let mockCollection: (range: Range) => Collection = () => assert.fail("시험이 모음 답을 정하지 않았다");
const resolverCalls: Array<{ query: string; context?: string | null; range?: Range }> = [];
const collectionCalls: Array<{ url: string; range?: Range }> = [];
// 조회 가짜. 곡 추가 코어에 lookup 으로 넘긴다
const lookup: Lookup = {
  async resolveQuery(query, context, range) {
    resolverCalls.push({ query, context, range });
    return mockResolve(query);
  },
  async getCollection(url, range = {}) {
    collectionCalls.push({ url, range });
    return mockCollection(range);
  },
};

const { requestPlayback, continueCollection, toRequester, ensurePlayer } = await import("../../src/usecases/add-tracks.ts");

// ── 하네스 ───────────────────────────────────────────────────
const GUILD_ID = "g1";

function makeChannel(id: string) {
  return fake<GuildTextBasedChannel>({ id, send: async () => ({ delete: async () => {} }) });
}
const voiceOf = (id: string) => fake<VoiceBasedChannel>({ id });

function makeGuild({ botVoice = null, channels = [] }: { botVoice?: VoiceBasedChannel | null; channels?: GuildTextBasedChannel[] } = {}) {
  const cache = new Map(channels.map((c) => [c.id, c]));
  return fake<Guild>({ id: GUILD_ID, channels: { cache }, members: { me: { voice: { channel: botVoice } } } });
}

// 곡 요청이 곡 담기(queueTracks)에 넘긴 것
type EmbedCall = { guildId: string; trackData: TrackData; requester: unknown; responder: Responder | undefined };

function makeBot() {
  const embedCalls: EmbedCall[] = [];
  const bot = fakeWith<BotContext>()({
    embedCalls,
    players: new Map<string, Player>(),
    panels: {},
  });
  fakeAdder(bot, async (_bot, guildId, trackData, requester, responder) => {
    embedCalls.push({ guildId, trackData, requester, responder });
    return { success: true };
  });
  return bot;
}
type TestBot = ReturnType<typeof makeBot>;

// 이 서버의 플레이어. 없으면 실패
function playerOf(bot: TestBot) {
  const player = bot.players.get(GUILD_ID);
  assert.ok(player, "플레이어가 있다");
  return player;
}

function track(title: string, extra: Partial<TrackInfo> = {}): TrackInfo {
  return { title, pageUrl: `https://x/${title}`, requestKey: `https://x/${title}`, platform: "youtube", duration: 0, ...extra };
}

function ok(...titles: string[]): Extract<LookupResult, { success: true }> {
  return { success: true, isPlaylist: titles.length > 1, tracks: titles.map((t) => track(t)) };
}

// ── toRequester ──────────────────────────────────────────────

// 표시에 쓰는 이름은 그 서버에서 보이는 이름이다. GuildMember에는 username이 없어
// 전역 계정명(user.username)이 먼저 잡히면 닉네임이 영영 쓰이지 않는다 — displayName을 먼저 본다.
test("toRequester: GuildMember는 서버 닉네임(displayName)을 쓴다", () => {
  const member = { id: "u1", user: { username: "carl", tag: "carl#0" }, displayName: "칼" };
  assert.deepEqual(toRequester(member), { id: "u1", username: "칼", tag: "carl#0" });
});

test("toRequester: 닉네임이 없으면 전역 계정명으로 떨어진다", () => {
  const member = { id: "u1", user: { username: "carl", tag: "carl#0" } };
  assert.equal(toRequester(member)?.username, "carl");
});

test("toRequester: 대시보드 세션 사용자와 세션 복구 스텁도 같은 모양이 된다", () => {
  assert.deepEqual(toRequester({ id: "u2", username: "web" }), { id: "u2", username: "web", tag: null });
  assert.deepEqual(toRequester({ id: "u3", tag: "old#1" }), { id: "u3", username: null, tag: "old#1" });
});

test("toRequester: username이 없으면 displayName으로 떨어진다", () => {
  assert.equal(toRequester({ id: "u4", displayName: "닉네임" })?.username, "닉네임");
});

test("toRequester: null/문자열에 던지지 않는다", () => {
  assert.equal(toRequester(null), null);
  assert.equal(toRequester(undefined), null);
  assert.deepEqual(toRequester("자동재생"), { id: null, username: "자동재생", tag: "자동재생" });
});

// ── ensurePlayer ─────────────────────────────────────────────

test("ensurePlayer: 없으면 만들고 맵에 넣는다", () => {
  const bot = makeBot();
  const guild = makeGuild();
  const channel = makeChannel("t1");
  const voice = voiceOf("v1");

  const player = ensurePlayer(bot, { guild, textChannel: channel, voiceChannel: voice });
  assert.equal(bot.players.get(GUILD_ID), player);
  assert.equal(player.textChannel, channel);
  assert.equal(player.voiceChannel, voice);
});

test("ensurePlayer: 있으면 재사용한다 — 큐가 사라지면 안 된다", () => {
  const bot = makeBot();
  const guild = makeGuild();
  const existing = fakePlayer({ bindChannels: Player.prototype.bindChannels, movePanel: Player.prototype.movePanel, restoreSettings: Player.prototype.restoreSettings, queue: [track("a")], textChannel: makeChannel("old"), voiceChannel: voiceOf("v0") });
  bot.players.set(GUILD_ID, existing);

  const player = ensurePlayer(bot, { guild, textChannel: makeChannel("new"), voiceChannel: voiceOf("v1") });
  assert.equal(player, existing);
  assert.equal(player.queue.length, 1);
});

test("ensurePlayer: 봇이 재생 중이면 voiceChannel을 갱신하지 않는다 (다른 채널 참조 오염 방지)", () => {
  const bot = makeBot();
  const botVoice = voiceOf("botVC");
  const guild = makeGuild({ botVoice });
  const existing = fakePlayer({ bindChannels: Player.prototype.bindChannels, movePanel: Player.prototype.movePanel, restoreSettings: Player.prototype.restoreSettings, voiceChannel: botVoice, textChannel: null });
  bot.players.set(GUILD_ID, existing);

  ensurePlayer(bot, { guild, textChannel: makeChannel("t"), voiceChannel: voiceOf("요청자VC") });
  assert.equal(existing.voiceChannel, botVoice);
});

test("ensurePlayer: 봇이 유휴면 요청자 채널로 갱신한다", () => {
  const bot = makeBot();
  const guild = makeGuild({ botVoice: null });
  const existing = fakePlayer({ bindChannels: Player.prototype.bindChannels, movePanel: Player.prototype.movePanel, restoreSettings: Player.prototype.restoreSettings, voiceChannel: null, textChannel: null });
  bot.players.set(GUILD_ID, existing);

  const requesterVC = voiceOf("v9");
  ensurePlayer(bot, { guild, textChannel: null, voiceChannel: requesterVC });
  assert.equal(existing.voiceChannel, requesterVC);
});

test("ensurePlayer: textChannel을 null로 덮어쓰지 않는다 (대시보드가 기존 채널을 지우면 안 됨)", () => {
  const bot = makeBot();
  const guild = makeGuild();
  const kept = makeChannel("keep");
  const existing = fakePlayer({ bindChannels: Player.prototype.bindChannels, movePanel: Player.prototype.movePanel, restoreSettings: Player.prototype.restoreSettings, textChannel: kept, voiceChannel: null });
  bot.players.set(GUILD_ID, existing);

  ensurePlayer(bot, { guild, textChannel: null, voiceChannel: null });
  assert.equal(existing.textChannel, kept);
});

// ── requestPlayback ──────────────────────────────────────────

// 이 서버에 붙어 있는 플레이어
function seedPlayer(bot: TestBot) {
  bot.players.set(GUILD_ID, fakePlayer({ bindChannels: Player.prototype.bindChannels, movePanel: Player.prototype.movePanel, restoreSettings: Player.prototype.restoreSettings, textChannel: makeChannel("t"), voiceChannel: null, queue: [], loop: false, releaseLoopForLive: () => true, hasLiveTrack: () => false }));
}

// 검색어나 찾은 곡 가운데 하나와 나머지 선택
type Extra = Omit<Partial<PlaybackRequest>, "query" | "tracks"> & ({ query: string; tracks?: undefined } | { tracks: TrackInfo[]; query?: undefined });

function baseArgs(bot: TestBot, guild: Guild, extra: Extra): PlaybackRequest {
  seedPlayer(bot);
  return { guild, requester: { id: "u1", user: { username: "carl" } }, lookup, ffmpegReady: () => true, ...extra };
}

// 방송 중인 라이브는 주소를 ffmpeg에 넘기는 갈래로 재생한다. 더 이상 입구에서 막지 않는다.
test("방송 중인 라이브는 통과시킨다", async () => {
  mockResolve = () => ({ success: true, isPlaylist: false, tracks: [track("24/7 라디오", { isLive: true, liveStatus: "is_live" })] });
  const bot = makeBot();
  const guild = makeGuild();

  await requestPlayback(bot, baseArgs(bot, guild, { query: "https://y/live", source: "/play" }));

  const sent = bot.embedCalls[0].trackData.tracks.map((t) => t.title);
  assert.deepEqual(sent, ["24/7 라디오"]);
  // 로그의 하위 이름에 슬래시 명령의 "/"가 들어가면 track//play 가 된다
  assert.equal(resolverCalls.at(-1)?.context, "play.resolveQuery");
});

test("ffmpeg 가 라이브 갈래를 열 수 없으면 방송 중인 라이브도 거절한다", async () => {
  mockResolve = () => ({ success: true, isPlaylist: false, tracks: [track("24/7 라디오", { isLive: true, liveStatus: "is_live" })] });
  const bot = makeBot();
  const guild = makeGuild();

  const result = await requestPlayback(bot, baseArgs(bot, guild, { query: "https://y/live", source: "/play", ffmpegReady: () => false }));

  assert.equal(result.success ? null : result.code, "live-no-ffmpeg");
  assert.equal(result.success ? "" : plainText(addFailureMessage(result)), plainText(errors.notice("live-no-ffmpeg")));
  assert.equal(bot.embedCalls.length, 0);
});

// 아직 시작하지 않은 방송은 열어 봐야 받을 것이 없다.
// 조용히 버리면 로그만 흐르고 디스코드에는 아무 반응이 없어 먹통처럼 보였다 — 이유를 말하고 거절한다.
test("시작 전 방송은 거절하고 이유를 알린다", async () => {
  mockResolve = () => ({ success: true, isPlaylist: false, tracks: [track("곧 시작", { isLive: true, liveStatus: "is_upcoming" })] });
  const bot = makeBot();
  const guild = makeGuild();

  const result = await requestPlayback(bot, baseArgs(bot, guild, { query: "https://y/soon", source: "/play" }));

  assert.equal(result.success ? null : result.code, "live-upcoming");
  assert.match(result.success ? "" : plainText(addFailureMessage(result)), /아직 시작되지 않은 라이브예요/);
  assert.equal(bot.embedCalls.length, 0, "코어까지 가지 않는다");
});

// 재생목록에 시작 전 방송이 섞여 있으면 그것만 빼고 나머지는 넣는다.
test("재생목록의 시작 전 방송만 걸러내고 나머지는 넣는다", async () => {
  mockResolve = () => ({
    success: true,
    isPlaylist: true,
    collection: "playlist",
    tracks: [track("곧 시작", { isLive: true, liveStatus: "is_upcoming" }), track("보통곡", { duration: 100 })],
  });
  const bot = makeBot();
  const guild = makeGuild();

  await requestPlayback(bot, baseArgs(bot, guild, { query: "https://y/list", source: "/play" }));

  const sent = bot.embedCalls[0].trackData.tracks.map((t) => t.title);
  assert.deepEqual(sent, ["보통곡"]);
});

// 끝이 없는 것은 반복할 수 없다. 라이브가 들어오면 걸려 있던 반복을 푼다.
test("라이브가 대기열에 들어오면 반복을 푼다", async () => {
  mockResolve = () => ({ success: true, isPlaylist: false, tracks: [track("24/7 라디오", { isLive: true, liveStatus: "is_live" })] });
  const bot = makeBot();
  const guild = makeGuild();
  const args = baseArgs(bot, guild, { query: "https://y/live", source: "/play" });
  let released = 0;
  const player = playerOf(bot);
  player.loop = "queue";
  player.releaseLoopForLive = () => {
    released++;
    player.loop = false;
    return true;
  };

  await requestPlayback(bot, args);

  assert.equal(released, 1);
  assert.equal(player.loop, false);
});

test("query 경로: 해석 결과를 코어에 그대로 넘긴다", async () => {
  mockResolve = () => ok("곡A");
  const bot = makeBot();
  const guild = makeGuild();

  const result = await requestPlayback(bot, baseArgs(bot, guild, { query: "곡A", source: "/play" }));

  assert.equal(result.success, true);
  assert.deepEqual(
    bot.embedCalls[0].trackData.tracks.map((t) => t.title),
    ["곡A"],
  );
  assert.equal(resolverCalls.at(-1)?.query, "곡A");
  assert.equal(resolverCalls.at(-1)?.context, "play.resolveQuery");
});

test("tracks 경로: 이미 해석된 트랙은 해석기를 거치지 않는다 (검색 선택)", async () => {
  const before = resolverCalls.length;
  const bot = makeBot();
  const guild = makeGuild();

  const result = await requestPlayback(bot, baseArgs(bot, guild, { tracks: [track("선택곡")] }));

  assert.equal(result.success, true);
  assert.equal(resolverCalls.length, before, "해석기 미호출");
  assert.equal(bot.embedCalls[0].trackData.tracks[0].title, "선택곡");
});

test("받아 둔 음원이 있는 곡은 담을 때부터 그 음원을 잰 길이를 보인다(스포티파이는 장부가 기억하는 음원으로)", async () => {
  const audioCache = await import("../../src/store/audio-cache.ts");
  const trackLookup = await import("../../src/store/track-lookup.ts");
  const yt = "https://www.youtube.com/watch?v=lenreq00001";
  audioCache.recordDownloadStart("yt:lenreq00001", { title: "곡" });
  audioCache.recordDownloadComplete("yt:lenreq00001", audioCache.getFilePath("yt:lenreq00001"), 1, { title: "곡" }, { durationSec: 213.4 });
  const sp = "https://open.spotify.com/track/lenreq1";
  trackLookup.recordTrackLookup({ requestKey: sp, pageUrl: sp, audioUrl: yt, platform: "spotify", title: "곡" });
  const bot = makeBot();
  const spotifyTrack = { ...track("스포티파이 곡"), platform: "spotify", requestKey: sp, pageUrl: sp, audioUrl: undefined, duration: 205 };
  const fresh = { ...track("처음 듣는 곡"), duration: 190 };

  await requestPlayback(bot, baseArgs(bot, makeGuild(), { tracks: [spotifyTrack, fresh] }));

  const [a, b] = bot.embedCalls[0].trackData.tracks;
  assert.deepEqual({ duration: a.duration, durationSource: a.durationSource }, { duration: 213.4, durationSource: "measured" });
  assert.deepEqual({ duration: b.duration, durationSource: b.durationSource }, { duration: 190, durationSource: undefined }, "받아 둔 음원이 없으면 출처가 준 길이");
});

test("두 경로가 같은 결과 모양을 낸다", async () => {
  mockResolve = () => ok("곡A");
  const c1 = makeBot();
  const c2 = makeBot();
  const g = makeGuild();

  const a = await requestPlayback(c1, baseArgs(c1, g, { query: "곡A" }));
  const b = await requestPlayback(c2, baseArgs(c2, g, { tracks: [track("곡A")] }));

  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
});

test("single: 재생목록이어도 첫 곡만 넣는다 (대시보드 '한 곡만')", async () => {
  mockResolve = () => ok("1번", "2번", "3번");
  const bot = makeBot();
  const guild = makeGuild();

  await requestPlayback(bot, baseArgs(bot, guild, { query: "리스트", single: true }));

  const { trackData } = bot.embedCalls[0];
  assert.deepEqual(
    trackData.tracks.map((t) => t.title),
    ["1번"],
  );
  assert.equal(trackData.isPlaylist, false);
});

test("single이 아니면 재생목록 전체가 간다", async () => {
  mockResolve = () => ok("1번", "2번", "3번");
  const bot = makeBot();
  const guild = makeGuild();

  await requestPlayback(bot, baseArgs(bot, guild, { query: "리스트" }));
  assert.equal(bot.embedCalls[0].trackData.tracks.length, 3);
  assert.equal(bot.embedCalls[0].trackData.isPlaylist, true);
});

test("insertFirst가 코어로 전달된다", async () => {
  mockResolve = () => ok("곡A");
  const bot = makeBot();
  const guild = makeGuild();

  await requestPlayback(bot, baseArgs(bot, guild, { query: "곡A", insertFirst: true }));
  assert.equal(bot.embedCalls[0].trackData.insertFirst, true);
});

test("해석 실패는 렌더링 없이 안내문으로 전파된다", async () => {
  mockResolve = () => ({ success: false, code: "no-song-result" });
  const bot = makeBot();
  const guild = makeGuild();

  const result = await requestPlayback(bot, baseArgs(bot, guild, { query: "없는곡" }));

  assert.equal(result.success ? null : result.code, "no-song-result");
  assert.equal(result.success ? "" : plainText(addFailureMessage(result)), plainText(errors.notice("no-song-result")));
  assert.equal(bot.embedCalls.length, 0, "실패 시 코어를 부르지 않는다");
});

test("곡 찾기가 던졌으면 그 까닭과 오류 종류를 넘긴다(입구가 종류로 알린다)", async () => {
  mockResolve = () => ({ success: false, code: "lookup-failed", error: networkError() });
  const bot = makeBot();
  const result = await requestPlayback(bot, baseArgs(bot, makeGuild(), { query: "끊긴 곡" }));
  assert.deepEqual(result, { success: false, code: "lookup-failed", kind: "network-error" });
});

test("곡 찾기가 거절한 까닭(지원하지 않는 링크 등)은 그대로 넘긴다", async () => {
  mockResolve = () => ({ success: false, code: "unsupported-link" });
  const bot = makeBot();

  const result = await requestPlayback(bot, baseArgs(bot, makeGuild(), { query: "https://radio.test/live/playlist.m3u8" }));

  assert.equal(result.success ? null : result.code, "unsupported-link");
  assert.equal(result.success ? "" : plainText(addFailureMessage(result)), "알 수 없는 링크예요!\n재생을 지원하지 않는 플랫폼이에요.");

  // 받을 수 없어 뺀 곡 수도 넘겨 안내에 쓴다
  mockResolve = () => ({ success: false, code: "nothing-playable", skipped: 4 });
  const none = await requestPlayback(bot, baseArgs(bot, makeGuild(), { query: "https://soundcloud.com/a/sets/b" }));
  assert.deepEqual(none, { success: false, code: "nothing-playable", skipped: 4 });
  assert.match(none.success ? "" : plainText(addFailureMessage(none)), /^앞의 4곡이 전부/);
});

// 곡을 찾은 뒤에 플레이어를 만든다. 먼저 만들면 못 찾았을 때 연결도 곡도 없는 플레이어가 남았다
test("봇이 쉬는 서버에서 곡을 못 찾으면 플레이어를 만들지 않는다", async () => {
  mockResolve = () => ({ success: false, code: "no-song-result" });
  const bot = makeBot();
  const guild = makeGuild();

  const result = await requestPlayback(bot, { guild, requester: { id: "u1", user: { username: "carl" } }, lookup, ffmpegReady: () => true, query: "없는곡", textChannel: makeChannel("t1"), voiceChannel: voiceOf("v1") });

  assert.equal(result.success, false);
  assert.equal(bot.players.has(guild.id), false);
});

test("요청자는 정규화된 모양으로 코어에 들어간다 (대시보드 username undefined 회귀)", async () => {
  mockResolve = () => ok("곡A");
  const bot = makeBot();
  const guild = makeGuild();

  await requestPlayback(bot, baseArgs(bot, guild, { query: "곡A" }));
  assert.deepEqual(bot.embedCalls[0].requester, { id: "u1", username: "carl", tag: null });
});

test("responder를 주지 않으면 무동작 어댑터가 간다 (대시보드)", async () => {
  mockResolve = () => ok("곡A");
  const bot = makeBot();
  const guild = makeGuild();

  await requestPlayback(bot, baseArgs(bot, guild, { query: "곡A" }));
  const { responder } = bot.embedCalls[0];
  assert.ok(responder, "곡 요청은 늘 매체를 넘긴다");
  assert.equal(typeof responder.notifyQueued, "function");
  await responder.notifyQueued(frame({ body: "x" })); // 무동작이므로 던지지 않는다
});

// ── 로그: 누가 무엇을 찾아 무엇이 골라졌나 ─────────────────────

// 곡 요청 줄들. 담기(queueTracks)를 부른 때의 로그 길이도 적는다
async function requestLines(args: Partial<PlaybackRequest>, outcome: object = { success: true }) {
  const bot = makeBot();
  let handledAt = -1;
  fakeAdder(bot, async () => ((handledAt = sink.buffer.length), outcome));
  const from = sink.buffer.length;
  await requestPlayback(bot, { guild: makeGuild(), requester: { id: "u1", user: { username: "carl" } }, lookup, ffmpegReady: () => true, source: "/play", ...args } as PlaybackRequest);
  const all = sink.buffer.slice(from).filter((e) => e.sub === "play");
  const lines = all.filter((e) => e.level !== "debug");
  return { lines: lines.map((e) => `${e.level} ${e.text}`), debug: all.filter((e) => e.level === "debug").map((e) => e.text), requestBeforeHandling: handledAt < 0 || sink.buffer.indexOf(lines[0]) < handledAt };
}

test("로그: 검색어와 고른 곡을 틀거나 넣기 전에 info 한 줄로 남긴다. 검색어로 찾았으면 고른 곡의 주소를 붙인다", async () => {
  mockResolve = () => ok("곡A");
  const { lines, requestBeforeHandling } = await requestLines({ query: "rick rolling" });
  assert.deepEqual(lines, ['info 곡 요청: /play | carl | "rick rolling" → "곡A" (https://x/곡A)']);
  assert.ok(requestBeforeHandling, "곧바로 튼 곡의 재생 줄보다 앞선다");

  assert.deepEqual((await requestLines({ query: "https://x/곡A" })).lines, ['info 곡 요청: /play | carl | "https://x/곡A" → "곡A"'], "주소로 요청했으면 주소를 다시 붙이지 않는다");

  mockResolve = () => ok("A", "B");
  const listed = await requestLines({ query: "https://x/list", insertFirst: true });
  assert.match(listed.lines[0], /^info 곡 요청: \/play \| carl \| "https:\/\/x\/list" → .*2곡 \(첫 곡 "A"\) \| 맨 앞$/);
});

test("로그: 이미 찾은 곡(더 넣기)은 검색어 없이 고른 곡과 주소를 싣는다", async () => {
  const { lines } = await requestLines({ source: "더 넣기", tracks: [track("곡B")] });
  assert.deepEqual(lines, ['info 곡 요청: 더 넣기 | carl → "곡B" (https://x/곡B)']);
});

// 로그는 운영자가 까닭을 찾는 곳이다. 사용자에게 보인 문장이 아니라 까닭의 코드와, 던진 것이면 그 오류의 종류를 싣는다
test("로그: 못 넣은 까닭은 코드로. 곡 찾기가 던졌으면 오류 종류를 붙인다", async () => {
  const refused = async (answer: LookupResult | (() => LookupResult)) => {
    mockResolve = typeof answer === "function" ? answer : () => answer;
    return (await requestLines({ query: "q" })).lines;
  };
  assert.deepEqual(await refused({ success: false, code: "no-song-result" }), ['info 곡 요청: /play | carl | "q" → 못 넣음: no-song-result']);
  assert.deepEqual(await refused({ success: false, code: "lookup-failed", error: networkError() }), ['info 곡 요청: /play | carl | "q" → 못 넣음: lookup-failed(network-error)']);
  assert.deepEqual(await refused({ success: false, code: "unsupported-link" }), ['info 곡 요청: /play | carl | "q" → 못 넣음: unsupported-link']);
  const upcoming = { success: true, isPlaylist: false, tracks: [track("곧 시작", { isLive: true, liveStatus: "is_upcoming" })] } as const;
  assert.deepEqual(await refused(() => ({ ...upcoming, tracks: [...upcoming.tracks] })), ['info 곡 요청: /play | carl | "q" → 못 넣음: live-upcoming']);
});

test("로그: 담지 못했으면 그 까닭을 한 줄 더(info). 담았으면 debug 로, 상한으로 뺀 곡 수와 대기열 곡 수", async () => {
  mockResolve = () => ok("곡A");
  const failed = async (outcome: object) => (await requestLines({ query: "곡A" }, outcome)).lines.slice(1);
  assert.deepEqual(await failed({ success: false, code: "voice-failed" }), ["info 곡 담기 실패: voice-failed"]);
  assert.deepEqual(await failed({ success: false, code: "add-failed", kind: "network-error" }), ["info 곡 담기 실패: add-failed(network-error)"]);
  assert.deepEqual(await failed({ success: false, code: "queue-full", dropped: 1 }), ["info 곡 담기 실패: queue-full"]);

  const level = logger.level;
  logger.level = "debug";
  try {
    const dropped = await requestLines({ query: "곡A" }, { success: true, dropped: 2 });
    assert.equal(dropped.lines.length, 1, "담긴 것은 info 로 한 줄 더 남기지 않는다");
    assert.ok(dropped.debug.includes("곡 담기 끝 | 상한으로 2곡 뺌 | 대기열 0곡"), dropped.debug.join(" / "));
    const whole = await requestLines({ query: "곡A" });
    assert.ok(whole.debug.includes("곡 담기 끝 | 대기열 0곡"), whole.debug.join(" / "));
  } finally {
    logger.level = level;
  }
});

// ── 텍스트 채널 폴백 (대시보드 전용 사용 시 임베드) ───────────

test("텍스트 채널이 없으면 서버가 지정한 봇 전용 채널로 채운다", async () => {
  mockResolve = () => ok("곡A");
  setGuild(GUILD_ID, { botChannel: "botCh" });
  const botChannel = makeChannel("botCh");
  const bot = makeBot();
  const guild = makeGuild({ channels: [botChannel] });
  bot.players.set(GUILD_ID, fakePlayer({ bindChannels: Player.prototype.bindChannels, movePanel: Player.prototype.movePanel, restoreSettings: Player.prototype.restoreSettings, textChannel: null, voiceChannel: null, queue: [] }));

  await requestPlayback(bot, { guild, requester: { id: "u1" }, query: "곡A", lookup });
  assert.equal(playerOf(bot).textChannel, botChannel);
});

test("봇 전용 채널이 미설정이면 아무 채널도 추측하지 않는다", async () => {
  mockResolve = () => ok("곡A");
  setGuild(GUILD_ID, { botChannel: null });
  const bot = makeBot();
  const guild = makeGuild({ channels: [makeChannel("random")] });
  bot.players.set(GUILD_ID, fakePlayer({ bindChannels: Player.prototype.bindChannels, movePanel: Player.prototype.movePanel, restoreSettings: Player.prototype.restoreSettings, textChannel: null, voiceChannel: null, queue: [] }));

  await requestPlayback(bot, { guild, requester: { id: "u1" }, query: "곡A", lookup });
  assert.equal(playerOf(bot).textChannel, null);
});

test("호출자가 텍스트 채널을 주면 봇 채널을 조회하지 않는다", async () => {
  mockResolve = () => ok("곡A");
  setGuild(GUILD_ID, { botChannel: "botCh" });
  const bot = makeBot();
  const given = makeChannel("given");
  const guild = makeGuild({ channels: [makeChannel("botCh")] });
  bot.players.set(GUILD_ID, fakePlayer({ bindChannels: Player.prototype.bindChannels, movePanel: Player.prototype.movePanel, restoreSettings: Player.prototype.restoreSettings, textChannel: null, voiceChannel: null, queue: [] }));

  await requestPlayback(bot, { guild, requester: { id: "u1" }, query: "곡A", textChannel: given, lookup });
  assert.equal(playerOf(bot).textChannel, given);
});

// ── 받을 곡 수 (해석기에 넘기는 어림값) ──────────────────────

async function withLimits(queueMax: number, playlistMax: number, fn: () => Promise<void>) {
  const saved = config.bot.maxQueueSize;
  config.bot.maxQueueSize = queueMax;
  setGuild(GUILD_ID, { playlistAddMax: playlistMax });
  try {
    await fn();
  } finally {
    config.bot.maxQueueSize = saved;
    setGuild(GUILD_ID, { playlistAddMax: 50 });
  }
}

async function requestWith({ queued = 0, playing = false, single = false, resolve = () => ok("곡A") }: { queued?: number; playing?: boolean; single?: boolean; resolve?: () => LookupResult }) {
  mockResolve = resolve;
  const bot = makeBot();
  const args = baseArgs(bot, makeGuild(), { query: "목록", single });
  const player = playerOf(bot);
  player.queue = Array.from({ length: queued }, (_, i) => track(`q${i}`));
  if (playing) player.currentTrack = track("now");
  await requestPlayback(bot, args);
  return { limit: resolverCalls.at(-1)?.range?.limit, trackData: bot.embedCalls[0]?.trackData };
}

test("받을 곡 수: 한 번에 넣는 묶음과 남은 자리 중 작은 쪽", () =>
  withLimits(30, 50, async () => {
    assert.equal((await requestWith({ playing: true })).limit, 30);
    assert.equal((await requestWith({ playing: true, queued: 25 })).limit, 5);
    // 비어 있으면 첫 곡은 현재곡이 되니 한 자리 더(31)를 셈하지만, 묶음이 대기열 상한(30)으로 잘려 있어 30에서 멈춘다
    assert.equal((await requestWith({ playing: false })).limit, 30);
    assert.equal((await requestWith({ playing: true, queued: 30 })).limit, 1, "가득 차도 한 곡은 받아 추가 구간이 실패를 알린다");
    assert.equal((await requestWith({ playing: true, single: true })).limit, 1);
  }));

test("받을 곡 수: 상한이 꺼져 있으면 묶음 크기", () =>
  withLimits(0, 50, async () => {
    assert.equal((await requestWith({ playing: true, queued: 400 })).limit, 50);
  }));

test("자리가 모자라 덜 받았고 뒤에 곡이 더 있을 때만 queueLimited", () =>
  withLimits(30, 50, async () => {
    const five = () => ({ ...ok("1", "2", "3", "4", "5"), total: 80 });
    assert.equal((await requestWith({ playing: true, queued: 25, resolve: five })).trackData?.queueLimited, true);

    const room = () => ({ ...ok(...Array.from({ length: 25 }, (_, i) => `s${i}`)), total: 80 });
    assert.equal((await requestWith({ playing: true, queued: 5, resolve: room })).trackData?.queueLimited, true, "남은 자리 25가 묶음 30보다 작다");

    const whole = () => ({ ...ok("1", "2", "3"), total: 3 });
    assert.equal((await requestWith({ playing: true, queued: 25, resolve: whole })).trackData?.queueLimited, undefined, "목록을 다 받았으면 아니다");
  }));

// ── 재생목록 이어 넣기 ───────────────────────────────────────

const SP = "37i9dQZF1E3aglU7q0y10F";
const idOf = (i: number) => `t${String(i).padStart(21, "0")}`; // 22자 트랙 ID

// 원본 목록 — shift만큼 앞에 새 곡이 끼어든 상태를 흉내 낼 수 있다(원래 i번째 곡이 i+shift 자리)
function listSource(size: number, { shift = 0 } = {}) {
  return ({ offset = 0, limit = 0 }: Range): Collection => {
    const tracks: TrackInfo[] = [];
    for (let raw = offset; raw < Math.min(size + shift, offset + limit); raw++) {
      const i = raw - shift;
      tracks.push(i < 0 ? track(`new${raw}`, { id: `n${String(raw).padStart(21, "0")}` }) : track(`s${i}`, { id: idOf(i) }));
    }
    return { tracks, total: size + shift, nextOffset: offset + tracks.length };
  };
}

function stateAt(offset: number, extra: Partial<MoreState> = {}): MoreState {
  return { kind: "spp", listId: SP, offset, anchorId: idOf(offset - 1), insertFirst: false, requesterId: null, ...extra };
}

async function continueWith({ state, count, size = 300, shift = 0, queued = 0, source }: { state: MoreState; count: number; size?: number; shift?: number; queued?: number; source?: (range: Range) => Collection }) {
  mockCollection = source ?? listSource(size, { shift });
  collectionCalls.length = 0;
  const bot = makeBot();
  const guild = makeGuild();
  seedPlayer(bot);
  const player = playerOf(bot);
  player.queue = Array.from({ length: queued }, (_, i) => track(`q${i}`));
  player.currentTrack = track("now");
  const progress: Array<[number, number]> = [];
  const result = await continueCollection(bot, { guild, requester: { id: "u1" }, state, count, lookup, onProgress: (done, want) => progress.push([done, want]) });
  return { result, progress, added: bot.embedCalls[0]?.trackData };
}

// 이어 넣은 결과(넣은 수 · 다음 위치). 넣기 전에 거절됐으면 실패
function continued(r: CollectionResult) {
  if (!("added" in r)) assert.fail(`거절됨: ${r.code}`);
  return r;
}

const addedTitles = (trackData: TrackData | undefined) => trackData?.tracks.map((t) => t.title) ?? [];

test("이어 넣기: 앵커 뒤부터 넣고, 다음 위치·앵커·남은 곡을 넘겨준다", () =>
  withLimits(250, 50, async () => {
    const { result, added } = await continueWith({ state: stateAt(50), count: 50 });
    assert.deepEqual(collectionCalls[0].range, { offset: 45, limit: 55 }, "앵커를 찾으려고 앞으로 더 받는다");
    assert.deepEqual(addedTitles(added).slice(0, 2), ["s50", "s51"]);
    assert.equal(added?.tracks.length, 50);
    const done = continued(result);
    assert.equal(done.added, 50);
    assert.deepEqual({ offset: done.next?.offset, anchorId: done.next?.anchorId, remaining: done.next?.remaining }, { offset: 100, anchorId: idOf(99), remaining: 200 });
  }));

test("이어 넣기: 목록 앞에 곡이 끼어들어도 앵커가 이어 준다 — 빠지거나 겹치는 곡이 없다", () =>
  withLimits(250, 50, async () => {
    const { added } = await continueWith({ state: stateAt(50), count: 50, shift: 2 });
    assert.deepEqual(
      addedTitles(added),
      Array.from({ length: 50 }, (_, i) => `s${50 + i}`),
    );
  }));

test("이어 넣기: 누른 시점의 남은 자리로 자르고, 자리가 없으면 받지도 않는다", () =>
  withLimits(30, 50, async () => {
    const some = await continueWith({ state: stateAt(50), count: 100, queued: 25 });
    assert.equal(some.added?.tracks.length, 5);

    const full = await continueWith({ state: stateAt(50), count: 100, queued: 30 });
    assert.deepEqual(full.result, { success: false, code: "queue-full" });
    assert.equal(collectionCalls.length, 0);
  }));

test("이어 넣기: 넣지 못하면 그 까닭. 플레이어가 없다 · 받을 수 없는 곡뿐이다(뺀 곡 수) · 받은 곡이 없다", () =>
  withLimits(250, 50, async () => {
    const bot = makeBot();
    assert.deepEqual(await continueCollection(bot, { guild: makeGuild(), requester: { id: "u1" }, state: stateAt(50), count: 10, lookup }), { success: false, code: "ended-while-adding" });

    const scState: MoreState = { kind: "scs", listId: "2284916349", offset: 10, anchorId: "3009", insertFirst: false, requesterId: null };
    const previews = await continueWith({ state: scState, count: 50, source: ({ offset = 0 }: Range) => ({ tracks: [], total: 41, nextOffset: offset + 10, skipped: 10 }) });
    assert.deepEqual(previews.result, { success: false, code: "more-nothing-playable", skipped: 10 });

    const empty = await continueWith({ state: stateAt(50), count: 10, source: () => ({ tracks: [], total: 300, nextOffset: 50 }) });
    assert.deepEqual(empty.result, { success: false, code: "more-nothing-found" });
  }));

test("이어 넣기: 다음 묶음을 못 받으면 모은 곡까지만 넣고, 첫 묶음부터 못 받으면 그 까닭을 던진다", () =>
  withLimits(0, 50, async () => {
    const gone = codedError("unavailable-playlist", "목록이 사라졌다");
    const whole = listSource(1000);
    const secondFails = (range: Range) => {
      if (collectionCalls.length > 1) throw gone;
      return whole(range);
    };
    const { added } = await continueWith({ state: stateAt(50), count: 250, source: secondFails });
    assert.equal(added?.tracks.length, 100, "첫 묶음만");

    await assert.rejects(
      continueWith({
        state: stateAt(50),
        count: 250,
        source: () => {
          throw gone;
        },
      }),
      (e) => e === gone,
    );
  }));

test("이어 넣기: 여러 묶음으로 받으며 진행을 알린다", () =>
  withLimits(0, 50, async () => {
    const { progress, added } = await continueWith({ state: stateAt(50), count: 250, size: 1000 });
    assert.equal(collectionCalls.length, 3);
    assert.deepEqual(progress, [
      [100, 250],
      [200, 250],
      [250, 250],
    ]);
    assert.equal(added?.tracks.length, 250);
  }));

test("이어 넣기: 목록 끝이면 넣을 수 있는 만큼 넣고 다음 상태가 없다", () =>
  withLimits(250, 50, async () => {
    const { result, added } = await continueWith({ state: stateAt(50), count: 50, size: 80 });
    assert.equal(added?.tracks.length, 30);
    assert.equal(continued(result).next, null);
    assert.equal(continued(result).remaining, 0);
  }));

test("이어 넣기: 맨 앞에 넣었던 목록은 앵커 곡 바로 뒤에 넣게 한다", () =>
  withLimits(250, 50, async () => {
    const front = await continueWith({ state: stateAt(50, { insertFirst: true }), count: 10 });
    assert.equal(front.added?.insertAfterId, idOf(49));
    assert.equal(continued(front.result).next?.insertFirst, true, "다음 묶음도 같은 자리 규칙을 잇는다");

    const back = await continueWith({ state: stateAt(50), count: 10 });
    assert.equal(back.added?.insertAfterId, undefined);
  }));

// 사운드클라우드 세트는 곡마다 요청이 들어 IP 가 막힐 수 있다. 한 번 누르면 한 구간(10곡)만, 앞을 다시 받지 않고,
// 받을 수 없는 곡이 섞여 모자라도 더 읽지 않는다
test("이어 넣기(사운드클라우드 세트): 한 구간만 읽고, 뺀 곡을 센다", () =>
  withLimits(250, 50, async () => {
    const scSet = ({ offset = 0, limit = 0 }: Range): Collection => {
      const size = Math.min(limit, 10);
      const tracks = Array.from({ length: size - 3 }, (_, i) => track(`sc${offset + i}`, { id: String(3000 + offset + i) }));
      return { tracks, total: 41, nextOffset: offset + size, skipped: 3 };
    };
    const state: MoreState = { kind: "scs", listId: "2284916349", offset: 10, anchorId: "3009", insertFirst: false, requesterId: null };
    const { result, added } = await continueWith({ state, count: 50, source: scSet });
    assert.deepEqual(
      collectionCalls.map((c) => [c.url, c.range]),
      [["https://api.soundcloud.com/playlists/2284916349", { offset: 10, limit: 10 }]],
      "숫자 id 로 한 구간만, 앞을 다시 받지 않는다",
    );
    assert.equal(added?.tracks.length, 7);
    const done = continued(result);
    assert.deepEqual({ added: done.added, skipped: done.skipped, offset: done.next?.offset, batch: done.next?.batch }, { added: 7, skipped: 3, offset: 20, batch: 10 });
  }));

test("재생목록을 넣으면 이어 받을 상태를 결과에 싣는다", async () => {
  mockResolve = () => ({ ...ok("1", "2"), collection: "playlist", total: 120, nextOffset: 2, tracks: [track("1"), { ...track("2"), id: idOf(1) }] });
  const bot = makeBot();
  const result = await requestPlayback(bot, baseArgs(bot, makeGuild(), { query: `https://open.spotify.com/playlist/${SP}` }));
  assert.equal(result.more?.offset, 2);
  assert.equal(result.more?.remaining, 118);
});
