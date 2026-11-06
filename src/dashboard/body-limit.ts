/**
 * 요청 본문: 받기 시작(100-continue), JSON 크기 상한, 다 받지 않은 채 하는 응답.
 * 크기: 대부분은 설정 몇 줄과 공지문(4096자)뿐이라 32kb 면 넉넉하다.
 * 판정 프롬프트(로어북을 붙이면 32kb 를 넘는다)와 캐시 DB 쓰기(조작을 200개까지 싣는다)만 1mb 다.
 */
import express, { type NextFunction, type Request, type Response } from "express";

// 본문을 읽지 않는 메서드
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// 큰 본문을 싣는 경로. 프롬프트 저장은 AI 설정과 한 요청(/ai/settings)이다
const LARGE_PATHS = ["/api/admin/ai/settings", "/api/admin/ai/tokens", "/api/admin/ai/preview", "/api/admin/ai/judge/run", "/api/admin/track-cache"];

function bodyLimit() {
  const small = express.json({ limit: "32kb" });
  const large = express.json({ limit: "1mb" });
  // 끝의 / 는 express 가 같은 경로로 받는다
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    return (LARGE_PATHS.includes(req.path.replace(/(?<=.)\/$/, "")) ? large : small)(req, res, next);
  };
}

/** 본문을 싣는다고 알린 요청인가 */
const announcesBody = (req: Request) => Number(req.headers["content-length"] ?? 0) > 0 || req.headers["transfer-encoding"] !== undefined;

/**
 * 본문을 다 받지 않은 채 응답하면(본문을 읽기 전에 거절했거나, 본문을 읽지 않는 경로) 그 연결을 닫는다.
 * 닫지 않으면 Node 가 다음 요청을 받으려고 남은 본문을 끝까지 받는다(크기 상한이 없다). 응답 헤더를 쓰는 때에 보므로 맨 앞에 둔다
 */
function closeOnUnreadBody(req: Request, res: Response, next: NextFunction) {
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: unknown[]) {
    if (announcesBody(req) && !req.complete) {
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
  if (/100-continue/i.test(req.headers.expect ?? "") && !res.headersSent) res.writeContinue();
  next();
}

export { bodyLimit, closeOnUnreadBody, continueBody, LARGE_PATHS };
