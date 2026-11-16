// src/store/tunables.ts, dashboard/routes/tunables.ts: 운영 조절값(일반, 유튜브, 디스플레이 탭). settings.db 의 문서에 두고 .env 와 같은 검사로 읽는다.
// 저장하면 바로 먹고(기동 시 만든 것은 알림을 듣고 다시 만든다), 다시 시작해야 먹는 값은 기동 시 값으로 돈다. DB 에 틀린 값이 있어도 기동은 멈추지 않는다

process.env.OWNER_ID = "owner";

import fs from "node:fs";
import path from "node:path";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { signedInAs, requestJson, detailsOf } = await import("../helpers/dashboard.ts");
type ProblemReply = import("../helpers/dashboard.ts").ProblemReply;
const { openTempStore } = await import("../helpers/temp-store.ts");
const { default: config, loadConfig } = await import("../../src/config/index.ts");
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
// 테스트가 바꾼 설정 객체를 되돌린다(같은 프로세스의 다른 테스트가 기본값을 기대한다)
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
  assert.deepEqual(saved.json, { values: { QUEUE_MAX_TRACKS: "500", EMBED_COLOR: "#112233" }, revision: 1, pending: [] }, "빈 값은 기본값이라 남기지 않는다");
  assert.deepEqual([config.bot.maxQueueSize, config.bot.embedColor], [500, "#112233"]);
});

test("글 필드(음성 상태 접두어)는 앞뒤 공백을 남기고, 나머지 필드는 공백을 제거한다. 공백뿐이면 기본값", async () => {
  const { revision } = (await req<View>("GET")).json;
  const saved = await req<View>("PUT", { values: { VOICE_PLAYING_PREFIX: "📻 ", QUEUE_MAX_TRACKS: " 300 ", VOICE_PAUSED_PREFIX: "   " }, revision });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.values.VOICE_PLAYING_PREFIX, "📻 ");
  assert.equal(saved.json.values.QUEUE_MAX_TRACKS, "300");
  assert.equal(saved.json.values.VOICE_PAUSED_PREFIX, undefined);
  assert.equal(config.voiceStatus.playingPrefix, "📻 ");
});

