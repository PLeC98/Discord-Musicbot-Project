// 설정 내보내기 · 가져오기(운영자 패널 백업 탭). /api/admin/settings-archive
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
import * as uploads from "../archive-uploads.ts";
import * as snapshots from "../../store/snapshots.ts";
import { isArchiveItem, isArchiveKind, type ArchiveImported, type ArchiveItem, type ArchiveKind, type ArchivePreview } from "../contract/settings-archive.ts";
import type { Response } from "express";

const settingsArchiveRouter = express.Router();
settingsArchiveRouter.use(requireOwner);

const KIND_LABEL: Record<ArchiveKind, string> = { settings: "봇 설정만", full: "암호화된 설정까지", favicon: "파비콘" };

// 읽지 못한 파일(ZIP 이 깨졌거나 이 봇의 내보내기가 아님)은 그 까닭과 함께 400
function unreadable(res: Response, error: unknown) {
  if (codeOf(error) === "BAD_ZIP" || codeOf(error) === "BAD_ARCHIVE") {
    sendProblem(res, "bad-archive", {}, { detail: messageOf(error) });
    return true;
  }
  return false;
}

// kind: settings(봇 설정만) · full(암호화된 설정까지) · favicon(파비콘)
settingsArchiveRouter.get("/export", requireRecentLogin, async (req, res) => {
  const kind = String(req.query.kind ?? "");
  if (!isArchiveKind(kind)) return sendProblem(res, "nothing-to-save");
  const file = await archive.build(kind);
  log.warn({ sub: "admin" }, `대시보드에서 설정 내보내기(${KIND_LABEL[kind]}). 실행 ${ranBy(req)}`);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${archive.fileName(kind)}"`);
  res.send(file);
});

// 파일 그대로 올린다. 읽을 수 있으면 올린 파일을 두고 그 표(token)와 미리 보기, 못 읽으면 지운다
settingsArchiveRouter.post("/preview", async (req, res) => {
  const got = await uploads.receive(req);
  if (!got.ok) {
    if (got.why === "no-space") return sendProblem(res, "disk-full", { size: got.room });
    if (got.why === "empty") return sendProblem(res, "nothing-to-save");
    // 올리던 사람이 끊었다
    if (got.why === "aborted") log.warn({ sub: "admin" }, `설정 불러오기 파일을 받다 끊겼습니다: ${got.detail}`);
    if (!res.headersSent) sendProblem(res, "bad-request");
    return;
  }
  try {
    res.json({ ...(await archive.preview(got.file)), token: got.token } satisfies ArchivePreview);
  } catch (error) {
    uploads.drop(got.token);
    if (!unreadable(res, error)) throw error;
  }
});

// token: 미리 보기의 표, items: 덮어쓸 항목(쉼표로). 가져오면 올린 파일을 지운다(검사에 걸리면 다시 고를 수 있게 둔다)
settingsArchiveRouter.post("/import", requireRecentLogin, async (req, res) => {
  const token = String(req.query.token ?? "");
  const items = String(req.query.items ?? "")
    .split(",")
    .filter(Boolean);
  if (!items.length || !items.every(isArchiveItem)) return sendProblem(res, "nothing-to-save");
  const file = uploads.fileOf(token);
  if (!file) return sendProblem(res, "upload-gone");
  try {
    // 쓰기 직전에 지금 설정을 스냅샷으로 남긴다(검사에 걸리면 뜨지 않는다)
    const imported = await archive.apply(file, [...new Set(items)] as ArchiveItem[], { before: () => snapshots.take("before-import") });
    uploads.drop(token);
    log.warn({ sub: "admin" }, `대시보드에서 설정 가져오기: ${imported.join(" · ")}. 실행 ${ranBy(req)}`);
    res.json({ imported } satisfies ArchiveImported);
  } catch (error) {
    if (unreadable(res, error)) return;
    if (codeOf(error) === "CONFIG_INVALID") return sendProblem(res, "config-invalid", {}, { errors: ((error as { problems?: string[] }).problems ?? []).map((detail) => ({ code: "config-invalid", detail })) });
    log.error({ sub: "admin" }, `설정 가져오기 실패: ${messageOf(error)}`);
    sendProblem(res, "config-save-failed", {}, { detail: messageOf(error) });
  }
});

// 불러오기 창을 닫았다: 올린 파일을 지운다
settingsArchiveRouter.delete("/upload/:token", (req, res) => {
  uploads.drop(req.params.token);
  res.status(204).end();
});

export { settingsArchiveRouter };
