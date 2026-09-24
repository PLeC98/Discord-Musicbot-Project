import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

// 세션에 토큰을 두고 헤더(x-csrf-token)로 받은 값과 맞춘다. 라우트를 걸기 전에 app.use 로
// 통째로 씌우므로 상태를 바꾸는 경로가 이 검사 밖으로 새지 않는다.
//
// CodeQL 의 js/missing-token-validation 은 이 파일을 못 알아본다. 알려진 패키지(csurf 등)만
// 보기 때문이다. 그쪽으로 갈아타면 알림은 사라지지만 csurf 는 더 이상 관리되지 않는다.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function ensureCsrfToken(req: Request) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  }
  return req.session.csrfToken;
}

function issueCsrfToken(req: Request, res: Response) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  res.set("Cache-Control", "no-store");
  return res.json({ csrfToken: ensureCsrfToken(req) });
}

function requireCsrfToken(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session?.csrfToken;
  const supplied = req.get("x-csrf-token");
  if (typeof expected !== "string" || typeof supplied !== "string") {
    return res.status(403).json({ error: "Invalid CSRF token.", code: "INVALID_CSRF_TOKEN" });
  }

  // 길이를 먼저 잰다. timingSafeEqual 은 길이가 다르면 던진다.
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return res.status(403).json({ error: "Invalid CSRF token.", code: "INVALID_CSRF_TOKEN" });
  }

  return next();
}

const exported = { ensureCsrfToken, issueCsrfToken, requireCsrfToken };
export default exported;
export { exported as "module.exports" };
