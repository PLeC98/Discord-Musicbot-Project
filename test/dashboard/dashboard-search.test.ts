// src/dashboard/routes/player.ts 의 곡 추가 칸 검색(GET /player/search): 문(플레이어, 재적 규칙), 검색어 검사, 결과 모양, "대기열" 배지, 실패 코드.
// 실 라우터 + 가짜 서버, 플레이어. 검색은 app.locals.findSongs 로 가짜를 넘긴다

process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import type { Player } from "../../src/player/player.ts";
import type { SearchReply } from "../../src/dashboard/contract/player.ts";
import type { Song, SongResults } from "../../src/usecases/song-search.ts";
import { codedError } from "../../src/rules/error-kind.ts";
import { fakePlayer, fakeBot } from "../helpers/fake.ts";
import { signedInAs, requestJson } from "../helpers/dashboard.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const { createGuildsRouter } = await import("../../src/dashboard/routes/guilds.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const store = openTempStore("dashboard-search-");
after(() => store.close());

const GUILD_ID = "100";
const yt = (id: string, extra: object = {}): Song => ({ title: `곡 ${id}`, artist: "가수", duration: 200, thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, platform: "youtube", id, pageUrl: `https://www.youtube.com/watch?v=${id}`, requestKey: `https://www.youtube.com/watch?v=${id}`, audioUrl: `https://www.youtube.com/watch?v=${id}`, isLive: false, liveStatus: null, ...extra });
const sp: Song = { title: "스포티파이 곡", artist: "가수", album: "앨범", duration: 180, thumbnail: null, platform: "spotify", pageUrl: "https://open.spotify.com/track/abc", requestKey: "https://open.spotify.com/track/abc" };

// 그 서버의 멤버. 기본은 모더레이터(재적 규칙을 건너뛴다). sameVoice 가 거짓이면 봇과 다른 음성 채널의 일반 멤버
let moderator = true;
const guild = {
  id: GUILD_ID,
  name: "TestGuild",
  roles: { cache: new Map() },
  channels: { cache: new Map() },
  members: {
    fetch: async (id: string) => ({ id, guild, permissions: { has: () => moderator }, voice: { channel: moderator ? null : { id: "other" } }, roles: { cache: new Map() } }),
    me: { voice: { channel: { id: "bot-voice" } } },
  },
};
const client = { isReady: () => true, guilds: { cache: new Map([[GUILD_ID, guild]]) } };
const bot = fakeBot({ client, players: new Map<string, Player>(), panels: { panelChannel: async (): Promise<unknown> => null } });

function makePlayer(queue: object[] = []) {
  return fakePlayer({ currentTrack: null, queue, previousTracks: [], volume: 50, loop: false, pause: { userPaused: false, heldBy: null }, audioPlayer: { state: { status: "idle" } }, getCurrentTime: () => 0 });
}

// 가짜 검색: 받은 검색어를 적고 정해 둔 답(또는 던질 것)을 준다
const searched: string[] = [];
let answer: () => Promise<SongResults> = async () => ({ songs: [], gated: false });

let server: Server;
let base: string;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use(signedInAs(() => ({ id: "owner", username: "owner" })));
  app.locals.bot = bot;
  app.locals.findSongs = async (q: string) => {
    searched.push(q);
    return await answer();
  };
  app.use("/api/guilds", createGuildsRouter({ stream: createPlayerStream() }));
  server = await listenForFetch(app);
  base = baseUrl(server);
});
after(() => server.close());

const get = (q: string) => requestJson<SearchReply & { code?: string; status?: number }>(base, "GET", `/api/guilds/${GUILD_ID}/player/search?${q}`, undefined, { timeoutMs: 3000 });
function fresh(queue: object[] = []) {
  bot.players.set(GUILD_ID, makePlayer(queue) as unknown as Player);
  searched.length = 0;
  moderator = true;
  answer = async () => ({ songs: [], gated: false });
}

