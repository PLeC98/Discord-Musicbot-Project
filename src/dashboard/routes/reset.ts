// 초기화(운영자 패널 백업 · 초기화 탭의 초기화 카드). /api/admin/reset. 모양은 contract/reset, 일은 dashboard/reset.
// 여러 항목을 되돌릴 수 없이 한꺼번에 지우므로 모두 최근 로그인을 본다. 봇 전체 초기화는 봇 이름을 그대로 입력해야 받는다.

import express, { type Request } from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireOwner } from "../middleware/require-owner.ts";
import { requireRecentLogin } from "../middleware/recent-login.ts";
import { sendProblem } from "../problem.ts";
import { ranBy } from "../ran-by.ts";
import { parse, ResetBody } from "../request-schemas.ts";
import { messageOf } from "../../rules/error-kind.ts";
import * as reset from "../reset.ts";
import * as fullReset from "../../store/full-reset.ts";
import type { ResetDone, ResetOverview } from "../contract/reset.ts";

const resetRouter = express.Router();
resetRouter.use(requireOwner, requireRecentLogin);

// 대시보드가 보이는 봇 이름(identity 의 /api/bot 과 같다). 준비 전이면 빈 문자열(봇 전체 초기화를 받지 않는다)
const botNameOf = (req: Request) => (req.app.locals.bot.client.user?.username as string | undefined) ?? "";
const launcherOf = (req: Request) => Boolean(req.app.locals.restart);
const overviewOf = (req: Request): ResetOverview => reset.overview(botNameOf(req), launcherOf(req));

resetRouter.get("/", (req, res) => res.json(overviewOf(req)));

resetRouter.post("/", async (req, res) => {
  const body = parse(ResetBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code, {}, { errors: body.errors });
  const request = body.value;
  const by = ranBy(req);
  if (request.kind === "all") {
    const name = botNameOf(req);
    if (!name || request.confirmName !== name) return sendProblem(res, "reset-name-mismatch");
    if (fullReset.requested()) return sendProblem(res, "reset-already-staged");
  }
  let done: ResetDone;
  try {
    if (request.kind === "audio-cache") {
      const result = await reset.resetAudioCache([...new Set(request.parts)], by);
      done = { kind: "audio-cache", removedFiles: result.removed, freedBytes: result.freedBytes, keptFiles: result.kept, cleared: result.cleared };
    } else if (request.kind === "bot-settings") done = { kind: "bot-settings", ...(await reset.resetBotSettings(by)) };
    else if (request.kind === "guild-settings") done = { kind: "guild-settings", ...(await reset.resetGuildSettings(by)) };
    else if (request.kind === "display") done = { kind: "display", ...reset.resetDisplay(by) };
    else {
      const restart = req.app.locals.restart;
      done = { kind: "all", ...(await reset.stageFullReset(by, Boolean(restart))), restarting: Boolean(restart) };
      // 실행기로 켰으면 답을 보낸 뒤 다시 시작한다(다음 기동이 지운다)
      if (restart) res.on("finish", () => restart(by));
    }
  } catch (error) {
    log.error({ sub: "admin" }, `초기화(${request.kind})를 하지 못했습니다: ${messageOf(error)}`);
    return sendProblem(res, "reset-failed", {}, { detail: messageOf(error) });
  }
  res.json(done);
});

resetRouter.delete("/staged", (req, res) => {
  if (!reset.cancelFullReset(ranBy(req))) return sendProblem(res, "reset-not-staged");
  res.json(overviewOf(req));
});

export { resetRouter };
