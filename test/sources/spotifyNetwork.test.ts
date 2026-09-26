// Spotify 의 공식 API 경로와 익명 GraphQL 경로가 네트워크와 무엇을 주고받는지 고정한다(구조 리팩터링 0-B).
//
// 2a 가 URL 지식을 떼어 내고, 3 이 트랙 칸을 바꾸고, 5 가 익명 상태를 저장하는 곳을 옮긴다. fetch 만 가짜로 두고
// 토큰 발급 · 재사용 · 상태 추출 · 저장 · 재시도를 적어 둔다. 익명 상태는 진짜 저장소(externalCaches, 임시 DB)에 남는다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as storeDb from "../../src/store/db.ts";
import { fake } from "../helpers/fake.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "spotify-net-"));
const audioCache = await import("../../src/store/audioCache.ts");
const externalCaches = await import("../../src/store/externalCaches.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
audioCache.initialize(path.join(TMP, "cache.db"));

const config = (await import("../../config.ts")).default;
const Spotify = await import("../../src/sources/spotify.ts");
const { graphql, deriveKey, totp } = Spotify._internals;

const savedCreds = { ...config.spotify };
// 보낸 요청. 여기서 보는 칸만
type Init = { method?: string; headers?: Record<string, string>; body?: string };
const requests: Array<{ url: string; init: Init }> = [];

// Response 는 Set-Cookie 를 걸러 내므로 필요한 것만 가진 가짜를 쓴다
const reply = (body: unknown, { status = 200, cookies = [] as string[] } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { getSetCookie: () => cookies },
  json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
// 요청 하나에 답하는 길. 모르는 요청이면 undefined
type Route = (url: string, init: Init) => ReturnType<typeof reply> | undefined;
let routes: Route[] = [];

// 가짜 응답은 스포티파이 모듈이 읽는 칸만 가진다
Spotify.useFetch(
  fake<typeof fetch>(async (url: string | URL, init: Init = {}) => {
    requests.push({ url: String(url), init });
    for (const route of routes) {
      const r = route(String(url), init);
      if (r) return r;
    }
    throw new Error(`시험이 정하지 않은 요청: ${url}`);
  }),
);

after(() => {
  Spotify.useFetch(null);
  Object.assign(config.spotify, savedCreds);
  audioCache.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => {
  requests.length = 0;
  routes = [];
  Spotify._reset();
  storeDb.get().exec("DELETE FROM spotify_anon;");
  Object.assign(config.spotify, { clientId: "cid", clientSecret: "csecret" });
});

const apiTrack = (id: string, name: string) => ({
  id,
  name,
  artists: [{ name: "가수" }],
  duration_ms: 201500,
  album: {
    name: "앨범",
    images: [
      { url: "https://i.scdn.co/small", height: 64 },
      { url: "https://i.scdn.co/big", height: 640 },
    ],
  },
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
});

const tokenRoute: Route = (url) => (url === "https://accounts.spotify.com/api/token" ? reply({ access_token: "T1", expires_in: 3600 }) : undefined);

// ── 공식 API ──────────────────────────────────────────────────────────

test("공식 API: 토큰을 한 번 받아 재사용하고, 곡을 표준 모양으로 바꾼다", async () => {
  routes = [tokenRoute, (url) => (url.startsWith("https://api.spotify.com/v1/tracks/") ? reply(apiTrack(url.split("/").pop() ?? "", "곡")) : undefined)];

  const [a] = await Spotify.getFromURL("https://open.spotify.com/track/aaa111");
  await Spotify.getFromURL("https://open.spotify.com/track/bbb222");

  const tokenCalls = requests.filter((r) => r.url.includes("accounts.spotify.com"));
  assert.equal(tokenCalls.length, 1, "토큰은 만료 전까지 재사용");
  assert.equal(tokenCalls[0].init.method, "POST");
  assert.equal(tokenCalls[0]?.init.headers?.Authorization, `Basic ${Buffer.from("cid:csecret").toString("base64")}`);
  assert.equal(tokenCalls[0].init.body, "grant_type=client_credentials");
  const trackCall = requests.find((r) => r.url.endsWith("/tracks/aaa111"));
  assert.equal(trackCall?.init.headers?.Authorization, "Bearer T1");
  assert.deepEqual(a, { title: "곡", artist: "가수", album: "앨범", pageUrl: "https://open.spotify.com/track/aaa111", requestKey: "https://open.spotify.com/track/aaa111", duration: 201, thumbnail: "https://i.scdn.co/big", platform: "spotify", type: "track", id: "aaa111" });
});

test("검색: 공식 API 의 search 를 부르고, 실패하면 빈 배열", async () => {
  routes = [tokenRoute, (url) => (url.includes("/v1/search?") ? reply({ tracks: { items: [apiTrack("c1", "하나"), apiTrack("c2", "둘")] } }) : undefined)];

  const found = await Spotify.search("가수 곡", 1);

  const call = requests.find((r) => r.url.includes("/v1/search?"));
  assert.equal(call?.url, `https://api.spotify.com/v1/search?q=${encodeURIComponent("가수 곡")}&type=track&limit=1`);
  assert.deepEqual(
    found.map((t) => t.title),
    ["하나"],
  );

  routes = [tokenRoute, () => reply({}, { status: 500 })];
  assert.deepEqual(await Spotify.search("아무거나"), []);
});

test("검색에 스포티파이 주소를 주면 그 곡을 받는다", async () => {
  routes = [tokenRoute, (url) => (url.endsWith("/tracks/d1") ? reply(apiTrack("d1", "주소 곡")) : undefined)];
  const [t] = await Spotify.search("https://open.spotify.com/track/d1");
  assert.equal(t.title, "주소 곡");
});

test("자격증명이 없으면 곡 주소는 빈 결과(던지지 않는다)", async () => {
  Object.assign(config.spotify, { clientId: null, clientSecret: null });
  assert.deepEqual(await Spotify.getFromURL("https://open.spotify.com/track/e1"), []);
  assert.equal(requests.length, 0);
});

test("가수 인기곡: 공식 API 가 실패하면 익명 GraphQL 로 넘어간다", async () => {
  // GraphQL 질의는 가짜로 넘긴다(익명 토큰 · 상태는 아래 시험들이 본다)
  const query = async (op: string, _hash: string, vars: Record<string, unknown>) => {
    assert.equal(op, "queryArtistOverview");
    assert.equal(vars.uri, "spotify:artist:ar1");
    return { artistUnion: { discography: { topTracks: { items: [{ track: { uri: "spotify:track:g1", name: "인기곡", artists: { items: [{ profile: { name: "가수" } }] }, duration: { totalMilliseconds: 90000 } } }] } } } };
  };
  routes = [tokenRoute, () => reply({}, { status: 503 })];
  const list = await Spotify.getCollection("https://open.spotify.com/artist/ar1", undefined, { query });
  assert.deepEqual(
    list.tracks.map((t) => [t.title, t.pageUrl, t.duration]),
    [["인기곡", "https://open.spotify.com/track/g1", 90]],
  );
});

test("모르는 주소는 요청 없이 빈 결과", async () => {
  assert.deepEqual(await Spotify.getCollection("https://open.spotify.com/show/x"), { tracks: [], total: null, nextOffset: null });
  assert.equal(requests.length, 0);
});

// ── 익명 GraphQL: 상태 · 토큰 · 질의 ───────────────────────────────────

const HOME = `<script id="appServerConfig" type="text">${Buffer.from(JSON.stringify({ clientVersion: "9.9.9" })).toString("base64")}</script><script src="https://open.spotifycdn.com/cdn/build/web-player/web-player.abc123.js"></script>`;
const BUNDLE = `x={secret:'s3cr\\'et',version:12};"fetchPlaylist","query","${"a".repeat(64)}";"queryArtistOverview","query","${"b".repeat(64)}"`;

const anonRoutes = ({ tokenStatus = [200] } = {}): Route[] => {
  let mint = 0;
  return [
    (url) => (url === "https://open.spotify.com/" ? reply(HOME, { cookies: ["sp_t=abc; Path=/", "sp_landing=x; Path=/"] }) : undefined),
    (url) => (url.includes("web-player.abc123.js") ? reply(BUNDLE) : undefined),
    (url) => (url === "https://open.spotify.com/api/server-time" ? reply({ serverTime: 1700000000 }) : undefined),
    (url) => {
      if (!url.startsWith("https://open.spotify.com/api/token?")) return undefined;
      const status = tokenStatus[Math.min(mint++, tokenStatus.length - 1)];
      return status === 200 ? reply({ accessToken: `A${mint}`, accessTokenExpirationTimestampMs: Date.now() + 3600000 }) : reply({}, { status });
    },
  ];
};

test("익명 상태: 홈 · 번들에서 판 · secret · 해시를 뽑아 DB 에 남기고, 다음에는 메모리에서", async () => {
  routes = anonRoutes();

  const state = await graphql._ensureState(false);

  assert.equal(state.clientVersion, "9.9.9");
  assert.deepEqual(state.secrets, [{ secret: "s3cr'et", version: 12 }]);
  assert.equal(state.hashes.fetchPlaylist, "a".repeat(64));
  assert.equal(state.hashes.queryArtistOverview, "b".repeat(64));
  const saved = externalCaches.getSpotifyAnonState();
  assert.equal(saved?.clientVersion, "9.9.9");

  const before = requests.length;
  await graphql._ensureState(false);
  assert.equal(requests.length, before, "12시간 안에는 다시 안 받는다");

  Spotify._reset(); // 프로세스를 다시 띄운 것처럼
  await graphql._ensureState(false);
  assert.equal(requests.length, before, "프로세스를 다시 띄워도 DB 에 남은 것이 새것이면 그것을 쓴다");
});

const down = (): Route[] => [
  () => {
    throw new Error("네트워크 끊김");
  },
];

test("익명 상태: 뽑기가 실패하면 저장값, 그것도 없으면 던진다(코드에 박힌 값으로 돌지 않는다)", async () => {
  routes = down();
  await assert.rejects(graphql._ensureState(true), /익명 상태를 얻지 못했습니다: 네트워크 끊김/);
  assert.equal(externalCaches.getSpotifyAnonState(), null);

  routes = anonRoutes();
  await graphql._ensureState(false);
  Spotify._reset(); // 프로세스를 다시 띄운 것처럼. 저장값은 DB 에만
  routes = down();
  const state = await graphql._ensureState(true);
  assert.deepEqual(state.secrets, [{ secret: "s3cr'et", version: 12 }], "DB 에 남은 값");
});

test("익명 상태: 홈 · 번들이 오류이거나 secret 이 없으면 뽑기 실패다. 저장값을 새것으로 덮지 않는다", async () => {
  routes = [() => reply("", { status: 500 })];
  await assert.rejects(graphql._ensureState(true), /홈 500/);
  assert.equal(externalCaches.getSpotifyAnonState(), null, "실패를 새 값으로 적지 않는다");

  const home = (url: string) => (url === "https://open.spotify.com/" ? reply(HOME) : undefined);
  routes = [home, (url) => (url.includes("web-player") ? reply("", { status: 404 }) : undefined)];
  await assert.rejects(graphql._ensureState(true), /번들 404/);
  routes = [home, (url) => (url.includes("web-player") ? reply("아무것도 없는 번들") : undefined)];
  await assert.rejects(graphql._ensureState(true), /secret 을 찾지 못했습니다/);
  routes = [() => reply("<html>번들 주소 없음</html>")];
  await assert.rejects(graphql._ensureState(true), /번들 주소가 없습니다/);

  routes = anonRoutes();
  const fresh = await graphql._ensureState(true);
  routes = [() => reply("", { status: 500 })];
  const kept = await graphql._ensureState(true);
  assert.equal(kept.fetchedAt, fresh.fetchedAt, "저장값을 그대로 쓴다(새것으로 치지 않는다)");
});

test("익명 상태: 뽑기에 실패하면 한동안 다시 뽑지 않는다. 토큰 · 해시 오류의 강제 뽑기는 예외", async () => {
  routes = anonRoutes();
  await graphql._ensureState(false);
  if (graphql._state) graphql._state.fetchedAt = 0; // 낡았다

  routes = down();
  await graphql._ensureState(false);
  const afterFail = requests.length;
  await graphql._ensureState(false);
  assert.equal(requests.length, afterFail, "쉬는 동안은 저장값으로");
  await graphql._ensureState(true);
  assert.equal(requests.length, afterFail + 1, "강제 뽑기는 쉬지 않는다");
});

test("익명 상태: 번들에서 못 찾은 해시는 직전 값을 두고, 아예 없으면 그 질의만 실패한다", async () => {
  routes = anonRoutes();
  await graphql._ensureState(false);

  const onlyPlaylist = `x={secret:'s3cr\\'et',version:12};"fetchPlaylist","query","${"c".repeat(64)}"`;
  const withBundle = (bundle: string): Route[] => [(url) => (url === "https://open.spotify.com/" ? reply(HOME) : undefined), (url) => (url.includes("web-player") ? reply(bundle) : undefined)];
  routes = withBundle(onlyPlaylist);
  const next = await graphql._ensureState(true);
  assert.equal(next.hashes.fetchPlaylist, "c".repeat(64), "찾은 것은 새 값");
  assert.equal(next.hashes.queryArtistOverview, "b".repeat(64), "못 찾은 것은 직전 값");

  Spotify._reset();
  storeDb.get().exec("DELETE FROM spotify_anon;");
  routes = [...withBundle(onlyPlaylist), ...anonRoutes().slice(2)];
  await assert.rejects(graphql._query("queryArtistOverview", "queryArtistOverview", {}), /queryArtistOverview 해시가 없습니다/);
});

test("익명 토큰: 홈의 쿠키와 서버 시각으로 TOTP 를 만들어 받고, 만료 전까지 재사용", async () => {
  routes = anonRoutes();

  const tok = await graphql._token();
  await graphql._token();

  assert.equal(tok, "A1");
  const mints = requests.filter((r) => r.url.startsWith("https://open.spotify.com/api/token?"));
  assert.equal(mints.length, 1);
  const qs = new URL(mints[0].url).searchParams;
  const key = deriveKey("s3cr'et");
  assert.equal(qs.get("totpVer"), "12");
  assert.equal(qs.get("totpServer"), totp(key, 1700000000 * 1000));
  assert.equal(qs.get("reason"), "init");
  assert.equal(mints[0]?.init.headers?.Cookie, "sp_t=abc; sp_landing=x");
  assert.equal(mints[0]?.init.headers?.["App-Platform"], "WebPlayer");
});

test("익명 토큰: 400 · 403 이면 secret 을 다시 뽑아 한 번 더", async () => {
  routes = anonRoutes({ tokenStatus: [403, 200] });

  assert.equal(await graphql._token(), "A2");
  const bundles = requests.filter((r) => r.url.includes("web-player.abc123.js"));
  assert.equal(bundles.length, 2, "처음 한 번 + 다시 뽑기 한 번");
});

test("익명 토큰: 그 밖의 실패는 그대로 던진다", async () => {
  routes = anonRoutes({ tokenStatus: [500] });
  await assert.rejects(graphql._token(), /익명 토큰 500/);
});

test("GraphQL 질의: 파트너 머리와 저장된 해시로 보낸다. 해시가 만료됐으면 다시 뽑아 한 번 더", async () => {
  let attempts = 0;
  routes = [
    ...anonRoutes(),
    (url, init) => {
      if (url !== "https://api-partner.spotify.com/pathfinder/v2/query") return undefined;
      attempts += 1;
      return attempts === 1 ? reply({ errors: [{ message: "PersistedQueryNotFound" }] }) : reply({ data: { ok: JSON.parse(init.body ?? "{}").operationName } });
    },
  ];

  const data = await graphql._query("fetchPlaylist", "fetchPlaylist", { uri: "spotify:playlist:p" });

  assert.deepEqual(data, { ok: "fetchPlaylist" });
  const q = requests.filter((r) => r.url.includes("api-partner"));
  assert.equal(q.length, 2);
  const body = JSON.parse(q[0]?.init.body ?? "{}");
  assert.equal(body.extensions.persistedQuery.sha256Hash, "a".repeat(64));
  assert.deepEqual(body.variables, { uri: "spotify:playlist:p" });
  assert.equal(q[0]?.init.headers?.Authorization, "Bearer A1");
  assert.equal(q[0]?.init.headers?.["Spotify-App-Version"], "9.9.9");
});

test("GraphQL 질의: 다른 오류와 JSON 이 아닌 응답은 던진다", async () => {
  routes = [...anonRoutes(), (url) => (url.includes("api-partner") ? reply({ errors: [{ message: "Forbidden" }] }) : undefined)];
  await assert.rejects(graphql._query("fetchPlaylist", "fetchPlaylist", {}), /Forbidden/);

  graphql._anonToken = null;
  routes = [...anonRoutes(), (url) => (url.includes("api-partner") ? reply("<html>", { status: 502 }) : undefined)];
  await assert.rejects(graphql._query("fetchPlaylist", "fetchPlaylist", {}), /GraphQL 응답 파싱 실패 502/);
});
