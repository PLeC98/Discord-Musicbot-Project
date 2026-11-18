// 외부 도구의 상태와 조작. 운영자 패널 업데이트 탭의 yt-dlp 카드와 외부 프로그램 이전 버전 카드가 호출한다. /api/admin/vendor
// 버전 고정은 저장 바가 아니라 여기서 바로 저장한다(store/tunables의 saveCard). 채널, 모드는 저장 바에서 저장한다(routes/tunables).
// 저장하면 새 설정대로 yt-dlp 버전을 맞춘다(sources/ytdlp-binary).
// 다운로드는 시작만 하고 지금 상태로 응답한다. 화면은 상태를 다시 읽어 진행을 본다

import express, { type NextFunction, type Request, type Response } from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import config from "../../config/index.ts";
import { bestEffort } from "../../infra/best-effort.ts";
import { requireOwner } from "../middleware/require-owner.ts";
import { requireRecentLogin } from "../middleware/recent-login.ts";
import { sendProblem } from "../problem.ts";
import { ranBy } from "../ran-by.ts";
import { codeOf, messageOf } from "../../rules/error-kind.ts";
import * as tunables from "../../store/tunables.ts";
import { ytdlpBinary } from "../../sources/ytdlp-binary.ts";
import { bgutilCardStatus } from "../../sources/bgutil/card-status.ts";
import { bgutilAutoInstall } from "../../sources/bgutil/auto-install.ts";
import { doneLine, previewOldTools, removeOldTools } from "../old-tools.ts";
import { OLD_TOOLS, type OldTool } from "../contract/old-tools.ts";
import { recountVendor } from "../status/storage.ts";
import { assertSignedIn, sessionEnded } from "../session-requests.ts";
import type { VendorReply } from "../contract/admin.ts";
import type { TunablesView } from "../../rules/tunables.ts";

const vendorRouter = express.Router();
vendorRouter.use(requireOwner);

const reply = (saved?: TunablesView): VendorReply => ({ status: { ytdlp: ytdlpBinary.status(), bgutil: bgutilCardStatus() }, ...(saved ? { tunables: saved } : {}) });

// 카드 값을 저장한다. 저장했으면 설정값 상태. 거절했으면 문제 응답을 보내고 null
function saveCard(req: Request, res: Response, changes: Record<string, string | null>, what: string): TunablesView | null {
  try {
    const saved = tunables.saveCard(changes);
    log.warn({ sub: "admin" }, `대시보드에서 yt-dlp ${what}. 실행 ${ranBy(req)}`);
    return saved;
  } catch (error) {
    if (codeOf(error) === "CONFIG_INVALID") sendProblem(res, "config-invalid", {}, { errors: ((error as { problems?: string[] }).problems ?? []).map((detail) => ({ code: "config-invalid", detail })) });
    else {
      log.error({ sub: "admin" }, `yt-dlp 설정 저장 실패: ${messageOf(error)}`);
      sendProblem(res, "config-save-failed", {}, { detail: messageOf(error) });
    }
    return null;
  }
}

// 저장한 설정으로 버전을 맞춘다. 결과는 yt-dlp가 로그와 상태에 남긴다
const converge = (human: boolean) => void bestEffort(log, ytdlpBinary.converge({ human, fresh: true }), "yt-dlp 버전 맞추기", "warn");
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

vendorRouter.get("/", (_req, res) => res.json(reply()));

// 채널의 최신 태그를 읽기만 한다(다운로드하지 않는다)
vendorRouter.post("/ytdlp/check", async (_req, res) => {
  try {
    await ytdlpBinary.peek();
    res.json(reply());
  } catch (error) {
    log.warn({ sub: "admin" }, `yt-dlp 최신 릴리스 조회 실패: ${messageOf(error)}`);
    sendProblem(res, "tool-check-failed", {}, { detail: messageOf(error) });
  }
});

// 확인한 태그로 업데이트. 화면이 본 채널, 태그가 봇이 마지막으로 확인한 것과 같을 때만 한다
vendorRouter.post("/ytdlp/update", (req, res) => {
  const channel = text(req.body?.channel);
  const tag = text(req.body?.tag);
  if (!channel || !tag) return sendProblem(res, "nothing-to-save");
  const started = ytdlpBinary.update(channel, tag);
  if (started === "pinned") return sendProblem(res, "tool-version-pinned");
  if (started === "stale") return sendProblem(res, "tool-check-stale");
  log.warn({ sub: "admin" }, `대시보드에서 yt-dlp 업데이트: ${tag}(${channel}). 실행 ${ranBy(req)}`);
  void bestEffort(log, started, "yt-dlp 업데이트", "warn");
  res.status(202).json(reply());
});

