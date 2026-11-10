// 큰 파일 업로드(운영자 패널). /api/admin/uploads. 시작, 청크, 상태, 취소만 한다. 다 받은 파일은 기능 경로가 업로드 id로 가져간다
// (백업 미리 보기 settings-archive, 로그인 배경 login-background). 업로드의 상태와 공간 예약은 dashboard/uploads

import express, { type Request, type Response } from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import config from "../../config/index.ts";
import { messageOf } from "../../rules/error-kind.ts";
import { requireOwner } from "../middleware/require-owner.ts";
import { limiter } from "../rate-limits.ts";
import { sendProblem } from "../problem.ts";
import { parse, UploadStartBody } from "../request-schemas.ts";
import { assertSignedIn, isEnded, sessionEnded } from "../session-requests.ts";
import { tokenStoreOf, type SqliteSessionStore } from "../session-store.ts";
import * as uploads from "../uploads.ts";
import type { UploadProgress, UploadStarted, UploadStatus } from "../contract/uploads.ts";
import * as archiveUploads from "../archive-uploads.ts";
import * as backgrounds from "../login-background/store.ts";

const uploadsRouter = express.Router();
uploadsRouter.use(requireOwner);

/** 청크 요청의 한도(일반 한도 창마다): 창 길이 1초에 20번(기본 60초면 1200번, 8MiB 청크로 약 160MB/s). 일반 한도에서는 뺀다(rate-limits의 UNLIMITED) */
const CHUNKS_PER_SECOND = 20;
const chunkLimiter = limiter(() => (CHUNKS_PER_SECOND * config.dashboard.rateLimit.windowMs) / 1000);

// 세션이 끝나면(로그아웃, 기기 로그아웃, 만료) 그 세션의 업로드와 미리 보기에 둔 백업을 지운다. 저장소마다 리스너를 한 번만 등록한다
const heard = new WeakSet<SqliteSessionStore>();
uploadsRouter.use((req, _res, next) => {
  const store = tokenStoreOf(req);
  if (store && !heard.has(store)) {
    heard.add(store);
    store.onEnded(uploads.dropSession);
    store.onEnded(archiveUploads.dropSession);
  }
  next();
});

/** 용도마다 받는 동안의 위치. 로그인 배경은 폴더를 먼저 잡는다(기록에 없는 폴더는 다음 기동 때 삭제된다) */
function targetOf(purpose: uploads.Purpose): (id: string) => uploads.Target {
  if (purpose === "archive") return archiveUploads.targetFor;
  return () => {
    const folder = backgrounds.reserve();
    return { file: `${backgrounds.sourceOf(folder)}.part`, room: backgrounds.room, discard: () => backgrounds.removeFolder(folder), ref: folder };
  };
}

/** 공간이 모자란 거절. 용도마다 안내가 다르다(로그인 배경은 기록을 지우라고도 한다) */
const noSpace = (res: Response, purpose: uploads.Purpose, room: number) => sendProblem(res, purpose === "archive" ? "disk-full" : "background-no-space", { size: room });

// { purpose, size } → { id, chunkSize, received }
uploadsRouter.post("/", (req, res) => {
  const body = parse(UploadStartBody, req.body ?? {});
  if (!body.ok) return sendProblem(res, body.code);
  const { purpose, size } = body.value;
  try {
    assertSignedIn(req);
  } catch (error) {
    if (sessionEnded(res, error)) return;
    throw error;
  }
  const started = uploads.start({ sid: req.sessionID, purpose, size, targetOf: targetOf(purpose) });
  if (!started.ok) return started.why === "busy" ? sendProblem(res, "upload-busy") : noSpace(res, purpose, started.room);
  res.json({ id: started.upload.id, chunkSize: uploads.CHUNK_SIZE, received: 0 } satisfies UploadStarted);
});

const OFFSET = /^\d+$/;
const readChunk = express.raw({ type: "application/octet-stream", limit: uploads.CHUNK_SIZE, inflate: false });