test("검색: 플레이어가 없으면 bot-not-in-voice, 봇과 다른 음성 채널이면 must-be-in-same-voice(찾지 않는다)", async () => {
  fresh();
  bot.players.delete(GUILD_ID);
  assert.equal((await get("q=아이유")).json.code, "bot-not-in-voice");
  fresh();
  moderator = false;
  const r = await get("q=아이유");
  assert.equal(r.json.code, "must-be-in-same-voice");
  assert.deepEqual(searched, []);
});

test("검색: 검색어 검사. 빈 것, 100자 넘음, 여럿이면 400 bad-query. 두 글자 미만은 찾지 않고 빈 결과. 제어문자는 공백으로", async () => {
  fresh();
  for (const q of ["q=", "q=%20%20", `q=${encodeURIComponent("가".repeat(101))}`, "q=a&q=b", ""]) {
    const r = await get(q);
    assert.equal(r.status, 400, q);
    assert.equal(r.json.code, "bad-query", q);
  }
  const short = await get("q=a");
  assert.deepEqual([short.status, short.json], [200, { tracks: [], gated: false }]);
  await get(`q=${encodeURIComponent("아이\n유")}`);
  assert.deepEqual(searched, ["아이 유"], "두 글자 미만은 검색 모듈까지 가지 않는다");
});

test("검색: 결과 모양. 정본 주소, 그림, 방송 중, 시작 전 방송, 스포티파이 곡. 지금 곡이나 대기열에 있는 곡은 inQueue(세 주소 중 무엇이든)", async () => {
  // 대기열: 고정한 곡(pageUrl 이 입력 그대로, requestKey 는 정본), 출처가 있는 자동재생 곡(유튜브 영상은 audioUrl 에만)
  fresh([
    { title: "고정", pageUrl: "https://youtu.be/pinned?si=x", requestKey: "https://www.youtube.com/watch?v=pinned", audioUrl: null },
    { title: "자동재생", pageUrl: "https://www.last.fm/music/x", requestKey: "lastfm:x", audioUrl: "https://youtu.be/auto" },
  ]);
  answer = async () => ({ songs: [yt("pinned"), yt("auto"), yt("new", { isLive: true, liveStatus: "is_live", duration: 0 }), yt("soon", { isLive: true, liveStatus: "is_upcoming", duration: 0 }), sp], gated: false });
  const r = await get("q=아이유");
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.json.tracks.map((t) => [t.url, t.inQueue, t.isLive, t.upcoming, t.platform]),
    [
      ["https://www.youtube.com/watch?v=pinned", true, false, false, "youtube"],
      ["https://www.youtube.com/watch?v=auto", true, false, false, "youtube"],
      ["https://www.youtube.com/watch?v=new", false, true, false, "youtube"],
      ["https://www.youtube.com/watch?v=soon", false, true, true, "youtube"],
      ["https://open.spotify.com/track/abc", false, false, false, "spotify"],
    ],
  );
  assert.deepEqual(r.json.tracks[0], { title: "곡 pinned", artist: "가수", duration: 200, thumbnail: "https://i.ytimg.com/vi/pinned/mqdefault.jpg", platform: "youtube", url: "https://www.youtube.com/watch?v=pinned", isLive: false, upcoming: false, inQueue: true });
  assert.equal(r.json.gated, false);
});

test("검색: 연령 인증 안내만 왔으면 gated", async () => {
  fresh();
  answer = async () => ({ songs: [], gated: true });
  assert.deepEqual((await get("q=연령")).json, { tracks: [], gated: true });
});

test("검색: 실패는 그 까닭의 코드로(요청 제한 503, 연결 오류 502, 코드 없는 오류 500 unknown-error)", async () => {
  fresh();
  for (const [error, code, status] of [
    [codedError("rate-limited", "429"), "rate-limited", 503],
    [codedError("network-error", "fetch failed"), "network-error", 502],
    [new Error("parse"), "unknown-error", 500],
  ] as const) {
    answer = async () => {
      throw error;
    };
    const r = await get("q=아이유");
    assert.deepEqual([r.status, r.json.code], [status, code], code);
  }
});
