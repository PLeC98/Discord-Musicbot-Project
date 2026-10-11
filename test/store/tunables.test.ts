// src/store/tunables.ts · dashboard/routes/tunables.ts — 운영 조절값(일반 · 유튜브 · 디스플레이 탭). settings.db 의 문서에 두고 .env 와 같은 검사로 읽는다.
// 저장하면 바로 먹고(기동 때 만든 것은 알림을 듣고 다시 만든다), 다시 켜야 먹는 값은 기동 때 값으로 돈다. DB 에 틀린 값이 있어도 기동은 멈추지 않는다

process.env.OWNER_ID = "owner";

import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { signedInAs, requestJson, detailsOf } = await import("../helpers/dashboard.ts");
type ProblemReply = import("../helpers/dashboard.ts").ProblemReply;
const { openTempStore } = await import("../helpers/temp-store.ts");
const config = (await import("../../src/config/index.ts")).default;
const tunables = await import("../../src/store/tunables.ts");
const docs = await import("../../src/store/settings-docs.ts");
const { bodyLimit } = await import("../../src/dashboard/body-limit.ts");
const { tunablesRouter } = await import("../../src/dashboard/routes/tunables.ts");
const sink = (await import("../../src/infra/log/sink.ts")).default;
const { onTunablesChanged } = await import("../../src/config/tunables-changed.ts");

const store = openTempStore("tunables-");
const app = express();
app.use(bodyLimit());
app.use(signedInAs(() => ({ id: "owner", username: "owner" })));
app.use("/api/admin/tunables", tunablesRouter);
const server = await listenForFetch(app);
const base = baseUrl(server);
// 시험이 바꾼 설정 객체를 되돌린다(같은 프로세스의 다른 시험이 기본값을 기대한다)
after(() => {
  store.settings().exec("DELETE FROM documents");
  tunables.load();
  server.close();
  store.close();
});
beforeEach(() => {
  store.settings().exec("DELETE FROM documents");
  tunables.load();
});

type View = { values: Record<string, string>; revision: number; pending: string[] };
const req = <T>(method: string, body?: unknown) => requestJson<T>(base, method, "/api/admin/tunables", body);

test("비어 있으면 기본값으로 돈다. 저장하면 바로 먹고 저장 번호가 오른다", async () => {
  assert.deepEqual((await req<View>("GET")).json, { values: {}, revision: 0, pending: [] });
  assert.equal(config.bot.maxQueueSize, 250);

  const saved = await req<View>("PUT", { values: { QUEUE_MAX_TRACKS: "500", EMBED_COLOR: "#112233", WEBSITE: "" }, revision: 0 });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json, { values: { QUEUE_MAX_TRACKS: "500", EMBED_COLOR: "#112233" }, revision: 1, pending: [] }, "빈 칸은 기본값이라 남기지 않는다");
  assert.deepEqual([config.bot.maxQueueSize, config.bot.embedColor], [500, "#112233"]);
});

test("글 칸(음성 상태 머리말)은 앞뒤 공백을 남기고, 나머지 칸은 걷는다. 공백뿐이면 기본값", async () => {
  const { revision } = (await req<View>("GET")).json;
  const saved = await req<View>("PUT", { values: { VOICE_PLAYING_PREFIX: "📻 ", QUEUE_MAX_TRACKS: " 300 ", VOICE_PAUSED_PREFIX: "   " }, revision });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.values.VOICE_PLAYING_PREFIX, "📻 ");
  assert.equal(saved.json.values.QUEUE_MAX_TRACKS, "300");
  assert.equal(saved.json.values.VOICE_PAUSED_PREFIX, undefined);
  assert.equal(config.voiceStatus.playingPrefix, "📻 ");
});

