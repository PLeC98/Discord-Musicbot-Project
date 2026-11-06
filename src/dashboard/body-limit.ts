/**
 * 요청 본문: 받기 시작(100-continue), JSON 크기 상한, 다 받지 않은 채 하는 응답.
 * 크기: 대부분은 설정 몇 줄과 공지문(4096자)뿐이라 32kb 면 넉넉하다.
 * 판정 프롬프트(로어북을 붙이면 32kb 를 넘는다)와 캐시 DB 쓰기(조작을 200개까지 싣는다)만 1mb 다.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import { sendProblem } from "./problem.ts";

// 본문을 읽지 않는 메서드
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// 본문을 읽는 경로는 /api 뿐이다(로그인, 로그아웃은 읽지 않는다). Express 처럼 대소문자를 가리지 않는다
const API = /^\/api(?:\/|$)/i;
const SMALL = 32 * 1024;
const LARGE = 1024 * 1024;

// 큰 본문을 싣는 경로. 프롬프트 저장은 AI 설정과 한 요청(/ai/settings)이다
const LARGE_PATHS = ["/api/admin/ai/settings", "/api/admin/ai/tokens", "/api/admin/ai/preview", "/api/admin/ai/judge/run", "/api/admin/track-cache"];

/** 이 요청의 JSON 본문 상한(바이트). JSON 본문을 푸는 요청이 아니면 null(이미지, 백업 같은 업로드는 그 경로가 자기 상한으로 읽는다) */
function jsonLimitOf(req: Request): number | null {
  if (SAFE_METHODS.has(req.method) || !API.test(req.path) || !req.is("application/json")) return null;
  // 끝의 / 는 express 가 같은 경로로 받는다
  return LARGE_PATHS.includes(req.path.replace(/(?<=.)\/$/, "")) ? LARGE : SMALL;
}

/** 알린 길이가 상한을 넘는가 */
const declaredOver = (req: Request, limit: number) => Number(req.headers["content-length"] ?? 0) > limit;

function bodyLimit() {
  const small = express.json({ limit: SMALL });
  const large = express.json({ limit: LARGE });
  return (req: Request, res: Response, next: NextFunction) => {
    const limit = jsonLimitOf(req);
    if (limit === null) return next();
    // 알린 길이가 넘으면 받지 않고 곧바로(body-parser 는 413 전에 남은 본문을 끝까지 받는다. 이 응답은 연결을 닫는다)
    if (declaredOver(req, limit)) return sendProblem(res, "payload-too-large");
    (limit === LARGE ? large : small)(req, res, next);
    // 길이를 알리지 않은(덩어리) 본문이 넘으면 연결을 끊는다(같은 까닭. 이때는 답을 보내지 못한다)
    if (req.headers["content-length"] === undefined && req.headers["transfer-encoding"] !== undefined) {
      let received = 0;
      req.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > limit) req.socket.destroy();
      });
    }
  };
}

/** 다 받지 않은 본문을 Node 가 받아 버리게 두는 상한(알린 길이). 이보다 작으면 연결을 이어 쓰고 답이 제대로 닿는다(정상 본문은 대개 32KB 아래) */
const DRAIN_MAX = 64 * 1024;

/**
 * 다 받지 않은 본문이 남았을 때 닫을 요청인가: 요청 제한에 걸렸거나(받아 버리면 걸린 뒤에도 본문을 받는다), 본문을 받을 일이 없는 메서드이거나,
 * 알린 길이가 DRAIN_MAX 를 넘거나, 길이를 알리지 않았다(덩어리)
 */
function closesOnUnread(req: Request, status: number) {
  if (req.complete) return false;
  if (status === 429 || SAFE_METHODS.has(req.method) || req.headers["transfer-encoding"] !== undefined) return true;
  return Number(req.headers["content-length"] ?? 0) > DRAIN_MAX;
}

/**
 * 본문을 다 받지 않은 채 응답하면(본문을 읽기 전에 거절했거나, 본문을 읽지 않는 경로) 남은 것이 클 때 그 연결을 닫는다.
 * 닫지 않으면 Node 가 다음 요청을 받으려고 남은 본문을 끝까지 받는다(크기 상한이 없다). 작으면 받아 버리게 둔다(닫으면 올리는 도중의
 * 브라우저가 답 대신 연결 끊김을 본다). 응답 헤더를 쓰는 때에 보므로 맨 앞에 둔다
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
 * 100-continue 를 기다리는 요청에 100 을 보낸다. 검사(요청 제한, CSRF, 운영자)를 다 지나 본문을 읽기 바로 앞에 둔다.
 * 서버가 100 을 미리 보내지 않게 checkContinue 를 받는다(binding 의 listen). 거절된 요청은 100 없이 닫힌다
 */
function continueBody(req: Request, res: Response, next: NextFunction) {
  if (API.test(req.path) && /100-continue/i.test(req.headers.expect ?? "") && !res.headersSent) {
    // 상한을 넘을 JSON 은 100 없이 413 으로 닫는다(bodyLimit)
    const limit = jsonLimitOf(req);
    if (limit === null || !declaredOver(req, limit)) res.writeContinue();
  }
  next();
}

export { bodyLimit, closeOnUnreadBody, continueBody, LARGE_PATHS };
