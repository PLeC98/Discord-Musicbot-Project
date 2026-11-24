// 설정 DB 스냅샷(운영자 패널 백업 탭). /api/admin/snapshots
// 복원은 선택한 스냅샷을 예약하기만 한다. 교체는 다음 기동(화면이 곧바로 다시 시작한다. 실행기 없이 켰으면 다음에 켤 때)

import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireOwner } from "../middleware/require-owner.ts";
import { requireRecentLogin } from "../middleware/recent-login.ts";
import { sendProblem } from "../problem.ts";
import { ranBy } from "../ran-by.ts";
import { codeOf, errorProblem, messageOf } from "../../rules/error-kind.ts";
import * as snapshots from "../../store/snapshots.ts";
import type { SnapshotsView } from "../../rules/snapshots.ts";
import { L } from "../../infra/log/text.ts";

const snapshotsRouter = express.Router();
snapshotsRouter.use(requireOwner);

const view = (): SnapshotsView => ({ rows: snapshots.list(), staged: snapshots.staged() });

snapshotsRouter.get("/", (_req, res) => res.json(view()));

// 지금 설정을 통째 바꾸는 일이라 최근 로그인만
snapshotsRouter.post("/restore", requireRecentLogin, (req, res) => {
  const name: unknown = req.body?.name;
  if (typeof name !== "string" || !name) return sendProblem(res, "nothing-to-save");
  try {
    snapshots.stage(name);
  } catch (error) {
    if (codeOf(error) === "SNAPSHOT_NOT_FOUND") return sendProblem(res, "snapshot-not-found");
    if (codeOf(error) === "SNAPSHOT_MISMATCH") return sendProblem(res, "snapshot-mismatch", {}, { errors: [{ code: "snapshot-mismatch", rule: errorProblem(error) }] });
    log.error({ sub: "admin" }, L.dashboard.restoreScheduleFailed({ error: messageOf(error) }));
    // 실패 상세는 규칙 문제로 보낸다(화면이 보는 사람의 언어로 그린다. 바깥 글이면 그 글 그대로)
    return sendProblem(res, "config-save-failed", {}, { errors: [{ code: "config-save-failed", rule: errorProblem(error) }] });
  }
  log.warn({ sub: "admin" }, L.dashboard.restoreScheduled({ name, by: ranBy(req) }));
  res.json(view());
});

snapshotsRouter.delete("/restore", (req, res) => {
  const was = snapshots.staged();
  snapshots.unstage();
  if (was) log.warn({ sub: "admin" }, L.dashboard.restoreCancelled({ was, by: ranBy(req) }));
  res.json(view());
});

export { snapshotsRouter };
