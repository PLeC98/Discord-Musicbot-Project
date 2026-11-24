// 운영 설정값(운영자 패널의 일반, 유튜브, 디스플레이 탭). /api/admin/tunables
// 값은 settings.db의 문서에 두고 저장하면 바로 설정 객체에 올린다(다시 시작해야 적용되는 값은 pending으로 알린다. store/tunables)

import type { RuleProblem } from "../../rules/rule-problem.ts";
import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import config from "../../config/index.ts";
import { requireOwner } from "../middleware/require-owner.ts";
import { sendProblem } from "../problem.ts";
import { ranBy } from "../ran-by.ts";
import { codeOf, errorProblem, messageOf } from "../../rules/error-kind.ts";
import * as tunables from "../../store/tunables.ts";
import * as youtubeSource from "../../sources/youtube/index.ts";
import { TUNABLES, RESTART_KEYS } from "../../rules/tunables.ts";
import { L } from "../../infra/log/text.ts";
import { asText } from "../../infra/log/log-text.ts";

const tunablesRouter = express.Router();
tunablesRouter.use(requireOwner);

tunablesRouter.get("/", (_req, res) => res.json(tunables.view()));

// 바뀐 필드를 "이름 이전 → 이후"로. 빈 값은 기본값이다. 다시 시작해야 적용되는 필드는 그렇다고 단다
function changesOf(before: Record<string, string>, after: Record<string, string>) {
  const shown = (value: string | undefined) => (value === undefined ? L.dashboard.tunableDefault() : JSON.stringify(value));
  return TUNABLES.filter(({ key }) => before[key] !== after[key]).map(({ key }) => L.dashboard.tunableChanged({ key, before: shown(before[key]), after: shown(after[key]), restart: RESTART_KEYS.has(key) }));
}

tunablesRouter.put("/", (req, res) => {
  const values: unknown = req.body?.values;
  const revision: unknown = req.body?.revision;
  if (!values || typeof values !== "object" || !Number.isInteger(revision)) return sendProblem(res, "nothing-to-save");

  const cookiesBefore = config.ytdlp.cookiesSource;
  const before = tunables.view().values;
  try {
    const saved = tunables.save(values as Record<string, unknown>, revision as number);
    const changes = changesOf(before, saved.values);
    log.warn({ sub: "admin" }, L.dashboard.tunablesSaved({ changes: changes.map(asText).join(", "), by: ranBy(req) }));
    // 쿠키 출처는 바로 적용된다. 지금 무엇으로 유튜브에 붙는지 한 줄 다시 남긴다
    if (config.ytdlp.cookiesSource !== cookiesBefore) youtubeSource.logAuthMode();
    res.json(saved);
  } catch (error) {
    if (codeOf(error) === "CONFIG_INVALID") return sendProblem(res, "config-invalid", {}, { errors: ((error as { problems?: RuleProblem[] }).problems ?? []).map((rule) => ({ code: "config-invalid", rule })) });
    if (codeOf(error) === "REVISION_CONFLICT") return sendProblem(res, "config-changed");
    log.error({ sub: "admin" }, L.dashboard.tunablesSaveFailed({ error: messageOf(error) }));
    sendProblem(res, "config-save-failed", {}, { errors: [{ code: "config-save-failed", rule: errorProblem(error) }] });
  }
});

export { tunablesRouter };