// 최근 로그인은 버전을 직접 입력해 고정할 때만 요구한다. 아무 옛 버전이나 고를 수 있는 조작은 그것뿐이다.
// 고정 해제(채널의 최신으로), 업데이트(확인한 최신으로), 이전 버전으로 되돌리기(바로 전에 설치했던 버전 하나)는 요구하지 않는다(채널, 모드의 저장 바 저장도)
const recentLoginToPin = (req: Request, res: Response, next: NextFunction) => (text(req.body?.version) ? requireRecentLogin(req, res, next) : next());

// 버전 고정(version: 태그, null이면 해제). 값이 그대로여도 다시 맞춰 본다(고정한 버전 다운로드에 실패한 뒤의 재시도)
vendorRouter.post("/ytdlp/pin", recentLoginToPin, (req, res) => {
  const version = text(req.body?.version);
  const was = config.ytdlp.version;
  if (req.body?.expect !== undefined && (text(req.body.expect) ?? null) !== was) return sendProblem(res, "config-changed");
  const saved = saveCard(req, res, { YTDLP_VERSION: version }, `고정 버전 변경: ${was ?? "없음"} → ${version ?? "없음"}`);
  if (!saved) return;
  converge(true);
  res.status(202).json(reply(saved));
});

// 이전 버전으로 되돌리기: 기록의 이전 버전을 고정한다(자동 모드가 다시 올리지 않게). 그 버전을 다른 채널에서 다운로드했으면 채널도 함께 바꾼다
vendorRouter.post("/ytdlp/rollback", (req, res) => {
  const target = ytdlpBinary.rollbackTarget();
  if (!target) return sendProblem(res, "tool-no-previous");
  const changes: Record<string, string> = { YTDLP_VERSION: target.version };
  if (target.channel && target.channel !== config.ytdlp.channel) changes.YTDLP_CHANNEL = target.channel;
  const saved = saveCard(req, res, changes, `이전 버전으로 되돌림: ${target.version}`);
  if (!saved) return;
  converge(true);
  res.status(202).json(reply(saved));
});

// bgutil 설치 재시도(실패했거나 필요한 도구를 설치한 뒤). 혼자서 하는 설치의 시도 기록을 무시하고 판정한다. 켜져 있지 않으면 하지 않는다
vendorRouter.post("/bgutil/install", async (req, res) => {
  await bgutilAutoInstall.ensure("manual");
  log.info({ sub: "admin" }, `대시보드에서 bgutil 설치 재시도. 실행 ${ranBy(req)}`);
  res.json(reply());
});

// 외부 프로그램 이전 버전 카드: 도구마다 삭제할 수 있는 이전 버전과 크기(폴더 크기를 세느라 비동기)
vendorRouter.get("/old-versions", async (_req, res) => {
  res.json(await previewOldTools());
});

// 이전 버전 삭제. 본문의 tool이 있으면 그 도구만(줄마다 삭제), 없으면 모두. 지금 쓰는 버전은 남긴다(dashboard/old-tools).
// 공간만 비우는 조작이라 최근 로그인은 요구하지 않는다(되돌릴 곳이 없어질 뿐 설정이 바뀌지 않는다)
vendorRouter.post("/old-versions", async (req, res) => {
  const tool: unknown = req.body?.tool;
  if (tool !== undefined && !OLD_TOOLS.includes(tool as OldTool)) return sendProblem(res, "bad-request");
  try {
    const tools = await removeOldTools(() => assertSignedIn(req), undefined, tool as OldTool | undefined);
    recountVendor();
    log.warn({ sub: "admin" }, `대시보드에서 외부 프로그램 이전 버전 삭제: ${doneLine(tools)}. 실행 ${ranBy(req)}`);
    res.json(tools);
  } catch (error) {
    if (sessionEnded(res, error)) return;
    log.error({ sub: "admin" }, `외부 프로그램 이전 버전 삭제 실패: ${messageOf(error)}`);
    sendProblem(res, "tool-cleanup-failed", {}, { detail: messageOf(error) });
  }
});

export { vendorRouter };
