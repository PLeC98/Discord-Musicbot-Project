// 로그 파일 보기(/api/admin/logs/files · /file · /file/download). 운영자만. 모양은 contract/log-files, 읽기는 log-file-reader.
// 파일 이름은 목록의 이름만 받는다(경로를 받지 않는다). 파일 로그를 껐으면 목록이 비고 읽기는 log-file-not-found

import path from "path";
import express, { type Request } from "express";
import config from "../../config/index.ts";
import { requireOwner } from "../middleware/require-owner.ts";
import { sendProblem } from "../problem.ts";
import { filteredLines, formatLogLine, listLogFiles, readLogPage, resolveLogFile } from "../log-file-reader.ts";
import { isLevel } from "../../infra/log/levels.ts";
import { FILE_PAGE_LINES, FILE_PAGE_MAX, type FilePage, type LogFileList, type LogFilter } from "../contract/log-files.ts";

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

logFilesRouter.get("/files", requireOwner, (_req, res) => {
  const enabled = config.logging.fileEnabled;
  res.json({ enabled, files: enabled ? listLogFiles(config.logging.file) : [] } satisfies LogFileList);
});

logFilesRouter.get("/file", requireOwner, (req, res) => {
  const target = targetOf(req);
  const limit = Math.min(Math.max(intOf(req.query.limit) ?? FILE_PAGE_LINES, 1), FILE_PAGE_MAX);
  const page = target && readLogPage(target, { before: intOf(req.query.before), after: intOf(req.query.after), at: intOf(req.query.at), limit, filter: filterOf(req) });
  if (!page) return sendProblem(res, "log-file-not-found");
  res.json(page satisfies FilePage);
});

// 내려받기: 화면과 같은 열(가린 것)을 지금 건 필터 그대로. 원본은 서버의 로그 폴더에 있다. 한 줄씩 흘려 보낸다
logFilesRouter.get("/file/download", requireOwner, (req, res) => {
  const target = targetOf(req);
  if (!target) return sendProblem(res, "log-file-not-found");
  const offset = intOf(req.query.tz) ?? 0;
  const name = `${path.basename(target.name, path.extname(target.name))}.txt`;
  res.type("text/plain; charset=utf-8").attachment(name);
  for (const line of filteredLines(target, filterOf(req))) res.write(`${formatLogLine(line, offset)}\n`);
  res.end();
});

export { logFilesRouter };
