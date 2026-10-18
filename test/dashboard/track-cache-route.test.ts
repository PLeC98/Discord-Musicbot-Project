// src/dashboard/routes/track-cache.ts — 캐시 DB 경로. 운영자만, 문제는 RFC 9457 모양(필드는 pointer), 답은 계약의 모양.

process.env.OWNER_ID = "owner";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { fake } = await import("../helpers/fake.ts");
const { openTempStore } = await import("../helpers/temp-store.ts");
const { trackCacheRouter } = await import("../../src/dashboard/routes/track-cache.ts");
const { bodyLimit } = await import("../../src/dashboard/body-limit.ts");
const probes = await import("../../src/dashboard/track-cache-probe.ts");
const pinnedSources = await import("../../src/store/pinned-sources.ts");

const store = openTempStore("track-cache-route-");
let user = "owner";
const app = express();
app.use(bodyLimit());
app.use((req, _res, next) => {
  req.session = fake<typeof req.session>({ user: { id: user, username: user }, loginAt: Date.now() });
  next();
});
app.use("/api/admin/track-cache", trackCacheRouter);
const server = await listenForFetch(app);
const base = `${baseUrl(server)}/api/admin/track-cache`;
probes._setProbe(async () => ({ ok: true }));
after(() => {
  server.close();
  probes._setProbe();
  store.close();
});

type Json = Record<string, unknown> & { code?: string; errors?: Array<{ pointer: string; code: string }> };
const call = async (method: string, route: string, body?: unknown) => {
  const res = await fetch(base + route, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Json };
};

const SPOTIFY = "https://open.spotify.com/track/1111111111111111111111";
const SC = "https://soundcloud.com/artist/song";

test("읽기: 표 하나의 구간과 번호, 질의가 틀리면 그 위치를 가리킨다", async () => {
  pinnedSources.setPin(SPOTIFY, SC, 10);
  const page = await call("GET", "/?table=requests&offset=0&limit=50&f.audioUrl=soundcloud&sort=pinnedAt:desc");
  assert.equal(page.status, 200);
  assert.deepEqual([page.json.table, page.json.total, page.json.matched, typeof page.json.revision, typeof page.json.checkRevision], ["requests", 1, 1, "number", "number"]);

  const bad = await call("GET", "/?table=requests&f.size=>abc");
  assert.deepEqual([bad.status, bad.json.code, bad.json.errors], [400, "bad-filter", [{ pointer: "/filters/size", code: "bad-filter" }]]);
  assert.equal((await call("GET", "/?table=nope")).status, 400);
});

test("쓰기: 모양이 틀리면 조작 번호와 필드를 가리켜 400, 맞으면 조작마다 결과", async () => {
  const shape = await call("POST", "/", {
    ops: [
      { op: "unpin", requestKey: SPOTIFY, expect: SC },
      { op: "deleteFile", audioKey: "yt:x", expect: "어제" },
    ],
  });
  assert.deepEqual([shape.status, shape.json.code, shape.json.errors?.[0]?.pointer], [400, "bad-request", "/ops/1/expect"]);
  assert.equal(pinnedSources.getPin(SPOTIFY)?.audioUrl, SC, "하나라도 틀리면 아무것도 쓰지 않는다");

  const value = await call("POST", "/", { ops: [{ op: "pin", requestKey: SPOTIFY, audioUrl: SPOTIFY, expect: SC }] });
  assert.deepEqual([value.status, value.json.code, value.json.errors], [422, "not-audio-source", [{ pointer: "/ops/0/audioUrl", code: "not-audio-source" }]]);

  const written = await call("POST", "/", {
    ops: [
      { op: "unpin", requestKey: SPOTIFY, expect: SC },
      { op: "unpin", requestKey: SPOTIFY, expect: SC },
    ],
  });
  assert.equal(written.status, 200);
  assert.deepEqual(written.json.results, [{ ok: true }, { ok: false, code: "gone" }]);
  assert.equal(typeof written.json.revision, "number");
});

test("쓰기 본문은 조작 200개를 싣는다(32kb 를 넘는다)", async () => {
  const ops = Array.from({ length: 200 }, (_, i) => ({ op: "unpin", requestKey: `https://open.spotify.com/track/${String(i).padStart(22, "0")}`, expect: `https://soundcloud.com/some-artist-name/a-fairly-long-track-name-${"x".repeat(100)}-${i}` }));
  assert.ok(JSON.stringify({ ops }).length > 32 * 1024);
  const res = await call("POST", "/", { ops });
  assert.equal(res.status, 200);
  assert.equal((res.json.results as unknown[]).length, 200);
});

test("값 검사 미리 보기 · 재생 테스트 · 번호 · 결과", async () => {
  const inspected = await call("POST", "/inspect", { audioUrl: "https://youtu.be/ddddddddddd" });
  assert.deepEqual(inspected.json, { audio: { ok: true, canonical: "https://www.youtube.com/watch?v=ddddddddddd", kind: "youtube", audioKey: "yt:ddddddddddd" } });

  const queued = await call("POST", "/probe", { audioUrls: [SC] });
  assert.deepEqual([queued.status, queued.json.queued, queued.json.keys], [200, 1, ["sc:artist/song"]]);
  await probes._idle();
  const revision = await call("GET", "/revision");
  assert.deepEqual(revision.json.checking, []);
  const checks = await call("GET", "/checks?keys=sc:artist/song,yt:none");
  assert.deepEqual(Object.keys(checks.json.checks as object), ["sc:artist/song"]);
  assert.equal(checks.json.checkRevision, revision.json.checkRevision);

  assert.equal((await call("POST", "/probe", { audioUrls: "하나" })).status, 400);
});

test("운영자가 아니면 막는다", async () => {
  user = "someone";
  try {
    assert.equal((await call("GET", "/revision")).status, 403);
    assert.equal((await call("POST", "/", { ops: [] })).status, 403);
  } finally {
    user = "owner";
  }
});
