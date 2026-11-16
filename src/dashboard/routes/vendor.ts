// 외부 도구(yt-dlp)의 상태와 조작. 운영자 패널 유튜브 탭의 yt-dlp 카드가 부른다. /api/admin/vendor
// 채널, 모드, 버전 고정은 저장 막대가 아니라 여기서 바로 저장한다(store/tunables 의 saveCard). 저장하면 새 설정대로 yt-dlp 버전을 맞춘다(sources/ytdlp-binary).
// 다운로드는 시작만 하고 지금 상태로 답한다. 화면은 상태를 다시 읽어 진행을 본다

import express, { type Request, type Response } from "express";
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
import type { VendorReply } from "../contract/admin.ts";
import type { TunablesView } from "../../rules/tunables.ts";

const vendorRouter = express.Router();
vendorRouter.use(requireOwner);

const reply = (saved?: TunablesView): VendorReply => ({ status: { ytdlp: ytdlpBinary.status() }, ...(saved ? { tunables: saved } : {}) });

// 카드 값을 저장한다. 저장했으면 조절값 상태. 거절했으면 문제 응답을 보내고 null
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

// 저장한 설정으로 버전을 맞춘다. 결과는 yt-dlp 가 로그와 상태에 남긴다
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

type SettingsAsk = { channel: string | null; mode: string | null; expectChannel: string | null; expectMode: string | null };

// 채널, 모드 요청의 본문을 읽는다. 보내지 않은 것은 null
function settingsAsk(body: unknown): SettingsAsk {
  const sent = (body ?? {}) as { channel?: unknown; mode?: unknown; expect?: { channel?: unknown; mode?: unknown } };
  const expect = sent.expect ?? {};
  return { channel: text(sent.channel), mode: text(sent.mode), expectChannel: text(expect.channel), expectMode: text(expect.mode) };
}

// 거절할 까닭. 받아들이면 null. 버전을 고정한 동안에는 채널을 바꾸지 못한다(고정한 태그는 그 채널의 저장소에서 다운로드한다)
function settingsRefusal(ask: SettingsAsk) {
  const { channel, update: mode, version: pin } = config.ytdlp;
  if (!ask.channel && !ask.mode) return "nothing-to-save";
  if ((ask.expectChannel ?? channel) !== channel || (ask.expectMode ?? mode) !== mode) return "config-changed";
  return ask.channel && ask.channel !== channel && pin ? "tool-version-pinned" : null;
}

// 채널, 모드. expect: 화면이 보던 값(그사이 바뀌었으면 거절)
vendorRouter.post("/ytdlp/settings", (req, res) => {
  const ask = settingsAsk(req.body);
  const refusal = settingsRefusal(ask);
  if (refusal) return sendProblem(res, refusal);
  const changes: Record<string, string> = {};
  if (ask.channel) changes.YTDLP_CHANNEL = ask.channel;
  if (ask.mode) changes.YTDLP_UPDATE = ask.mode;
  const saved = saveCard(req, res, changes, `설정 변경: 채널 ${config.ytdlp.channel} → ${ask.channel ?? config.ytdlp.channel}, 모드 ${config.ytdlp.update} → ${ask.mode ?? config.ytdlp.update}`);
  if (!saved) return;
  converge(false);
  res.json(reply(saved));
});

// 버전 고정(version: 태그, null 이면 해제). 값이 그대로여도 다시 맞춰 본다(고정한 버전 다운로드에 실패한 뒤의 재시도)
vendorRouter.post("/ytdlp/pin", requireRecentLogin, (req, res) => {
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

export { vendorRouter };
