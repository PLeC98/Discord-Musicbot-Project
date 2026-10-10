// 운영 조절값(운영자 패널의 설정 탭). /api/admin/tunables
// 값은 settings.db 의 문서에 두고 저장하면 바로 설정 객체에 올린다(다시 켜야 먹는 값은 pending 으로 알린다. store/tunables)

import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import config from "../../config/index.ts";
import { requireOwner } from "../middleware/require-owner.ts";
import { sendProblem } from "../problem.ts";
import { ranBy } from "../ran-by.ts";
import { codeOf, messageOf } from "../../rules/error-kind.ts";
import * as tunables from "../../store/tunables.ts";
import * as YouTube from "../../sources/youtube/index.ts";

const tunablesRouter = express.Router();
tunablesRouter.use(requireOwner);

tunablesRouter.get("/", (_req, res) => res.json(tunables.view()));

tunablesRouter.put("/", (req, res) => {
  const values: unknown = req.body?.values;
  const revision: unknown = req.body?.revision;
  if (!values || typeof values !== "object" || !Number.isInteger(revision)) return sendProblem(res, "nothing-to-save");

  const cookiesBefore = config.ytdlp.cookiesSource;
  try {
    const saved = tunables.save(values as Record<string, unknown>, revision as number);
    log.warn({ sub: "admin" }, `대시보드에서 운영 조절값 저장(${Object.keys(saved.values).length}칸, 저장 번호 ${saved.revision}). 실행 ${ranBy(req)}`);
    // 쿠키 출처는 바로 먹는다. 지금 무엇으로 유튜브에 붙는지 한 줄 다시 남긴다
    if (config.ytdlp.cookiesSource !== cookiesBefore) YouTube.logAuthMode();
    res.json(saved);
  } catch (error) {
    if (codeOf(error) === "CONFIG_INVALID") return sendProblem(res, "config-invalid", {}, { errors: ((error as { problems?: string[] }).problems ?? []).map((detail) => ({ code: "config-invalid", detail })) });
    if (codeOf(error) === "REVISION_CONFLICT") return sendProblem(res, "config-changed");
    log.error({ sub: "admin" }, `운영 조절값 저장 실패: ${messageOf(error)}`);
    sendProblem(res, "config-save-failed", {}, { detail: messageOf(error) });
  }
});

export { tunablesRouter };
