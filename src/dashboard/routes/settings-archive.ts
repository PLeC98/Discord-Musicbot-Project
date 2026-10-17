// 설정 내보내기 · 가져오기(운영자 패널 백업 탭). /api/admin/settings-archive
// 내보내기 · 가져오기는 최근 로그인만(훔친 로그인 쿠키로 설정을 빼가거나 갈아 끼우지 못하게). 미리 보기는 아무것도 바꾸지 않아 운영자면 된다

import crypto from "node:crypto";
import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { requireOwner } from "../middleware/require-owner.ts";
import { requireRecentLogin } from "../middleware/recent-login.ts";
import { sendProblem } from "../problem.ts";
import { ranBy } from "../ran-by.ts";
import { codeOf, messageOf } from "../../rules/error-kind.ts";
import { sinkOf, writeZip } from "../../infra/zip.ts";
import * as archive from "../settings-archive.ts";
import * as uploads from "../archive-uploads.ts";
import * as snapshots from "../../store/snapshots.ts";
import { isArchiveItem, isArchiveKind, type ArchiveDownload, type ArchiveImported, type ArchiveItem, type ArchiveKind, type ArchivePreview } from "../contract/settings-archive.ts";
import type { Response } from "express";

const settingsArchiveRouter = express.Router();
settingsArchiveRouter.use(requireOwner);

const KIND_LABEL: Record<ArchiveKind, string> = { settings: "봇 설정만", full: "암호화된 설정까지", favicon: "파비콘", "login-background": "로그인 배경" };

// 읽지 못한 파일(ZIP 이 깨졌거나 이 봇의 내보내기가 아님)은 그 까닭과 함께 400
function unreadable(res: Response, error: unknown) {
  if (codeOf(error) === "BAD_ZIP" || codeOf(error) === "BAD_ARCHIVE") {
    sendProblem(res, "bad-archive", {}, { detail: messageOf(error) });
    return true;
  }
  return false;
}

/** 한 번 쓰는 내려받기 표: 표 → 종류 · 낸 사람 · 지나는 때 */
const tickets = new Map<string, { kind: ArchiveKind; by: string; until: number }>();
const TICKET_MS = 60_000;
const TICKET = /^[0-9a-f]{32}$/;

// kind: settings(봇 설정만) · full(암호화된 설정까지) · favicon(파비콘) · login-background(로그인 배경). 최근 로그인을 보고 한 번 쓰는 내려받기 주소를 준다
settingsArchiveRouter.post("/export", requireRecentLogin, (req, res) => {
  const kind = String(req.query.kind ?? "");
  if (!isArchiveKind(kind)) return sendProblem(res, "nothing-to-save");
  const now = Date.now();
  for (const [key, one] of tickets) if (one.until < now) tickets.delete(key);
  const ticket = crypto.randomBytes(16).toString("hex");
  tickets.set(ticket, { kind, by: ranBy(req), until: now + TICKET_MS });
  res.json({ url: `${req.baseUrl}/download/${ticket}` } satisfies ArchiveDownload);
});

// 내려받기(표는 한 번만). 만드는 대로 흘려 보낸다(로그인 배경은 수백 MB)
settingsArchiveRouter.get("/download/:ticket", async (req, res) => {
  const ticket = TICKET.test(req.params.ticket) ? tickets.get(req.params.ticket) : undefined;
  if (ticket) tickets.delete(req.params.ticket);
  // 없거나 지난 표: 브라우저가 바로 연 주소라 화면 안내 없이 404
  if (!ticket || ticket.until < Date.now()) return sendProblem(res, "route-not-found");
  const { kind } = ticket;
  const inputs = archive.build(kind);
  log.warn({ sub: "admin" }, `대시보드에서 설정 내보내기(${KIND_LABEL[kind]}). 실행 ${ticket.by}`);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${archive.fileName(kind)}"`);
  try {
    await writeZip(inputs, sinkOf(res));
    res.end();
  } catch (error) {
    // 받던 쪽이 끊었거나 쓰는 동안 파일이 지워졌다(머리를 이미 보냈으니 응답을 끊는다)
    log.debug({ sub: "admin" }, `설정 내보내기를 보내다 멈췄습니다: ${messageOf(error)}`);
    res.destroy();
  }
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
    // 쓰기 직전에 지금 설정을 스냅샷으로 남긴다(검사에 걸리면 뜨지 않는다, 설정 DB 항목을 가져올 때만)
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
