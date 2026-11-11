// src/dashboard/guild-access.ts, routes/player.ts, routes/guild-settings.ts: 서버 경로가 상태를 바꾸기 직전에 로그인 세션을 확인하는 연결.
// 실제 세션 저장소를 거친다(test/helpers/real-session). 확인 바로 앞에서 도는 가짜(멤버 조회, 채널 찾기, 곡 찾기)가 그 세션을 다른 기기에서 끝내면
// 경로는 401 login-required로 답하고 아무것도 바꾸지 않는다. 확인을 통과한 경우의 처리는 dashboard-validation, dashboard-join, dashboard-autoplay, dashboard-settings가 본다

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { useDefaultDocuments } from "../helpers/config-docs.ts";
import { fake, fakeBot, fakePlayer } from "../helpers/fake.ts";
import { openTempStore, setGuild } from "../helpers/temp-store.ts";
import { realSessionApp, endOnce } from "../helpers/real-session.ts";
import type { Player } from "../../src/player/player.ts";
import type { Lookup } from "../../src/usecases/add-tracks.ts";

useDefaultDocuments();
const store = openTempStore("session-check-guild-");
const genreConfig = await import("../../src/config/genres.ts");
const settings = await import("../../src/store/guild-settings.ts");
const { fakeAdder } = await import("../helpers/adder.ts");
const { createGuildsRouter } = await import("../../src/dashboard/routes/guilds.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");

const GUILD_ID = "100";
const BOT_CHANNEL = "c1";
// 플레이어에 텍스트 채널이 없으면 전용 채널을 찾는다(채널 찾기가 확인 바로 앞에서 돈다)
setGuild(GUILD_ID, { botChannel: BOT_CHANNEL });

// 세션을 끝낼 자리. 테스트마다 하나를 건다
const at = { fetch: endOnce(), channel: endOnce(), resolve: endOnce(), collection: endOnce() };
// 바뀐 것(조작, 정리, 곡 추가)
const changes: string[] = [];

const voice = (id: string) => ({ id, name: id, permissionsFor: () => ({ has: () => true }) });
const guild = {
  id: GUILD_ID,
  name: "서버",
  roles: { cache: new Map() },
  // 전용 채널 찾기. 찾지 못한 것으로 답한다
  channels: { cache: Object.assign(new Map(), { get: () => (at.channel.now(), undefined) }) },
  voiceStates: { cache: new Map() },
  members: {
    me: { id: "bot", voice: { channel: null } },
    // 이 서버에서 서버 관리자이고 음성 채널 v1에 들어가 있다(봇을 부를 수 있다)
    fetch: async (id: string) => {
      at.fetch.now();
      return { id, user: { id }, displayName: "사용자", guild, permissions: { has: () => true }, voice: { channel: voice("v1") }, roles: { cache: new Map() } };
    },
  },
};

const track = (title: string, id = title) => ({ id, title, artist: "가수", duration: 200, thumbnail: null, url: "u", pageUrl: "u", platform: "youtube", requestedBy: null });

// 곡을 틀고 있는 플레이어. 텍스트 채널을 정하지 않았다
function playingPlayer() {
  return fakePlayer({
    autoplay: false as string | false,
    setAutoplay(genre: string | false) {
      changes.push(`autoplay ${genre}`);
      this.autoplay = genre;
    },
    volume: 50,
    setVolume(level: number) {
      changes.push(`volume ${level}`);
      this.volume = level;
    },
    bindChannels() {},
    currentTrack: track("곡"),
    queue: [],
    previousTracks: [],
    loop: false,
    pause: { userPaused: false, heldBy: null },
    audioPlayer: { state: { status: "playing" } },
    getCurrentTime: () => 0,
    guild,
  });
}

// 음성 채널에 붙지 않은 채 남은 플레이어(음성 연결이 끊겨 있다). 참가는 이것을 정리하고 새로 붙는다
function stalePlayer() {
  return fakePlayer({
    voice: { isAlive: () => false, connect: async () => {} },
    async dispose() {
      changes.push("dispose");
    },
    bindChannels() {},
    showIdleVoiceStatus() {},
    idle: { scheduleEmpty() {} },
    currentTrack: null,
    queue: [],
    previousTracks: [],
    volume: 50,
    loop: false,
    pause: { userPaused: false, heldBy: null },
    audioPlayer: { state: { status: "idle" } },
    getCurrentTime: () => 0,
    guild,
  });
}

const players = new Map<string, Player>();
const bot = fakeBot({ client: { isReady: () => true, user: { id: "bot" }, guilds: { cache: new Map([[GUILD_ID, guild]]) } }, players, panels: { panelChannel: async () => null, updatePlaying: async () => {} } });
fakeAdder(bot, async () => {
  changes.push("add");
  return { success: true, placed: { count: 1, position: 1, collection: null, total: null, skipped: 0, first: track("추가곡") } };
});
const lookup = fake<Lookup>({
  async resolveQuery() {
    at.resolve.now();
    return { success: true, isPlaylist: false, tracks: [track("추가곡")] };
  },
  async getCollection(_url: string, { offset, limit }: { offset: number; limit: number }) {
    at.collection.now();
    return { tracks: Array.from({ length: limit }, (_, k) => track(`c${offset + k}`, `c${String(offset + k).padStart(21, "0")}`)), total: 1000, nextOffset: offset + limit };
  },
});