test("다시 켜야 먹는 값은 저장해도 기동 때 값으로 돌고 pending 으로 알린다", async () => {
  const saved = await req<View>("PUT", { values: { SPONSORBLOCK_ENABLED: "false", BGUTIL_ENABLED: "true", CACHE_MAX_FILES: "42", RATE_LIMIT_API_MAX: "999" }, revision: 0 });
  assert.deepEqual(saved.json.pending.sort(), ["BGUTIL_ENABLED", "SPONSORBLOCK_ENABLED"]);
  // 로그는 몇 칸이 아니라 무엇이 어떻게 바뀌었는지
  const line = sink.buffer.findLast((e) => e.text.includes("운영 조절값 저장"))?.text ?? "";
  assert.match(line, /BGUTIL_ENABLED 기본값 → "true"\(다시 시작해야 적용\)/);
  assert.match(line, /CACHE_MAX_FILES 기본값 → "42"(?!\()/);
  assert.equal(config.bgutil.enabled, false, "띄우지 않은 POToken 서버를 찾지 않게");
  assert.equal(config.sponsorblock.enabled, true, "등록된 슬래시 명령과 어긋나지 않게");
  assert.deepEqual([config.cache.maxFiles, config.dashboard.rateLimit.apiMax], [42, 999], "바로 먹는 값은 먹는다");

  tunables.load(); // 다시 켰다
  assert.deepEqual([config.sponsorblock.enabled, config.bgutil.enabled], [false, true]);
  assert.deepEqual(tunables.view().pending, []);
});

// 기동 때 만들어 둔 제한기 · 타이머는 이 알림을 듣고 다시 만든다. 듣는 쪽이 던져도 저장은 끝나고 로그에 남는다
test("저장하면 바뀌었다고 알리고, 듣는 쪽의 실패는 저장을 막지 않는다", async () => {
  const heard: number[] = [];
  const offHeard = onTunablesChanged(() => heard.push(config.dashboard.sse.heartbeatMs));
  const offBroken = onTunablesChanged(() => {
    throw new Error("고장");
  });
  try {
    const from = sink.buffer.length;
    const saved = await req<View>("PUT", { values: { SSE_HEARTBEAT_SEC: "45" }, revision: 0 });
    assert.equal(saved.status, 200);
    assert.deepEqual(heard, [45000], "설정 객체를 고친 뒤에 알린다");
    assert.ok(sink.buffer.slice(from).some((e) => e.level === "error" && e.text.includes("고장")));
  } finally {
    offHeard();
    offBroken();
  }
});

test("틀린 값 · 모르는 이름은 칸마다 까닭과 함께 거절하고 아무것도 바꾸지 않는다", async () => {
  const res = await req<ProblemReply>("PUT", { values: { CACHE_MAX_FILES: "abc", YTDLP_PLAYER_CLIENTS: "web;x", NOPE: "1" }, revision: 0 });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, "config-invalid");
  const said = detailsOf(res.json);
  for (const word of ["CACHE_MAX_FILES", "YTDLP_PLAYER_CLIENTS", "NOPE"]) assert.match(said, new RegExp(word));
  assert.equal(tunables.view().revision, 0);
});

test("읽은 뒤 다른 저장이 있었으면 config-changed(409)", async () => {
  await req("PUT", { values: { CACHE_MAX_FILES: "100" }, revision: 0 });
  const late = await req<{ code?: string }>("PUT", { values: { CACHE_MAX_FILES: "200" }, revision: 0 });
  assert.deepEqual([late.status, late.json.code], [409, "config-changed"]);
  assert.equal(config.cache.maxFiles, 100);
});

// DB 를 바깥에서 고쳤을 때. 고칠 대시보드가 떠야 하므로 기동을 멈추지 않는다
test("DB 에 틀린 값이 있으면 기동 때 그 칸만 기본값으로 돌고 알린다", () => {
  docs.write("tunables", { CACHE_MAX_FILES: "많이", QUEUE_MAX_TRACKS: "300" }, 0);
  const from = sink.buffer.length;
  tunables.load();
  assert.deepEqual([config.cache.maxFiles, config.bot.maxQueueSize], [500, 300]);
  assert.ok(sink.buffer.slice(from).some((e) => e.level === "warn" && e.text.includes("CACHE_MAX_FILES")));
});

test("명령 배포 스크립트는 settings.db 를 읽기 전용으로 본다. 파일이 없으면 기본값", () => {
  docs.write("tunables", { SPONSORBLOCK_ENABLED: "false" }, 0);
  store.settings().pragma("wal_checkpoint(TRUNCATE)");
  tunables.loadReadOnly(path.join(store.dir, "settings.db"));
  assert.equal(config.sponsorblock.enabled, false);
  tunables.loadReadOnly(path.join(store.dir, "없는.db"));
  assert.equal(config.sponsorblock.enabled, true);
});
