// src/dashboard/routes/ai-log.ts · ai-log-stream.ts — AI 리퀘스트 로그 목록 · 한 줄 · 지우기 · 사용량 통계 · 실시간 연결

process.env.OWNER_ID = "owner";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AiLogDetail, AiLogPage, AiLogPushed, AiUsageReport } from "../../src/dashboard/contract/ai-log.ts";
import type { NewRecord } from "../../src/store/ai-requests.ts";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { fake } = await import("../helpers/fake.ts");
const { openTempStore } = await import("../helpers/temp-store.ts");
const requests = await import("../../src/store/ai-requests.ts");
const aiLogStream = await import("../../src/dashboard/ai-log-stream.ts");
const { aiLogRouter, withGuildName } = await import("../../src/dashboard/routes/ai-log.ts");
type Page = AiLogPage;
type Report = AiUsageReport;
type Detail = AiLogDetail;

const store = openTempStore("ai-log-route-");
const guilds = new Map([["900", { name: "음악 감상실" }]]);
const app = express();
app.use(express.json());
app.locals.bot = fake({ client: { guilds: { cache: guilds } } });
app.use((req, _res, next) => {
  req.session = fake<typeof req.session>({ user: { id: "owner", username: "owner" }, loginAt: Date.now() });
  next();
});
app.use("/api/admin/ai", aiLogRouter);
aiLogStream.start(withGuildName((id) => guilds.get(id)?.name ?? id));
const server = await listenForFetch(app);
const base = `${baseUrl(server)}/api/admin/ai`;
after(() => {
  aiLogStream.stop();
  server.close();
  store.close();
});

const add = (patch: Partial<NewRecord> = {}) =>
  requests.record({ at: Date.now(), source: "autoplay", provider: "openai", model: "gpt-x", name: "GPT X", url: "https://api.openai.com/v1/chat/completions", method: "POST", status: 200, ok: true, aborted: false, tookMs: 800, firstMs: 500, attempt: 1, guildId: "900", genre: "rock", candidates: 6, tokens: { input: 900, output: 90, cached: 0, reasoning: 0 }, costUsd: 0.001, requestHeaders: "{}", requestBody: "{}", response: '{"ok":1}', ...patch }, { maxBytes: 64 * 1024 * 1024 });
const get = async <T>(route: string) => {
  const res = await fetch(base + route);
  return { status: res.status, json: (await res.json()) as T };
};

test("목록: 서버 이름을 붙이고, 거르기 · 쪽 넘기기 · 저장 상태를 준다", async () => {
  requests.clearRequests();
  add();
  add({ source: "models", model: "", name: "", guildId: undefined, ok: false, status: 503, error: "HTTP 503" });
  const all = await get<Page>("/logs?limit=1");
  assert.equal(all.status, 200);
  assert.equal(all.json.entries.length, 1);
  assert.deepEqual([all.json.total, all.json.matched], [2, 2]);
  assert.equal(all.json.storage.enabled, true);
  const failed = await get<Page>("/logs?result=failed&sources=models,nope");
  assert.deepEqual([failed.json.matched, failed.json.entries[0].error], [1, "HTTP 503"]);
  const older = await get<Page>(`/logs?before=${all.json.entries[0].id}`);
  assert.equal(older.json.entries[0].guildName, "음악 감상실");
});

test("한 줄: 원문까지, 없는 줄은 404", async () => {
  requests.clearRequests();
  const entry = add();
  const one = await get<Detail>(`/logs/${entry.id}`);
  assert.deepEqual([one.status, one.json.response, one.json.guildName], [200, '{"ok":1}', "음악 감상실"]);
  const missing = await get<{ code: string }>("/logs/999999");
  assert.deepEqual([missing.status, missing.json.code], [404, "ai-log-not-found"]);
});

test("로그를 지워도 통계는 남는다. 통계: 기간 · 출처 · 서버 이름", async () => {
  requests.clearRequests();
  requests.clearUsage();
  add();
  add({ source: "judge-test", guildId: undefined });
  assert.equal((await fetch(`${base}/logs`, { method: "DELETE" })).status, 200);
  assert.equal(requests.size().count, 0);
  const report = await get<Report>("/usage?period=7&sources=autoplay");
  assert.equal(report.json.period, 7);
  assert.equal(report.json.daily.length, 7);
  assert.equal(report.json.total.requests, 1);
  assert.deepEqual(
    report.json.byGuild.map((one) => one.guildName),
    ["음악 감상실"],
  );
  // 모르는 기간은 30일
  assert.equal((await get<Report>("/usage?period=5")).json.period, 30);
  assert.equal((await fetch(`${base}/usage`, { method: "DELETE" })).status, 200);
  assert.equal((await get<Report>("/usage?period=0")).json.total.requests, 0);
});

test("실시간 연결: 새 기록을 서버 이름과 저장 상태를 붙여 보내고, 다시 붙으면 놓친 줄부터 보낸다", async () => {
  requests.clearRequests();
  const missed = add();
  const controller = new AbortController();
  const res = await fetch(`${base}/logs/stream?after=${missed.id - 1}`, { signal: controller.signal });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const until = async (pattern: RegExp) => {
    while (!pattern.test(text)) text += decoder.decode((await reader.read()).value, { stream: true });
  };
  await until(new RegExp(`id: ${missed.id}\\n`));
  const fresh = add({ genre: "jazz" });
  await until(new RegExp(`id: ${fresh.id}\\n`));
  const frame = text.split("\n\n").find((one) => one.startsWith(`id: ${fresh.id}`))!;
  const pushed = JSON.parse(frame.split("data: ")[1]) as AiLogPushed;
  assert.deepEqual([pushed.entry.genre, pushed.entry.guildName, pushed.total], ["jazz", "음악 감상실", 2]);
  controller.abort();
});