test("다시 시작해야 먹는 값은 저장해도 기동 시 값으로 돌고 pending 으로 알린다", async () => {
  const saved = await req<View>("PUT", { values: { SPONSORBLOCK_ENABLED: "false", BGUTIL_ENABLED: "true", CACHE_MAX_FILES: "42", RATE_LIMIT_API_MAX: "999", INVITE_COMMAND_ENABLED: "false", WELCOME_MESSAGE_ENABLED: "false" }, revision: 0 });
  assert.deepEqual(saved.json.pending, ["BGUTIL_ENABLED"]);
  // 로그는 몇 개가 아니라 무엇이 어떻게 바뀌었는지
  const line = sink.buffer.findLast((e) => e.text.includes("운영 조절값 저장"))?.text ?? "";
  assert.match(line, /BGUTIL_ENABLED 기본값 → "true"\(다시 시작해야 적용\)/);
  assert.match(line, /CACHE_MAX_FILES 기본값 → "42"(?!\()/);
  assert.equal(config.bgutil.enabled, false, "실행하지 않은 POToken 서버를 찾지 않게");
  assert.deepEqual([config.sponsorblock.enabled, config.cache.maxFiles, config.dashboard.rateLimit.apiMax, config.bot.inviteCommand, config.bot.welcomeMessage], [false, 42, 999, false, false], "바로 먹는 값은 먹는다(SponsorBlock, /invite 는 저장할 때 명령 등록도 맞춘다, app/command-loader)");

  tunables.load(); // 다시 켰다
  assert.deepEqual([config.sponsorblock.enabled, config.bgutil.enabled], [false, true]);
  assert.deepEqual(tunables.view().pending, []);
});

// 기동 시 만들어 둔 제한기, 타이머는 이 알림을 듣고 다시 만든다. 듣는 쪽이 던져도 저장은 끝나고 로그에 남는다
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

test("틀린 값, 모르는 이름은 필드마다 까닭과 함께 거절하고 아무것도 바꾸지 않는다", async () => {
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

// DB 를 바깥에서 고쳤을 때. 고칠 대시보드가 실행돼야 하므로 기동을 멈추지 않는다
test("DB 에 틀린 값이 있으면 기동 시 그 필드만 기본값으로 돌고 알린다", () => {
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

// 도구 카드의 값(yt-dlp 의 채널, 모드, 고정)은 저장 막대의 저장이 건드리지 못한다. 고치는 것은 saveCard 뿐이다
test("저장 막대의 저장은 도구 카드의 값을 읽지 않고 저장된 값을 이어 쓴다(빠뜨려도, 다른 값을 보내도)", async () => {
  tunables.saveCard({ YTDLP_VERSION: "2026.08.19", YTDLP_UPDATE: "manual" });
  const { revision } = tunables.view();

  const omitted = await req<View>("PUT", { values: { QUEUE_MAX_TRACKS: "300" }, revision });
  assert.equal(omitted.status, 200);
  assert.deepEqual(omitted.json.values, { QUEUE_MAX_TRACKS: "300", YTDLP_UPDATE: "manual", YTDLP_VERSION: "2026.08.19" }, "값을 빼고 보내도 고정이 삭제되지 않는다");

  const changed = await req<View>("PUT", { values: { QUEUE_MAX_TRACKS: "300", YTDLP_VERSION: "2021.01.01", YTDLP_CHANNEL: "master", YTDLP_UPDATE: "" }, revision: omitted.json.revision });
  assert.equal(changed.status, 200);
  assert.deepEqual([changed.json.values.YTDLP_VERSION, changed.json.values.YTDLP_CHANNEL, changed.json.values.YTDLP_UPDATE], ["2026.08.19", undefined, "manual"]);
  assert.deepEqual([config.ytdlp.version, config.ytdlp.channel, config.ytdlp.update], ["2026.08.19", "nightly", "manual"]);
});

test("카드의 저장은 그 값만 바꾸고 바로 적용된다. 보던 값이 그사이 달라졌으면 CARD_CONFLICT", () => {
  docs.write("tunables", { QUEUE_MAX_TRACKS: "300" }, 0);
  tunables.load();
  const heard: string[] = [];
  const off = onTunablesChanged(() => heard.push(config.ytdlp.channel));
  try {
    const view = tunables.saveCard({ YTDLP_CHANNEL: "stable" }, { YTDLP_CHANNEL: "" });
    assert.deepEqual(view, { values: { QUEUE_MAX_TRACKS: "300", YTDLP_CHANNEL: "stable" }, revision: 2, pending: [] });
    assert.deepEqual(heard, ["stable"], "설정 객체를 고친 뒤에 알린다");

    assert.throws(
      () => tunables.saveCard({ YTDLP_CHANNEL: "master" }, { YTDLP_CHANNEL: "nightly" }),
      (error: { code?: string }) => error.code === "CARD_CONFLICT",
    );
    assert.equal(config.ytdlp.channel, "stable");

    // 빈 값, null 은 기본값으로 되돌린다
    assert.equal(tunables.saveCard({ YTDLP_CHANNEL: null }, { YTDLP_CHANNEL: "stable" }).values.YTDLP_CHANNEL, undefined);
    assert.equal(config.ytdlp.channel, "nightly");
  } finally {
    off();
  }
});

test("카드의 저장은 틀린 값을 거절하고, 카드 값이 아닌 이름은 받아들이지 않는다", () => {
  assert.throws(
    () => tunables.saveCard({ YTDLP_VERSION: "최신" }),
    (error: { code?: string; problems?: string[] }) => error.code === "CONFIG_INVALID" && /YTDLP_VERSION/.test(error.problems?.[0] ?? ""),
  );
  assert.throws(
    () => tunables.saveCard({ YTDLP_UPDATE: "notify" }),
    (error: { code?: string }) => error.code === "CONFIG_INVALID",
  );
  assert.throws(() => tunables.saveCard({ QUEUE_MAX_TRACKS: "1" }), /도구 카드의 값이 아님/);
  assert.equal(tunables.view().revision, 0);
});

// DB 를 바깥에서 고쳐 카드 값이 잘못돼 있어도 대시보드에서 다른 것은 고칠 수 있어야 한다
test("저장돼 있던 값이 잘못돼 있어도 상관없는 저장은 된다(그 조작이 고치는 값만 검사한다)", async () => {
  docs.write("tunables", { YTDLP_VERSION: "최신", CACHE_MAX_FILES: "많이" }, 0);
  tunables.load();
  const general = await req<View>("PUT", { values: { QUEUE_MAX_TRACKS: "300", CACHE_MAX_FILES: "100" }, revision: 1 });
  assert.equal(general.status, 200, "잘못된 카드 값이 저장 막대를 막지 않는다");
  assert.equal(general.json.values.YTDLP_VERSION, "최신", "잘못된 값은 그대로 둔다(고치는 것은 카드다)");

  docs.write("tunables", { YTDLP_VERSION: "최신", CACHE_MAX_FILES: "많이" }, general.json.revision);
  tunables.load();
  assert.equal(tunables.saveCard({ YTDLP_UPDATE: "manual" }).values.YTDLP_UPDATE, "manual", "잘못된 다른 값이 카드를 막지 않는다");
  assert.equal(tunables.saveCard({ YTDLP_VERSION: "2026.08.19" }).values.YTDLP_VERSION, "2026.08.19", "카드가 잘못된 값을 고친다");
});

test(".env 의 yt-dlp 버전 설정은 무시하고, 유튜브 탭에서 설정하라고 알린다", () => {
  const { config: loaded, warnings } = loadConfig({ YTDLP_CHANNEL: "stable", YTDLP_UPDATE: "off", YTDLP_VERSION: "2026.08.19" });
  assert.deepEqual([loaded.ytdlp.channel, loaded.ytdlp.update, loaded.ytdlp.version], ["nightly", "auto", null]);
  assert.ok(
    warnings.some((line) => /YTDLP_CHANNEL, YTDLP_UPDATE, YTDLP_VERSION는 이제 쓰지 않음\. 운영자 패널의 유튜브 탭/.test(line)),
    warnings.join("\n"),
  );
});

test("스크립트가 설정 DB 를 읽기 전용으로 읽을 때: strict 면 깨진 파일에서 던지고, 없는 파일은 어느 쪽이든 기본값", () => {
  const broken = path.join(store.dir, "깨진.db");
  fs.writeFileSync(broken, "SQLite 가 아닌 글자");
  tunables.loadReadOnly(broken);
  assert.equal(config.ytdlp.update, "auto", "strict 가 아니면 경고하고 기본값");
  assert.throws(() => tunables.loadReadOnly(broken, { strict: true }), /설정 DB 읽기 실패/);
  tunables.loadReadOnly(path.join(store.dir, "없는.db"), { strict: true });
  assert.equal(config.ytdlp.update, "auto");
});
