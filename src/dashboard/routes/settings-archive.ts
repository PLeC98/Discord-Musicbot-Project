// 설정 내보내기 · 가져오기(운영자 패널 설정 탭). /api/admin/settings-archive
// 내보내기 · 가져오기는 최근 로그인만(훔친 로그인 쿠키로 설정을 빼가거나 갈아 끼우지 못하게). 미리 보기는 아무것도 바꾸지 않아 운영자면 된다

import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireOwner } from "../middleware/require-owner.ts";
import { requireRecentLogin } from "../middleware/recent-login.ts";
import { sendProblem } from "../problem.ts";
import { ranBy } from "../ran-by.ts";
import { codeOf, messageOf } from "../../rules/error-kind.ts";
import * as archive from "../settings-archive.ts";
import * as snapshots from "../../store/snapshots.ts";
import { ARCHIVE_MAX_BYTES, isArchiveItem, isArchiveKind, type ArchiveImported, type ArchiveItem } from "../contract/settings-archive.ts";
import type { Response } from "express";

const settingsArchiveRouter = express.Router();
settingsArchiveRouter.use(requireOwner);

// 화면은 Content-Type: application/zip 으로 파일 그대로 보낸다
const zipBody = express.raw({ type: "application/zip", limit: ARCHIVE_MAX_BYTES });

// 읽지 못한 파일(ZIP 이 깨졌거나 이 봇의 내보내기가 아님)은 그 까닭과 함께 400
function unreadable(res: Response, error: unknown) {
  if (codeOf(error) === "BAD_ZIP" || codeOf(error) === "BAD_ARCHIVE") {
    sendProblem(res, "bad-archive", {}, { detail: messageOf(error) });
    return true;
  }
  return false;
}

// kind: settings(봇 설정만) · full(암호화된 설정까지)
settingsArchiveRouter.get("/export", requireRecentLogin, async (req, res) => {
  const kind = String(req.query.kind ?? "");
  if (!isArchiveKind(kind)) return sendProblem(res, "nothing-to-save");
  const file = await archive.build(kind);
  log.warn({ sub: "admin" }, `대시보드에서 설정 내보내기(${kind === "full" ? "암호화된 설정까지" : "봇 설정만"}). 실행 ${ranBy(req)}`);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${archive.fileName(kind)}"`);
  res.send(file);
});

settingsArchiveRouter.post("/preview", zipBody, async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return sendProblem(res, "nothing-to-save");
  try {
    res.json(await archive.preview(req.body));
  } catch (error) {
    if (!unreadable(res, error)) throw error;
  }
});

// items: 덮어쓸 항목(쉼표로)
settingsArchiveRouter.post("/import", requireRecentLogin, zipBody, async (req, res) => {
  const items = String(req.query.items ?? "")
    .split(",")
    .filter(Boolean);
  if (!Buffer.isBuffer(req.body) || !req.body.length || !items.length || !items.every(isArchiveItem)) return sendProblem(res, "nothing-to-save");
  try {
    // 쓰기 직전에 지금 설정을 스냅샷으로 남긴다(검사에 걸리면 뜨지 않는다)
    const imported = await archive.apply(req.body, [...new Set(items)] as ArchiveItem[], { before: () => snapshots.take("before-import") });
    log.warn({ sub: "admin" }, `대시보드에서 설정 가져오기: ${imported.join(" · ")}. 실행 ${ranBy(req)}`);
    res.json({ imported } satisfies ArchiveImported);
  } catch (error) {
    if (unreadable(res, error)) return;
    if (codeOf(error) === "CONFIG_INVALID") return sendProblem(res, "config-invalid", {}, { errors: ((error as { problems?: string[] }).problems ?? []).map((detail) => ({ code: "config-invalid", detail })) });
    log.error({ sub: "admin" }, `설정 가져오기 실패: ${messageOf(error)}`);
    sendProblem(res, "config-save-failed", {}, { detail: messageOf(error) });
  }
});

export { settingsArchiveRouter };
