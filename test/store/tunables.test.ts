// src/store/tunables.ts, dashboard/routes/tunables.ts: 운영 설정값(일반, 유튜브, 디스플레이 탭). settings.db의 문서에 두고 .env와 같은 검사로 읽는다.
// 저장하면 바로 적용되고(기동 시 만든 것은 알림을 듣고 다시 만든다), 다시 시작해야 적용되는 값은 기동 시 값으로 돈다. DB에 틀린 값이 있어도 기동은 멈추지 않는다

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
const rules = await import("../../src/rules/tunables.ts");
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

test("비어 있으면 기본값으로 돈다. 저장하면 바로 적용되고 저장 번호가 오른다", async () => {
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

test("다시 시작해야 적용되는 값은 저장해도 기동 시 값으로 돌고 pending으로 알린다", async () => {
  const saved = await req<View>("PUT", { values: { SPONSORBLOCK_ENABLED: "false", BGUTIL_ENABLED: "true", CACHE_MAX_FILES: "42", RATE_LIMIT_API_MAX: "999", INVITE_COMMAND_ENABLED: "false", WELCOME_MESSAGE_ENABLED: "false" }, revision: 0 });
  assert.deepEqual(saved.json.pending, ["BGUTIL_ENABLED"]);
  // 로그는 몇 개가 아니라 무엇이 어떻게 바뀌었는지
  const line = sink.buffer.findLast((e) => e.text.includes("운영 설정값 저장"))?.text ?? "";
  assert.match(line, /BGUTIL_ENABLED 기본값 → "true"\(다시 시작해야 적용\)/);
  assert.match(line, /CACHE_MAX_FILES 기본값 → "42"(?!\()/);
  assert.equal(config.bgutil.enabled, false, "실행하지 않은 POToken 서버를 찾지 않게");
  assert.deepEqual([config.sponsorblock.enabled, config.cache.maxFiles, config.dashboard.rateLimit.apiMax, config.bot.inviteCommand, config.bot.welcomeMessage], [false, 42, 999, false, false], "바로 적용되는 값은 적용된다(SponsorBlock, /invite는 저장할 때 명령 등록도 맞춘다, app/command-loader)");

  tunables.load(); // 다시 켰다
  assert.deepEqual([config.sponsorblock.enabled, config.bgutil.enabled], [false, true]);
  assert.deepEqual(tunables.view().pending, []);
});

// 기동 시 만들어 둔 제한기, 타이머는 이 알림을 듣고 다시 만든다. 듣는 쪽이 예외를 던져도 저장은 끝나고 로그에 남는다
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

test("틀린 값, 모르는 이름은 필드마다 원인과 함께 거절하고 아무것도 바꾸지 않는다", async () => {
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

// DB를 바깥에서 고쳤을 때. 고칠 대시보드가 실행돼야 하므로 기동을 멈추지 않는다
test("DB에 틀린 값이 있으면 기동 시 그 필드만 기본값으로 돌고 알린다", () => {
  docs.write("tunables", { CACHE_MAX_FILES: "많이", QUEUE_MAX_TRACKS: "300" }, 0);
  const from = sink.buffer.length;
  tunables.load();
  assert.deepEqual([config.cache.maxFiles, config.bot.maxQueueSize], [500, 300]);
  assert.ok(sink.buffer.slice(from).some((e) => e.level === "warn" && e.text.includes("CACHE_MAX_FILES")));
});

test("명령 배포 스크립트는 settings.db를 읽기 전용으로 본다. 파일이 없으면 기본값", () => {
  docs.write("tunables", { SPONSORBLOCK_ENABLED: "false" }, 0);
  store.settings().pragma("wal_checkpoint(TRUNCATE)");
  tunables.loadReadOnly(path.join(store.dir, "settings.db"));
  assert.equal(config.sponsorblock.enabled, false);
  tunables.loadReadOnly(path.join(store.dir, "없는.db"));
  assert.equal(config.sponsorblock.enabled, true);
});

// 도구 카드가 버튼으로 고치는 값(yt-dlp의 버전 고정)은 저장 바의 저장이 건드리지 못한다. 고치는 것은 saveCard 뿐이다
test("저장 바의 저장은 버전 고정을 읽지 않고 저장된 값을 이어 쓴다(빠뜨려도, 다른 값을 보내도)", async () => {
  docs.write("tunables", { YTDLP_VERSION: "2026.08.19", YTDLP_UPDATE: "manual" }, 0);
  tunables.load();
  const omitted = await req<View>("PUT", { values: { QUEUE_MAX_TRACKS: "300" }, revision: 1 });
  assert.equal(omitted.status, 200);
  assert.deepEqual(omitted.json.values, { QUEUE_MAX_TRACKS: "300", YTDLP_VERSION: "2026.08.19" }, "값을 빼고 보내도 고정이 삭제되지 않는다(자동 업데이트는 저장 바의 값이라 기본값으로)");

  const changed = await req<View>("PUT", { values: { YTDLP_VERSION: "2021.01.01", YTDLP_UPDATE: "manual" }, revision: omitted.json.revision });
  assert.equal(changed.status, 200);
  assert.deepEqual([changed.json.values.YTDLP_VERSION, changed.json.values.YTDLP_UPDATE], ["2026.08.19", "manual"]);
  assert.deepEqual([config.ytdlp.version, config.ytdlp.update], ["2026.08.19", "manual"]);
});

test("버전을 고정한 상태에서는 저장 바에서 채널을 바꾸지 못한다(lockedBy). 자동 업데이트는 바꾼다", async () => {
  tunables.saveCard({ YTDLP_VERSION: "2026.08.19" });
  const { revision } = tunables.view();
  const refused = await req<ProblemReply>("PUT", { values: { YTDLP_CHANNEL: "stable" }, revision });
  assert.deepEqual([refused.status, refused.json.code], [400, "config-invalid"]);
  assert.match(detailsOf(refused.json), /YTDLP_CHANNEL 값이 잘못됨\(stable\): YTDLP_VERSION이 있는 동안 바꿀 수 없음/);
  assert.equal((await req<View>("PUT", { values: { YTDLP_UPDATE: "manual" }, revision })).status, 200);

  tunables.saveCard({ YTDLP_VERSION: null });
  assert.equal((await req<View>("PUT", { values: { YTDLP_CHANNEL: "stable" }, revision: tunables.view().revision })).status, 200, "고정을 풀면 바꾼다");
  assert.equal(config.ytdlp.channel, "stable");
});

test("카드의 저장은 그 값만 바꾸고 바로 적용된다. 보던 값이 그사이 달라졌으면 CARD_CONFLICT", () => {
  docs.write("tunables", { QUEUE_MAX_TRACKS: "300" }, 0);
  tunables.load();
  const heard: Array<string | null> = [];
  const off = onTunablesChanged(() => heard.push(config.ytdlp.version));
  try {
    const view = tunables.saveCard({ YTDLP_VERSION: "2026.08.19" }, { YTDLP_VERSION: "" });
    assert.deepEqual(view, { values: { QUEUE_MAX_TRACKS: "300", YTDLP_VERSION: "2026.08.19" }, revision: 2, pending: [] });
    assert.deepEqual(heard, ["2026.08.19"], "설정 객체를 고친 뒤에 알린다");

    assert.throws(
      () => tunables.saveCard({ YTDLP_VERSION: "2026.09.01" }, { YTDLP_VERSION: "" }),
      (error: { code?: string }) => error.code === "CARD_CONFLICT",
    );
    assert.equal(config.ytdlp.version, "2026.08.19");

    // 빈 값, null은 기본값으로 되돌린다
    assert.equal(tunables.saveCard({ YTDLP_VERSION: null }, { YTDLP_VERSION: "2026.08.19" }).values.YTDLP_VERSION, undefined);
    assert.equal(config.ytdlp.version, null);

    // 카드 값과 함께라면 그 값이 잠그는 채널도 바꾼다(다른 채널에서 다운로드한 이전 버전으로 되돌리기)
    assert.equal(tunables.saveCard({ YTDLP_VERSION: "2026.08.19", YTDLP_CHANNEL: "stable" }).values.YTDLP_CHANNEL, "stable");
  } finally {
    off();
  }
});

test("카드의 저장은 틀린 값을 거절하고, 카드 값이 아닌 이름은 받아들이지 않는다", () => {
  assert.throws(
    () => tunables.saveCard({ YTDLP_VERSION: "최신" }),
    (error: { code?: string; problems?: Array<{ params?: { key?: string } }> }) => error.code === "CONFIG_INVALID" && error.problems?.[0]?.params?.key === "YTDLP_VERSION",
  );
  assert.throws(() => tunables.saveCard({ YTDLP_UPDATE: "manual" }), /도구 카드의 값이 아님/);
  assert.throws(() => tunables.saveCard({ YTDLP_CHANNEL: "stable" }), /도구 카드의 값이 아님/, "고정과 함께가 아니면 채널은 저장 바에서");
  assert.throws(() => tunables.saveCard({ QUEUE_MAX_TRACKS: "1" }), /도구 카드의 값이 아님/);
  assert.equal(tunables.view().revision, 0);
});

// DB를 바깥에서 고쳐 카드 값이 잘못돼 있어도 대시보드에서 다른 것은 고칠 수 있어야 한다
test("저장돼 있던 값이 잘못돼 있어도 상관없는 저장은 된다(그 조작이 고치는 값만 검사한다)", async () => {
  docs.write("tunables", { YTDLP_VERSION: "최신", CACHE_MAX_FILES: "많이" }, 0);
  tunables.load();
  const general = await req<View>("PUT", { values: { QUEUE_MAX_TRACKS: "300", CACHE_MAX_FILES: "100" }, revision: 1 });
  assert.equal(general.status, 200, "잘못된 카드 값이 저장 바를 막지 않는다");
  assert.equal(general.json.values.YTDLP_VERSION, "최신", "잘못된 값은 그대로 둔다(고치는 것은 카드다)");

  docs.write("tunables", { YTDLP_VERSION: "최신", CACHE_MAX_FILES: "많이" }, general.json.revision);
  tunables.load();
  assert.equal(tunables.saveCard({ YTDLP_VERSION: "2026.08.19" }).values.YTDLP_VERSION, "2026.08.19", "잘못된 다른 값이 카드를 막지 않고, 카드가 잘못된 값을 고친다");
});

test(".env의 yt-dlp 버전 설정은 무시하고, 업데이트 탭에서 설정하라고 알린다", () => {
  const { config: loaded, warnings } = loadConfig({ YTDLP_CHANNEL: "stable", YTDLP_UPDATE: "off", YTDLP_VERSION: "2026.08.19" });
  assert.deepEqual([loaded.ytdlp.channel, loaded.ytdlp.update, loaded.ytdlp.version], ["nightly", "auto", null]);
  assert.ok(
    warnings.some((line) => /YTDLP_CHANNEL, YTDLP_UPDATE, YTDLP_VERSION은 이제 쓰지 않음\. 운영자 패널의 업데이트 탭/.test(line)),
    warnings.join("\n"),
  );
});

test("스크립트가 설정 DB를 읽기 전용으로 읽을 때: strict면 깨진 파일에서 예외를 던지고, 없는 파일은 어느 쪽이든 기본값", () => {
  const broken = path.join(store.dir, "깨진.db");
  fs.writeFileSync(broken, "SQLite가 아닌 글자");
  tunables.loadReadOnly(broken);
  assert.equal(config.ytdlp.update, "auto", "strict가 아니면 경고하고 기본값");
  assert.throws(() => tunables.loadReadOnly(broken, { strict: true }), /설정 DB 읽기 실패/);
  tunables.loadReadOnly(path.join(store.dir, "없는.db"), { strict: true });
  assert.equal(config.ytdlp.update, "auto");
});

// ── 저장할 때 덮어쓰는 영역 ──

/** 두 설정에서 값이 다른 경로(일반 객체는 안쪽까지 비교한다) */
function differences(a: unknown, b: unknown, at = ""): string[] {
  const plain = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
  if (plain(a) && plain(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) => differences(a[key], b[key], at ? `${at}.${key}` : key));
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [at];
}

// 운영 설정값마다 기본값과 다른 허용 값 후보
const CANDIDATES: Record<string, (def: string, min?: number, max?: number) => string[]> = {
  bool: (def) => [def === "true" ? "false" : "true"],
  int: (def, min, max) => [String(Number(def) + 1), String(Number(def) - 1), String(min ?? 0), String(max ?? 1)],
  text: () => ["x"],
  color: () => ["#123456"],
  url: () => ["https://example.com"],
  list: () => ["web,mweb"],
  cookies: () => ["file", "chrome"],
  categories: () => ["sponsor", "intro"],
  token: () => ["stable", "nightly", "master", "off", "auto", "2025.01.01", "1.0.0"],
  language: () => ["qps-ploc"],
};

test("운영 설정값이 바꾸는 설정 필드는 모두 저장할 때 덮어쓰는 영역(TUNED_SECTIONS) 안에 있다", () => {
  const { TUNABLES } = rules;
  const base = loadConfig(process.env, { tunables: {} }).config;
  const outside: string[] = [];
  const untested: string[] = [];
  for (const one of TUNABLES) {
    const found = CANDIDATES[one.kind](one.def, one.min, one.max)
      .map((value) => loadConfig(process.env, { tunables: { [one.key]: value } }))
      .find((next) => next.tuneProblems.length === 0 && differences(base, next.config).length > 0);
    if (!found) {
      untested.push(one.key);
      continue;
    }
    for (const path of differences(base, found.config)) if (!tunables.TUNED_SECTIONS.some((section) => path === section || path.startsWith(`${section}.`))) outside.push(`${one.key} → ${path}`);
  }
  assert.deepEqual(outside, []);
  assert.deepEqual(
    untested.filter((key) => ["bool", "int"].includes(rules.tunable(key).kind)),
    [],
    "켜고 끄는 값, 수는 모두 바꿔 볼 수 있다",
  );
});

test("저장하면 IP 위치 DB, 봇 기본 언어도 바로 적용된다", async () => {
  const saved = await req<View>("PUT", { values: { GEOIP_ENABLED: "false", BOT_LANGUAGE: "qps-ploc" }, revision: 0 });
  assert.equal(saved.status, 200);
  assert.deepEqual([config.geoip.enabled, config.i18n.botLanguage], [false, "qps-ploc"]);
});

test("제거된 운영 설정값은 예전 내보내기 파일에 있어도 모르는 이름으로 거부하지 않는다", () => {
  assert.deepEqual(tunables.problemsOf({ TEST_LANGUAGE_ENABLED: "true" }), []);
  assert.deepEqual(
    tunables.problemsOf({ NO_SUCH_TUNABLE: "1" }).map((one) => one.code),
    ["tune-unknown-key"],
  );
});

test("DB에 남은 제거된 운영 설정값은 기동 때 경고 없이 무시하고, 화면에 내려주지 않고, 다음에 저장할 때 지운다", async () => {
  docs.write("tunables", { TEST_LANGUAGE_ENABLED: "true", QUEUE_MAX_TRACKS: "300" }, 0);
  const from = sink.buffer.length;
  tunables.load();
  assert.equal(config.bot.maxQueueSize, 300);
  assert.ok(!sink.buffer.slice(from).some((e) => e.text.includes("TEST_LANGUAGE_ENABLED")));

  const view = await req<View>("GET");
  assert.deepEqual(view.json.values, { QUEUE_MAX_TRACKS: "300" });
  const saved = await req<View>("PUT", { values: view.json.values, revision: view.json.revision });
  assert.equal(saved.status, 200);
  assert.deepEqual(docs.read("tunables").data, { QUEUE_MAX_TRACKS: "300" });
});