const real = await realSessionApp("session-check-guild-", (app) => {
  app.use(express.json());
  app.locals.bot = bot;
  app.locals.lookup = lookup;
  app.use("/api/guilds", createGuildsRouter({ stream: createPlayerStream() }));
});
after(() => {
  real.close();
  store.close();
});
afterEach(() => {
  for (const one of Object.values(at)) one.reset();
  changes.length = 0;
  players.clear();
});

// 로그인하고, 그 자리의 가짜가 불리면 이 세션을 끝내게 건다
async function endingAt(where: ReturnType<typeof endOnce>) {
  const who = await real.signedIn("u1");
  where.arm(() => real.end(who));
  return who;
}
// 답과 바뀐 것을 한데 본다(확인을 빼면 200과 바뀐 것이 함께 보인다)
const outcome = (r: { status: number; json: { code?: string } | null }) => ({ status: r.status, code: r.json?.code, changes: [...changes] });
const ENDED = { status: 401, code: "login-required", changes: [] };

test("openGuild: 멤버를 조회하는 사이 세션이 끝나면 재생 조작(볼륨)은 401이고 볼륨을 바꾸지 않는다", async () => {
  const player = playingPlayer();
  players.set(GUILD_ID, player);
  const who = await endingAt(at.fetch);
  const r = await who.call("POST", `/api/guilds/${GUILD_ID}/player/volume`, { volume: 70 });
  assert.ok(at.fetch.fired, "멤버 조회에서 세션을 끝냈다");
  assert.deepEqual(outcome(r), ENDED);
  assert.equal(player.volume, 50);
});

test("openGuild: 멤버를 조회하는 사이 세션이 끝나면 서버 설정 저장은 401이고 설정을 바꾸지 않는다", async () => {
  const who = await endingAt(at.fetch);
  const r = await who.call("PUT", `/api/guilds/${GUILD_ID}/settings`, { playlistAddMax: 20 });
  assert.ok(at.fetch.fired, "멤버 조회에서 세션을 끝냈다");
  assert.deepEqual({ ...outcome(r), saved: settings.table.getPlaylistAddMax(GUILD_ID) }, { ...ENDED, saved: null });
});

test("음성 참가: 전용 채널을 찾는 사이 세션이 끝나면 401이고 남은 플레이어를 정리하지 않는다", async () => {
  const stale = stalePlayer();
  players.set(GUILD_ID, stale);
  const who = await endingAt(at.channel);
  const r = await who.call("POST", `/api/guilds/${GUILD_ID}/player/join`);
  assert.ok(at.channel.fired, "채널 찾기에서 세션을 끝냈다");
  assert.deepEqual(outcome(r), ENDED);
  assert.equal(players.get(GUILD_ID), stale);
});

test("자동재생: 전용 채널을 찾는 사이 세션이 끝나면 401이고 자동재생을 켜지 않는다", async () => {
  const player = playingPlayer();
  players.set(GUILD_ID, player);
  const [genre] = Object.keys(genreConfig.genres().genres);
  const who = await endingAt(at.channel);
  const r = await who.call("POST", `/api/guilds/${GUILD_ID}/player/autoplay`, { genre });
  assert.ok(at.channel.fired, "채널 찾기에서 세션을 끝냈다");
  assert.deepEqual(outcome(r), ENDED);
  assert.equal(player.autoplay, false);
});

test("곡 추가: 곡을 찾는 사이 세션이 끝나면 401이고 곡을 넣지 않는다", async () => {
  players.set(GUILD_ID, playingPlayer());
  const who = await endingAt(at.resolve);
  const r = await who.call("POST", `/api/guilds/${GUILD_ID}/player/queue`, { query: "노래" });
  assert.ok(at.resolve.fired, "곡 찾기에서 세션을 끝냈다");
  assert.deepEqual(outcome(r), ENDED);
});

test("재생목록 더 넣기: 목록을 불러오는 사이 세션이 끝나면 401이고 곡을 넣지 않는다", async () => {
  players.set(GUILD_ID, playingPlayer());
  const who = await endingAt(at.collection);
  const state = { kind: "spp", listId: "37i9dQZF1E3aglU7q0y10F", offset: 50, anchorId: `c${String(49).padStart(21, "0")}` };
  const r = await who.call("POST", `/api/guilds/${GUILD_ID}/player/queue/more`, { ...state, count: 10 });
  assert.ok(at.collection.fired, "목록 불러오기에서 세션을 끝냈다");
  assert.deepEqual(outcome(r), ENDED);
});