/** 본문(청크)을 메모리로 받는다. 끊기거나 형식이 다르면 던진다 */
const bodyOf = (req: Request, res: Response) =>
  new Promise<Buffer>((resolve, reject) => {
    readChunk(req, res, (error?: unknown) => (error ? reject(error) : Buffer.isBuffer(req.body) ? resolve(req.body) : reject(new Error("청크가 application/octet-stream이 아님"))));
  });

/** 청크 길이(Content-Length)의 문제. 명시하지 않았으면 bad-request, 청크 상한이나 선언한 크기를 넘으면 payload-too-large */
function lengthProblem(req: Request, one: uploads.Upload): "bad-request" | "payload-too-large" | null {
  const declared = String(req.headers["content-length"] ?? "");
  if (req.headers["transfer-encoding"] !== undefined || !OFFSET.test(declared)) return "bad-request";
  const length = Number(declared);
  return length < 1 || length > uploads.CHUNK_SIZE || one.received + length > one.size ? "payload-too-large" : null;
}

/** busy로 잡은 업로드에 이 요청의 청크를 받아 쓰고 응답한다 */
async function receiveChunk(req: Request, res: Response, one: uploads.Upload) {
  const problem = lengthProblem(req, one);
  if (problem) return sendProblem(res, problem);
  let chunk: Buffer;
  try {
    chunk = await bodyOf(req, res);
  } catch (error) {
    // 업로드하던 사용자가 연결을 끊었다. 세션이 끝나 봇이 끊은 것이면 debug(그 사용자 문제라 봇에는 영향이 없다)
    log[isEnded(req) ? "debug" : "warn"]({ sub: "admin" }, `대시보드 업로드 중단(${one.purpose}, ${one.received}/${one.size}바이트): ${messageOf(error)}`);
    if (!res.headersSent && !req.destroyed) sendProblem(res, "bad-request");
    return;
  }
  if (chunk.length !== Number(req.headers["content-length"])) return sendProblem(res, "bad-request");
  try {
    assertSignedIn(req);
  } catch (error) {
    uploads.close(one);
    if (sessionEnded(res, error)) return;
    throw error;
  }
  const written = await uploads.write(one, chunk);
  if (!written.ok) return written.why === "gone" ? sendProblem(res, "upload-gone") : noSpace(res, one.purpose, written.room);
  res.json({ received: written.received } satisfies UploadProgress);
}

// ?offset=N, 본문은 청크(application/octet-stream) → { received }. 거절은 본문을 읽기 전에 한다(남은 본문은 body-limit의 closesOnUnread 예외로 Node가 읽어서 버린다)
uploadsRouter.put("/:id", chunkLimiter, async (req: Request<{ id: string }>, res) => {
  const offset = String(req.query.offset ?? "");
  if (!OFFSET.test(offset) || !Number.isSafeInteger(Number(offset))) return sendProblem(res, "bad-request");
  const begun = uploads.begin(req.params.id, req.sessionID, Number(offset));
  if (!begun.ok) return begun.why === "gone" ? sendProblem(res, "upload-gone") : sendProblem(res, "upload-offset", { received: begun.received });
  try {
    await receiveChunk(req, res, begun.upload);
  } finally {
    uploads.release(begun.upload);
  }
});

// → { received, size }. 화면이 이어 올리기 전에 묻는다
uploadsRouter.get("/:id", (req: Request<{ id: string }>, res) => {
  const one = uploads.find(req.params.id, req.sessionID);
  if (!one) return sendProblem(res, "upload-gone");
  res.json({ received: one.received, size: one.size } satisfies UploadStatus);
});

// 화면이 그만두었다(취소, 실패). 모르는 업로드여도 204
uploadsRouter.delete("/:id", (req: Request<{ id: string }>, res) => {
  uploads.cancel(req.params.id, req.sessionID);
  res.status(204).end();
});

export { uploadsRouter };
