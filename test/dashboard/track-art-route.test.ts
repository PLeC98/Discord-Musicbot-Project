// 대시보드의 직접 링크 곡 그림: 상태(player-view)에 이 봇의 그림 주소를 싣고, 그 경로가 다시 구운 JPEG 을 준다.
// 그 서버의 지금 곡 · 대기열에서 찾은 그림만, 통신 없이(메모리 · 캐시 파일). 시료는 ffmpeg 로 만든다(없으면 건너뛴다)

process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const { openTempStore } = await import("../helpers/temp-store.ts");
const { createGuildsRouter } = await import("../../src/dashboard/routes/guilds.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const embeddedArt = await import("../../src/sources/embedded-art.ts");
const store = openTempStore("track-art-route-");
after(() => store.close());

import express from "express";
import type { Server } from "node:http";
import type { Player } from "../../src/player/player.ts";
import type { PlayerRead } from "../../src/dashboard/contract/player.ts";
import { fakePlayer, fakeBot } from "../helpers/fake.ts";
import { signedInAs, requestJson } from "../helpers/dashboard.ts";
import { audioKeyOf } from "../../src/rules/audio-key-of.ts";
import { spawnFfmpeg } from "../../src/media/ffmpeg/process.ts";

const GUILD_ID = "100";
const FILE = "https://files.test/art.mp3";
const OTHER = "https://files.test/other.mp3";
const YT_ART = "https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg";

const fileTrack = (url: string) => ({ title: "파일", artist: undefined, duration: 0, thumbnail: null, pageUrl: url, requestKey: url, audioUrl: url, platform: "direct", requestedBy: null });
const guild = {
  id: GUILD_ID,
  name: "TestGuild",
  roles: { cache: new Map() },
  channels: { cache: new Map() },
  members: { fetch: async (id: string) => ({ id, guild, permissions: { has: () => true }, voice: { channel: null }, roles: { cache: new Map() } }), me: null },
};
const client = { isReady: () => true, guilds: { cache: new Map([[GUILD_ID, guild]]) } };
const players = new Map<string, Player>();

let server: Server;
let base: string;
let ready = false;

function ffmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFfmpeg(["-hide_banner", "-loglevel", "error", ...args], "probe", { killOnStdoutClose: false });
    } catch {
      return resolve(false);
    }
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

before(async () => {
  const at = (name: string) => path.join(store.dir, name);
  ready = (await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=300x300:d=1", "-frames:v", "1", "-y", at("c.jpg")])) && (await ffmpeg(["-f", "lavfi", "-i", "sine=duration=2", "-i", at("c.jpg"), "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "copy", "-disposition:v", "attached_pic", "-y", at("a.mp3")]));
  if (ready) {
    const mp3 = fs.readFileSync(at("a.mp3"));
    await embeddedArt.readFromBody(audioKeyOf(FILE)!, FILE, Readable.from([mp3]));
    await embeddedArt.readFromBody(audioKeyOf(OTHER)!, OTHER, Readable.from([mp3]));
  }
  const app = express();
  app.use(signedInAs(() => ({ id: "owner", username: "owner", guilds: [] })));
  app.locals.bot = fakeBot({ client, players, panels: { updatePlaying: async () => {}, panelChannel: async () => null } });
  app.use("/api/guilds", createGuildsRouter({ stream: createPlayerStream() }));
  server = await listenForFetch(app);
  base = baseUrl(server);
  players.set(GUILD_ID, fakePlayer({ currentTrack: fileTrack(FILE), queue: [{ ...fileTrack("https://files.test/b.mp3"), thumbnail: YT_ART, audioUrl: undefined, platform: "youtube" }], previousTracks: [], getCurrentTime: () => 0, audioPlayer: { state: { status: "playing" } }, guild }));
});
after(() => server?.close());

test("상태: 직접 링크 곡은 이 봇의 그림 주소, 곡 그림이 있는 곡은 그 주소", async (t) => {
  if (!ready) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const { json } = await requestJson<PlayerRead>(base, "GET", `/api/guilds/${GUILD_ID}/player`, undefined, { timeoutMs: 3000 });
  const fingerprint = embeddedArt.artFor(fileTrack(FILE))!.fingerprint;
  assert.equal(json.currentTrack?.thumbnail, `/api/guilds/${GUILD_ID}/art/${fingerprint}.jpg`);
  assert.equal(json.queue[0].thumbnail, YT_ART);
});

test("그림 경로: 그 서버 곡의 그림만 JPEG 으로(오래 기억), 아니면 404", async (t) => {
  if (!ready) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const fingerprint = embeddedArt.artFor(fileTrack(FILE))!.fingerprint;
  const got = await fetch(`${base}/api/guilds/${GUILD_ID}/art/${fingerprint}.jpg`, { signal: AbortSignal.timeout(3000) });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/jpeg");
  assert.equal(got.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.equal(Buffer.compare(Buffer.from(await got.arrayBuffer()), (await embeddedArt.imageOf(fingerprint))!), 0);

  // 같은 그림이어도 그 서버의 곡이 아니면(지문은 같지만 다른 곡의 결과) 아니다: 대기열에 없는 곡의 지문
  embeddedArt.clear();
  await embeddedArt.readFromBody(audioKeyOf(OTHER)!, OTHER, Readable.from([fs.readFileSync(path.join(store.dir, "a.mp3"))]));
  const notHere = await fetch(`${base}/api/guilds/${GUILD_ID}/art/${fingerprint}.jpg`, { signal: AbortSignal.timeout(3000) });
  assert.equal(notHere.status, 404, "그 서버의 곡에서 찾은 그림이 아니다");
  for (const file of ["nope.jpg", `${fingerprint}.png`, "../x"]) {
    const bad = await fetch(`${base}/api/guilds/${GUILD_ID}/art/${file}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(bad.status, 404, file);
  }
});
