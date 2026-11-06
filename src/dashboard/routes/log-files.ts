// 로그 파일 보기(/api/admin/logs/files, /file, /file/download). 운영자만. 모양은 contract/log-files, 읽기는 log-file-reader.
// 파일 이름은 목록의 이름만 받는다(경로를 받지 않는다). 파일 로그를 껐으면 목록이 비고 읽기는 log-file-not-found

import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import express, { type Request, type Response } from "express";
import config from "../../config/index.ts";
import logger from "../../infra/log/logger.ts";
import { codeOf, messageOf } from "../../rules/error-kind.ts";
import { requireOwner } from "../middleware/require-owner.ts";
import { isEnded } from "../session-requests.ts";
import { sendProblem } from "../problem.ts";
import { filteredLines, formatLogLine, listLogFiles, readLogPage, resolveLogFile } from "../log-file-reader.ts";
import { isLevel } from "../../infra/log/levels.ts";
import { FILE_PAGE_LINES, FILE_PAGE_MAX, type FileLine, type FilePage, type LogFileList, type LogFilter } from "../contract/log-files.ts";
const log = logger.child({ category: "dashboard" });

const logFilesRouter = express.Router();

function intOf(raw: unknown): number | undefined {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) ? Math.trunc(n) : undefined;
}
const textOf = (raw: unknown) => (typeof raw === "string" ? raw : "");

/** 필터. levels 가 없으면 모든 레벨, 빈 글이면 아무 레벨도 아니다(화면에서 레벨을 모두 끈 것) */
function filterOf(req: Request): LogFilter {
  const levels = req.query.levels;
  return {
    ...(typeof levels === "string" ? { levels: new Set(levels.split(",").filter(isLevel)) } : {}),
    category: textOf(req.query.category),
    tag: textOf(req.query.tag),
    q: textOf(req.query.q),
  };
}

/** 읽을 파일(파일 로그를 껐거나 없는 이름이면 null) */
function targetOf(req: Request) {
  if (!config.logging.fileEnabled) return null;
  return resolveLogFile(config.logging.file, textOf(req.query.name), intOf(req.query.since));
}

/**
 * 오래 읽는 동안 멈출 때. left 는 받는 쪽이 떠났다(답하지 않는다), stop 은 그것이나 이 로그인이 끝났다
 * (끝난 GET 의 답은 세션 쪽이 401 로 바꾼다)
 */
function watchLeave(req: Request, res: Response) {
  let gone = false;
  res.once("close", () => (gone = true));
  const left = () => gone;
  return { left, stop: () => gone || isEnded(req) };
}

logFilesRouter.get("/files", requireOwner, async (req, res) => {
  const enabled = config.logging.fileEnabled;
  const { left, stop } = watchLeave(req, res);
  const files = enabled ? await listLogFiles(config.logging.file, stop) : [];
  if (left()) return;
  res.json({ enabled, files } satisfies LogFileList);
});

logFilesRouter.get("/file", requireOwner, async (req, res) => {
  const target = targetOf(req);
  const limit = Math.min(Math.max(intOf(req.query.limit) ?? FILE_PAGE_LINES, 1), FILE_PAGE_MAX);
  const { left, stop } = watchLeave(req, res);
  const page = target && (await readLogPage(target, { before: intOf(req.query.before), after: intOf(req.query.after), at: intOf(req.query.at), limit, filter: filterOf(req) }, stop));
  if (left()) return;
  if (!page) return sendProblem(res, "log-file-not-found");
  res.json(page satisfies FilePage);
});

/** 걸러 낸 줄의 묶음을 글 조각으로 */
async function* downloadText(batches: AsyncGenerator<FileLine[]>, offset: number): AsyncGenerator<string> {
  for await (const lines of batches) yield lines.map((line) => `${formatLogLine(line, offset)}\n`).join("");
}

// 다운로드: 화면과 같은 열(가린 것)을 지금 건 필터 그대로. 원본은 서버의 로그 폴더에 있다.
// 받는 쪽이 읽는 만큼만 읽어 보내고, 끊기면(로그인이 끝나 끊은 것도) 멈추고 파일을 닫는다
logFilesRouter.get("/file/download", requireOwner, async (req, res) => {
  const target = targetOf(req);
  if (!target) return sendProblem(res, "log-file-not-found");
  const offset = intOf(req.query.tz) ?? 0;
  const name = `${path.basename(target.name, path.extname(target.name))}.txt`;
  res.type("text/plain; charset=utf-8").attachment(name);
  try {
    // 바이트 단위 스트림으로: 쌓아 두는 양을 조각 수가 아니라 바이트로 센다
    await pipeline(Readable.from(downloadText(filteredLines(target, filterOf(req)), offset), { objectMode: false }), res);
  } catch (error) {
    // 끊긴 응답은 받는 쪽이 덜 받은 것을 안다(pipeline 이 응답을 부순다)
    if (codeOf(error) === "ERR_STREAM_PREMATURE_CLOSE") log.debug(`로그 파일 다운로드 중단: ${target.name}`);
    else log.warn(`로그 파일 다운로드 실패: ${target.name}: ${messageOf(error)}`);
  }
});

export { logFilesRouter };
