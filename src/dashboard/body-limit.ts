/**
 * 요청 본문: 받기 시작(100-continue), JSON 크기 상한, 다 받지 않은 채 하는 응답.
 * 크기: 대부분은 설정 몇 줄과 공지문(4096자)뿐이라 32kb면 넉넉하다.
 * 판정 프롬프트(로어북을 붙이면 32kb 를 넘는다)와 캐시 DB 쓰기(조작을 200개까지 싣는다)만 1mb 다.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { sendProblem } from "./problem.ts";
import { CHUNK_SIZE } from "./uploads.ts";
import { isRealOwner } from "./owner.ts";

// 본문을 읽지 않는 메서드
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// 본문을 읽는 경로는 /api뿐이다(로그인, 로그아웃은 읽지 않는다). Express처럼 대소문자를 가리지 않는다
const API = /^\/api(?:\/|$)/i;
const SMALL = 32 * 1024;
const LARGE = 1024 * 1024;

// 큰 본문을 싣는 경로. 프롬프트 저장은 AI 설정과 한 요청(/ai/settings)이다
const LARGE_PATHS = ["/api/admin/ai/settings", "/api/admin/ai/tokens", "/api/admin/ai/preview", "/api/admin/ai/judge/run", "/api/admin/track-cache"];

/** 이 요청의 JSON 본문 상한(바이트). JSON 본문을 파싱하는 요청이 아니면 null(이미지, 백업 같은 업로드는 각 경로가 자체 상한으로 읽는다) */
function jsonLimitOf(req: Request): number | null {
  if (SAFE_METHODS.has(req.method) || !API.test(req.path) || !req.is("application/json")) return null;
  // 끝의 / 는 express 가 같은 경로로 받는다
  return LARGE_PATHS.includes(req.path.replace(/(?<=.)\/$/, "")) ? LARGE : SMALL;
}

/** 헤더에 명시된 길이(Content-Length)가 상한을 넘는가 */
const declaredOver = (req: Request, limit: number) => Number(req.headers["content-length"] ?? 0) > limit;

function bodyLimit() {
  const small = express.json({ limit: SMALL });
  const large = express.json({ limit: LARGE });
  return (req: Request, res: Response, next: NextFunction) => {
    const limit = jsonLimitOf(req);
    if (limit === null) return next();
    // 명시된 길이가 상한을 넘으면 본문을 받지 않고 곧바로 거절한다(body-parser는 413을 보내기 전에 남은 본문을 끝까지 읽는다. 이 응답은 연결을 닫는다)
    if (declaredOver(req, limit)) return sendProblem(res, "payload-too-large");
    (limit === LARGE ? large : small)(req, res, next);
    // 길이를 명시하지 않은(청크 전송) 본문이 상한을 넘으면 연결을 끊는다(같은 까닭이며, 이때는 응답을 보내지 못한다)
    if (req.headers["content-length"] === undefined && req.headers["transfer-encoding"] !== undefined) {
      let received = 0;
      req.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > limit) req.socket.destroy();
      });
    }
  };
}

/** 덜 읽은 본문을 Node가 마저 읽어 비우게(drain) 두는 상한(Content-Length 기준). 이보다 작으면 연결을 유지해 응답이 정상적으로 전달된다(정상 본문은 대개 32KB 미만) */
const DRAIN_MAX = 64 * 1024;

// 큰 파일 업로드의 청크(dashboard/uploads, routes/uploads)
const CHUNK_PATH = /^\/api\/admin\/uploads\/[^/]+$/i;

/**
 * 청크를 읽기 전에 거절했다(CSRF, 위치 어긋남, 크기): 운영자의 요청이고 남은 본문이 청크 하나 이하면 닫지 않고 Node가 마저 읽어 비우게 둔다.
 * 닫으면 업로드 중인 브라우저가 거절 이유 대신 연결 리셋을 본다. 운영자가 아닌 요청, 요청 제한(429), 길이를 명시하지 않은 요청은 닫는다(남의 본문을 받아 주지 않는다)
 */
function drainsChunk(req: Request, status: number) {
  if (req.method !== "PUT" || status === 429 || req.headers["transfer-encoding"] !== undefined || !isRealOwner(req)) return false;
  const length = Number(req.headers["content-length"]);
  return Number.isFinite(length) && length <= CHUNK_SIZE && CHUNK_PATH.test(req.originalUrl.split("?")[0]);
}

/**
 * 읽지 않은 본문이 남았을 때 연결을 닫을 요청인가: 요청 제한에 걸렸거나(마저 읽으면 제한에 걸린 뒤에도 본문을 끝까지 받는다), 본문을 읽지 않는 메서드이거나,
 * 명시된 길이가 DRAIN_MAX를 넘거나, 길이를 명시하지 않은(청크 전송) 요청이다
 */
function closesOnUnread(req: Request, status: number) {
  if (req.complete || drainsChunk(req, status)) return false;
  if (status === 429 || SAFE_METHODS.has(req.method) || req.headers["transfer-encoding"] !== undefined) return true;
  return Number(req.headers["content-length"] ?? 0) > DRAIN_MAX;
}

/**
 * 본문을 다 받지 않은 채 응답하면(본문을 읽기 전에 거절했거나, 본문을 읽지 않는 경로) 남은 것이 클 때 그 연결을 닫는다.
 * 닫지 않으면 Node가 다음 요청을 처리하려고 남은 본문을 끝까지 읽는다(크기 상한이 없다). 작으면 마저 읽어 비우게 둔다(닫으면 업로드 중인
 * 브라우저가 응답 대신 연결 끊김을 본다). 응답 헤더를 쓸 때 판단하므로 미들웨어 맨 앞에 둔다
 */
function closeOnUnreadBody(req: Request, res: Response, next: NextFunction) {
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: unknown[]) {
    if (closesOnUnread(req, typeof args[0] === "number" ? args[0] : this.statusCode)) {
      this.shouldKeepAlive = false;
      if (!this.headersSent) this.setHeader("Connection", "close");
    }
    return (writeHead as (...a: unknown[]) => Response).apply(this, args);
  } as Response["writeHead"];
  next();
}

/**
 * 100-continue를 기다리는 요청에 100을 보낸다. 검사(요청 제한, CSRF, 운영자)를 모두 통과한 뒤 본문을 읽기 바로 앞에 둔다.
 * 서버가 100을 미리 보내지 않게 checkContinue를 가로챈다(binding의 listen). 거절된 요청은 100 없이 닫힌다
 */
function continueBody(req: Request, res: Response, next: NextFunction) {
  if (API.test(req.path) && /100-continue/i.test(req.headers.expect ?? "") && !res.headersSent) {
    // 상한을 넘는 JSON은 100 없이 413으로 닫는다(bodyLimit)
    const limit = jsonLimitOf(req);
    if (limit === null || !declaredOver(req, limit)) res.writeContinue();
  }
  next();
}

export { bodyLimit, closeOnUnreadBody, continueBody, LARGE_PATHS };
