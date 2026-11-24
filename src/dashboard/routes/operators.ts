// 봇 운영자 카드(운영자 패널 설정 탭). 지금 운영자와 정한 곳을 보여 주고, 팀 앱에서 운영자를 넓히는 범위를 바꾼다. /api/admin/operators
// 범위는 앱 소유자(팀 소유자)만 바꾼다. Admin 운영자가 스스로 범위를 넓히지 못하게(usecases/app-owners 의 isAppOwner)

import express, { type Request, type Response } from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import config from "../../config/index.ts";
import { requireOwner } from "../middleware/require-owner.ts";
import { requireRecentLogin } from "../middleware/recent-login.ts";
import { sendProblem } from "../problem.ts";
import { ranBy } from "../ran-by.ts";
import { signedIn } from "../middleware/require-auth.ts";
import { codeOf, errorProblem, messageOf } from "../../rules/error-kind.ts";
import { isOperatorScope, nameOf, overrideIds } from "../../rules/app-owners.ts";
import { appOwners, isAppOwner, isStale, operators } from "../../usecases/app-owners.ts";
import * as tunables from "../../store/tunables.ts";
import { L } from "../../infra/log/text.ts";
import type { OperatorsView, ScopeLock, ScopeSaved } from "../contract/operators.ts";

const operatorsRouter = express.Router();
operatorsRouter.use(requireOwner);

/** 이 사용자가 범위를 바꿀 수 없는 까닭. 바꿀 수 있으면 null */
function lockOf(userId: string): ScopeLock | null {
  const app = appOwners();
  if (!app) return "unknown";
  if (overrideIds(config.dashboard.ownerId)) return "override";
  if (app.kind === "personal") return "personal";
  return isAppOwner(userId) ? null : "not-app-owner";
}

function view(req: Request): OperatorsView {
  const app = appOwners();
  return {
    kind: app?.kind ?? null,
    source: overrideIds(config.dashboard.ownerId) ? "override" : "app",
    operators: operators().map((id) => ({ id, name: app ? nameOf(app, id) : id })),
    teamId: app?.kind === "team" ? app.teamId : null,
    scope: config.dashboard.operators.scope,
    stale: isStale(),
    lock: lockOf(signedIn(req).id),
  };
}

operatorsRouter.get("/", (req, res) => res.json(view(req)));

// 범위 바꾸기(scope: owner, admin, developer). expect: 화면에 불러온 범위(그사이 다른 곳에서 바꿨으면 거절)
operatorsRouter.put("/scope", requireRecentLogin, (req: Request, res: Response) => {
  const scope: unknown = req.body?.scope;
  if (!isOperatorScope(scope)) return sendProblem(res, "nothing-to-save");
  if (lockOf(signedIn(req).id)) return sendProblem(res, "operator-scope-owner-only");
  const was = config.dashboard.operators.scope;
  if (req.body?.expect !== undefined && req.body.expect !== was) return sendProblem(res, "config-changed");
  let saved;
  try {
    saved = tunables.saveCard({ OPERATOR_SCOPE: scope === "owner" ? null : scope });
  } catch (error) {
    log.error({ sub: "admin" }, L.dashboard.operatorScopeSaveFailed({ error: messageOf(error) }));
    if (codeOf(error) === "CONFIG_INVALID") return sendProblem(res, "config-invalid");
    return sendProblem(res, "config-save-failed", {}, { errors: [{ code: "config-save-failed", rule: errorProblem(error) }] });
  }
  log.warn({ sub: "admin" }, L.dashboard.operatorScopeChanged({ from: was, to: scope, by: ranBy(req) }));
  res.json({ operators: view(req), tunables: saved } satisfies ScopeSaved);
});

export { operatorsRouter };
