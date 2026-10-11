// src/dashboard/routes/service-keys.ts · store/service-keys.ts — 바깥 서비스 키(운영자 패널의 API · 쿠키 탭).
// 운영자만, 넣기 · 지우기는 최근 로그인만. 값은 응답으로 나가지 않고 설정 객체에만 올라간다

process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Server } from "node:http";

const { requestJson } = await import("../helpers/dashboard.ts");
const { fake } = await import("../helpers/fake.ts");
const { openTempStore } = await import("../helpers/temp-store.ts");
const config = (await import("../../src/config/index.ts")).default;
const secrets = await import("../../src/store/secrets.ts");
const serviceKeys = await import("../../src/store/service-keys.ts");
const spotify = await import("../../src/sources/spotify.ts");
const { bodyLimit } = await import("../../src/dashboard/body-limit.ts");
const { serviceKeysRouter } = await import("../../src/dashboard/routes/service-keys.ts");

const SECRET = "spotify-secret-0123456789";
const store = openTempStore("service-keys-");
let session: { user: object | null; loginAt?: number } = { user: null };
let server: Server;
let base: string;
const saved = { spotify: { ...config.spotify }, sources: { ...config.sources } };

before(async () => {
  secrets._useKey(Buffer.alloc(32, 3).toString("base64"));
  const app = express();
  app.use(bodyLimit());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.session = fake<Request["session"]>({ ...session });
    next();
  });
  app.use("/api/admin/service-keys", serviceKeysRouter);
  server = await listenForFetch(app);
  base = baseUrl(server);
});

after(() => {
  server.close();
  spotify.useFetch(null);
  secrets._useKey();
  Object.assign(config.spotify, saved.spotify);
  Object.assign(config.sources, saved.sources);
  store.close();
});

beforeEach(() => {
  session = { user: { id: "owner", username: "owner" }, loginAt: Date.now() };
  store.settings().exec("DELETE FROM secrets");
  serviceKeys.load();
});

const req = <T>(method: string, path: string, body?: unknown) => requestJson<T>(base, method, `/api/admin/service-keys${path}`, body);
type View = Record<string, Record<string, { state: string; last4: string | null; updatedAt: number | null }>>;

test("운영자만 들어온다. 넣기 · 지우기는 로그인한 지 10분 안이어야 한다", async () => {
  session = { user: null };
  assert.equal((await req("GET", "")).status, 401);
  session = { user: { id: "u1" }, loginAt: Date.now() };
  assert.equal((await req("GET", "")).status, 403);

  session = { user: { id: "owner", username: "owner" }, loginAt: Date.now() - 11 * 60_000 };
  assert.equal((await req("GET", "")).status, 200, "보기는 묻지 않는다");
  const late = await req<{ code?: string }>("PUT", "/spotify", { values: { clientSecret: SECRET } });
  assert.deepEqual([late.status, late.json.code], [403, "reauth-required"]);
  assert.equal((await req<{ code?: string }>("DELETE", "/spotify")).json.code, "reauth-required");
  assert.equal(config.spotify.clientSecret, null, "거절한 저장은 남지 않는다");
});

test("넣으면 설정 객체에 올라가고 응답에는 끝 네 글자 · 바꾼 때만", async () => {
  const res = await req<View>("PUT", "/spotify", { values: { clientId: "client-id-abcdef", clientSecret: SECRET } });
  assert.equal(res.status, 200);
  assert.deepEqual([res.json.spotify.clientSecret.state, res.json.spotify.clientSecret.last4], ["ok", "6789"]);
  assert.equal(res.json.lastfm.apiKey.state, "none");
  assert.ok(!JSON.stringify(res.json).includes(SECRET.slice(0, -4)));
  assert.deepEqual([config.spotify.clientId, config.spotify.clientSecret], ["client-id-abcdef", SECRET]);

  // 한 칸만 바꾸면 다른 칸은 그대로
  await req("PUT", "/spotify", { values: { clientId: "client-id-other", clientSecret: "" } });
  assert.deepEqual([config.spotify.clientId, config.spotify.clientSecret], ["client-id-other", SECRET]);

  const cleared = await req<View>("DELETE", "/spotify");
  assert.equal(cleared.json.spotify.clientId.state, "none");
  assert.deepEqual([config.spotify.clientId, config.spotify.clientSecret], [null, null]);
});

test("모르는 서비스 · 칸, 넣을 값이 없으면 거절한다", async () => {
  assert.equal((await req("PUT", "/nope", { values: { token: "x" } })).status, 400);
  assert.equal((await req("PUT", "/lastfm", { values: { token: "x" } })).status, 400);
  assert.equal((await req("PUT", "/lastfm", { values: { apiKey: "  " } })).status, 400);
});

test("기동 때 꺼내 올린다. 다른 SECRETS_KEY 로 잠근 값은 올리지 않고 다시 넣으라고 보인다", async () => {
  await req("PUT", "/lastfm", { values: { apiKey: "lastfm-key-0123456789" } });
  config.sources.lastfmKey = null;
  serviceKeys.load();
  assert.equal(config.sources.lastfmKey, "lastfm-key-0123456789");

  secrets._useKey(Buffer.alloc(32, 4).toString("base64"));
  try {
    serviceKeys.load();
    assert.equal(config.sources.lastfmKey, null);
    assert.equal((await req<View>("GET", "")).json.lastfm.apiKey.state, "again");
  } finally {
    secrets._useKey(Buffer.alloc(32, 3).toString("base64"));
  }
});

test("연결 시험: 저장된 키로 그 서비스에만 묻는다. 없음 · 거절 · 성공", async () => {
  assert.deepEqual((await req("POST", "/spotify/test")).json, { ok: false, reason: "missing" });

  const sent: string[] = [];
  let status = 401;
  spotify.useFetch((async (url: string) => (sent.push(url), new Response("{}", { status }))) as unknown as typeof fetch);
  await req("PUT", "/spotify", { values: { clientId: "client-id-abcdef", clientSecret: SECRET } });
  assert.deepEqual((await req("POST", "/spotify/test")).json, { ok: false, reason: "rejected" });
  status = 200;
  assert.deepEqual((await req("POST", "/spotify/test")).json, { ok: true });
  assert.deepEqual(new Set(sent), new Set(["https://accounts.spotify.com/api/token"]));
});

test("Spotify 키를 바꾸면 옛 키로 받은 토큰을 버린다", async () => {
  let issued = 0;
  spotify.useFetch((async () => new Response(JSON.stringify({ access_token: `tok${++issued}`, expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch);
  const { official } = spotify._internals;
  official._token = null;
  await req("PUT", "/spotify", { values: { clientId: "client-id-abcdef", clientSecret: SECRET } });
  assert.equal(await official._accessToken(), "tok1");
  assert.equal(await official._accessToken(), "tok1", "같은 키면 쥔 토큰");
  await req("PUT", "/spotify", { values: { clientSecret: "another-secret-0123456789" } });
  assert.equal(await official._accessToken(), "tok2");
  official._token = null;
});
