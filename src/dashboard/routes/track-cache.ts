// 캐시 DB(운영자 패널 "캐시 DB" 탭). /api/admin/track-cache. 모양은 contract/track-cache, 일은 dashboard/track-cache, track-cache-probe.
// 최근 로그인은 보지 않는다(비밀이 새는 일이 아니고, 삭제한 캐시는 다시 다운로드하면 된다).
// 재생 테스트는 yt-dlp 를 실행하므로 곡 추가와 같은 한도로 따로 센다.

import express, { type Request, type Response } from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import config from "../../config/index.ts";
import { requireOwner } from "../middleware/require-owner.ts";
import { sendProblem } from "../problem.ts";
import { limiter } from "../rate-limits.ts";
import { ranBy } from "../ran-by.ts";
import { parse, TrackCacheInspectBody, TrackCacheProbeBody, TrackCacheWriteBody } from "../request-schemas.ts";
import { messageOf } from "../../rules/error-kind.ts";
import * as trackCache from "../track-cache.ts";
import * as probes from "../track-cache-probe.ts";
import type { TrackCacheChecks, TrackCacheInspected, TrackCachePage, TrackCacheProbeQueued, TrackCacheRevision, TrackCacheWritten } from "../contract/track-cache.ts";
import { assertSignedIn, sessionEnded } from "../session-requests.ts";

const trackCacheRouter = express.Router();
trackCacheRouter.use(requireOwner);

const refuse = (res: Response, { code, params, errors }: trackCache.Refusal) => sendProblem(res, code, params, errors ? { errors } : undefined);
// URL 쿼리 그대로(같은 키가 여럿인지를 보려고 express 가 읽은 req.query 를 쓰지 않는다)
const searchOf = (req: Request) => new URL(req.originalUrl, "http://localhost").searchParams;

trackCacheRouter.get("/", async (req, res) => {
  const query = trackCache.queryOf(searchOf(req));
  if (!query.ok) return refuse(res, query);
  // 화면이 이 요청을 버리면(다시 읽기, 식 고침) 정규식 줄에서 뺀다. 응답을 다 보낸 뒤의 close 는 무시한다
  const cancel = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) cancel.abort();
  });
  const read = await trackCache.read(query.query, { signal: cancel.signal });
  if (!read || cancel.signal.aborted) return; // 버렸다(닫힌 연결에 답하지 않는다)
  if (!read.ok) return refuse(res, read);
  res.json(read.page satisfies TrackCachePage);
});

trackCacheRouter.post("/", async (req, res) => {
  const body = parse(TrackCacheWriteBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code, {}, { errors: body.errors });
  let written;
  try {
    written = await trackCache.write(body.value.ops, ranBy(req), () => assertSignedIn(req));
  } catch (error) {
    if (sessionEnded(res, error)) return;
    log.error({ sub: "admin" }, `캐시 DB 저장 실패: ${messageOf(error)}`);
    return sendProblem(res, "track-cache-write-failed", {}, { detail: messageOf(error) });
  }
  if (!written.ok) return refuse(res, written);
  res.json(written.written satisfies TrackCacheWritten);
});

trackCacheRouter.post("/inspect", (req, res) => {
  const body = parse(TrackCacheInspectBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code, {}, { errors: body.errors });
  res.json(trackCache.inspect(body.value) satisfies TrackCacheInspected);
});

trackCacheRouter.post(
  "/probe",
  limiter(() => config.dashboard.rateLimit.queueMax),
  (req, res) => {
    const body = parse(TrackCacheProbeBody, req.body ?? {});
    if (!body.ok) return sendProblem(res, body.code, {}, { errors: body.errors });
    const queued = probes.enqueue(body.value.audioUrls, ranBy(req));
    if (!queued.ok) return refuse(res, queued);
    res.json(queued.queued satisfies TrackCacheProbeQueued);
  },
);

trackCacheRouter.get("/revision", (_req, res) => res.json(probes.revision() satisfies TrackCacheRevision));

trackCacheRouter.get("/checks", (req, res) => {
  const keys = (searchOf(req).get("keys") ?? "").split(",").filter(Boolean);
  const read = probes.checks(keys);
  if (!read.ok) return refuse(res, read);
  res.json(read.checks satisfies TrackCacheChecks);
});

export { trackCacheRouter };
