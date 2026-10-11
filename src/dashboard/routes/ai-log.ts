// AI 리퀘스트 로그 · 사용량 통계(/api/admin/ai/logs · /api/admin/ai/usage). 운영자만. 모양은 contract/ai-log.
// 목록은 최근 것부터 쪽으로(before 보다 작은 id), 원문은 펼칠 때 한 줄씩. 새 기록은 실시간 연결로 온다(dashboard/ai-log-stream).
// 통계는 기간(7 · 30 · 90일 · 전체) 안의 통계 줄을 셈한다(rules/ai-usage). 로그를 지워도 통계는 남는다.

import express, { type Request } from "express";
import config from "../../config/index.ts";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireOwner } from "../middleware/require-owner.ts";
import { signedIn } from "../middleware/require-auth.ts";
import { sendProblem } from "../problem.ts";
import { ranBy } from "../ran-by.ts";
import * as requests from "../../store/ai-requests.ts";
import * as aiLogStream from "../ai-log-stream.ts";
import { dayKey, firstDay, usageReport } from "../../rules/ai-usage.ts";
import { AI_LOG_PAGE, AI_USAGE_PERIODS, isAiLogSource, type AiLogEntry, type AiLogPage, type AiLogQuery, type AiLogStorage, type AiUsagePeriod, type AiUsageReport } from "../contract/ai-log.ts";

const aiLogRouter = express.Router();

/** 한 번에 받는 줄의 상한 */
const PAGE_MAX = 200;

/** 서버 이름(디스코드 캐시). 모르면 id */
function guildNameOf(req: Request) {
  const { client } = req.app.locals.bot;
  return (id: string) => client.guilds.cache.get(id)?.name ?? id;
}
const withGuildName = (nameOf: (id: string) => string) => (entry: AiLogEntry) => (entry.guildId ? { ...entry, guildName: nameOf(entry.guildId) } : entry);

function storage(): AiLogStorage {
  return { ...requests.size(), maxBytes: config.aiLog.maxBytes, enabled: config.aiLog.enabled };
}

const sourcesOf = (raw: unknown) =>
  String(raw ?? "")
    .split(",")
    .filter(isAiLogSource);

function queryOf(req: Request): AiLogQuery {
  const result = String(req.query.result ?? "");
  return { sources: sourcesOf(req.query.sources), result: result === "ok" || result === "failed" ? result : "", q: String(req.query.q ?? "").slice(0, 200) };
}

/** 받은 수 글. 정수가 아니면 null */
function intOf(raw: unknown): number | null {
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) ? n : null;
}

// 실시간 새 기록. 브라우저가 다시 붙을 때는 Last-Event-ID 를, 화면이 다시 열 때는 ?after= 를 싣는다(그 뒤의 줄부터 받는다)
aiLogRouter.get("/logs/stream", requireOwner, (req, res) => {
  const after = intOf(req.get("Last-Event-ID") ?? req.query.after) ?? 0;
  if (!aiLogStream.addClient(res, signedIn(req).id, after)) sendProblem(res, "too-many-streams");
});

aiLogRouter.get("/logs", requireOwner, (req, res) => {
  const limit = Math.min(Math.max(intOf(req.query.limit) ?? AI_LOG_PAGE, 1), PAGE_MAX);
  const before = intOf(req.query.before) ?? undefined;
  const page = requests.list(queryOf(req), { before, limit });
  res.json({ ...page, entries: page.entries.map(withGuildName(guildNameOf(req))), storage: storage() } satisfies AiLogPage);
});

aiLogRouter.get("/logs/:id", requireOwner, (req, res) => {
  const one = requests.one(Number(req.params.id));
  if (!one) return sendProblem(res, "ai-log-not-found");
  res.json(withGuildName(guildNameOf(req))(one));
});

aiLogRouter.delete("/logs", requireOwner, (req, res) => {
  const { count } = requests.size();
  requests.clearRequests();
  log.warn({ sub: "admin" }, `대시보드에서 AI 리퀘스트 로그 전체 삭제(${count}줄, 사용량 통계는 남김). 실행 ${ranBy(req)}`);
  res.json({ success: true });
});

aiLogRouter.get("/usage", requireOwner, (req, res) => {
  const asked = Number(req.query.period ?? 30);
  const period: AiUsagePeriod = (AI_USAGE_PERIODS as readonly number[]).includes(asked) ? (asked as AiUsagePeriod) : 30;
  const today = dayKey(Date.now());
  const from = firstDay(period, today, requests.earliestDay());
  const rows = requests.usageSince(from, sourcesOf(req.query.sources));
  res.json(usageReport(rows, { period, from, today, guildName: guildNameOf(req) }) satisfies AiUsageReport);
});

aiLogRouter.delete("/usage", requireOwner, (req, res) => {
  requests.clearUsage();
  log.warn({ sub: "admin" }, `대시보드에서 AI 사용량 통계 전체 삭제(리퀘스트 로그는 남김). 실행 ${ranBy(req)}`);
  res.json({ success: true });
});

export { aiLogRouter, withGuildName };
