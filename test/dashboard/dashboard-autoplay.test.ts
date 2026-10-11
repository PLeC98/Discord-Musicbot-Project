// src/dashboard/routes/player.ts — 대시보드의 자동재생: 장르 목록, 켜기 · 바꾸기 · 끄기(판정과 일은 디스코드의 장르 메뉴와 같다)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { useDefaultDocuments } from "../helpers/config-docs.ts";
import { fakeBot, fakePlayer } from "../helpers/fake.ts";
import { signedInAs, requestJson } from "../helpers/dashboard.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";
import type { AutoplayGenres, PlayerState } from "../../src/dashboard/contract/player.ts";
import type { Player } from "../../src/player/player.ts";

useDefaultDocuments();
const genreConfig = await import("../../src/config/genres.ts");
const { createGuildsRouter } = await import("../../src/dashboard/routes/guilds.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");

const GUILD_ID = "100";
// 그 서버의 모더레이터(재적 · DJ 판정을 건너뛴다). 봇은 음성 채널에 있다
const guild = {
  id: GUILD_ID,
  name: "서버",
  roles: { cache: new Map() },
  channels: { cache: new Map() },
  voiceStates: { cache: new Map() },
  members: {
    me: { voice: { channel: { id: "vc" } } },
    fetch: async (id: string) => ({ id, guild, permissions: { has: () => true }, voice: { channel: null }, roles: { cache: new Map() } }),
  },
};
const players = new Map<string, Player>();
const announced: unknown[] = [];
const panels = { panelChannel: async () => ({ isSendable: () => true, send: async (view: unknown) => (announced.push(view), { delete: async () => {} }) }), updatePlaying: async () => {} };

// 곡을 틀고 있는 플레이어. 자동재생 장르만 들고 있다
function playingPlayer() {
  return fakePlayer({
    autoplay: false as string | false,
    setAutoplay(genre: string | false) {
      this.autoplay = genre;
    },
    currentTrack: { title: "곡", artist: "가수", duration: 200, thumbnail: null, pageUrl: "u", platform: "youtube", requestedBy: null },
    queue: [],
    previousTracks: [],
    volume: 50,
    loop: false,
    audioPlayer: { state: { status: "playing" } },
    getCurrentTime: () => 0,
    guild,
  });
}

const app = express();
app.use(express.json());
app.use(signedInAs(() => ({ id: "u1", username: "사용자" })));
app.locals.bot = fakeBot({ client: { isReady: () => true, guilds: { cache: new Map([[GUILD_ID, guild]]) } }, players, panels });
app.use("/api/guilds", createGuildsRouter({ stream: createPlayerStream() }));
const server = await listenForFetch(app);
after(() => server.close());
const req = <T>(method: string, path: string, body?: unknown) => requestJson<T>(baseUrl(server), method, path, body);

test("장르 목록: 설정 파일의 차례로 이름 · 이모지(디스코드 장르 메뉴와 같은 것)", async () => {
  const { status, json } = await req<AutoplayGenres>("GET", `/api/guilds/${GUILD_ID}/autoplay/genres`);
  assert.equal(status, 200);
  const { genres } = genreConfig.genres();
  assert.deepEqual(
    json.genres,
    Object.entries(genres).map(([id, g]) => ({ id, label: g.label?.trim() || id, emoji: g.emoji || null })),
  );
});

test("켜기 · 바꾸기 · 끄기: 지금 장르가 상태에 실리고, 켠 결과는 패널 채널에도 알린다", async () => {
  const player = playingPlayer();
  players.set(GUILD_ID, player);
  const [first, second] = Object.keys(genreConfig.genres().genres);
  announced.length = 0;

  const on = await req<PlayerState>("POST", `/api/guilds/${GUILD_ID}/player/autoplay`, { genre: first });
  assert.equal(on.status, 200);
  assert.deepEqual([on.json.autoplay, on.json.autoplayGenre], [true, first]);
  assert.equal(announced.length, 1, "켠 결과를 알린다");

  const changed = await req<PlayerState>("POST", `/api/guilds/${GUILD_ID}/player/autoplay`, { genre: second });
  assert.equal(changed.json.autoplayGenre, second);

  const off = await req<PlayerState>("POST", `/api/guilds/${GUILD_ID}/player/autoplay`, { genre: null });
  assert.deepEqual([off.json.autoplay, off.json.autoplayGenre], [false, null]);
  assert.equal(announced.length, 2, "끈 것은 알리지 않는다(디스코드도 본인에게만)");
  players.clear();
});

test("거절: 모르는 장르는 unknown-genre, 장르가 글자 · null 이 아니면 bad-request", async () => {
  players.set(GUILD_ID, playingPlayer());
  const unknown = await req<{ code: string }>("POST", `/api/guilds/${GUILD_ID}/player/autoplay`, { genre: "없는 장르" });
  assert.deepEqual([unknown.status, unknown.json.code], [400, "unknown-genre"]);
  for (const body of [{}, { genre: 3 }, { genre: "" }]) {
    const bad = await req<{ code: string }>("POST", `/api/guilds/${GUILD_ID}/player/autoplay`, body);
    assert.deepEqual([bad.status, bad.json.code], [400, "bad-request"], JSON.stringify(body));
  }
  players.clear();
});

test("플레이어가 없는데 끄면 no-song", async () => {
  players.clear();
  const r = await req<{ code: string }>("POST", `/api/guilds/${GUILD_ID}/player/autoplay`, { genre: null });
  assert.deepEqual([r.status, r.json.code], [409, "no-song"]);
});
