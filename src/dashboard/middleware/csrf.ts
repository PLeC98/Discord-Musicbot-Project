import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { sendProblem } from "../problem.ts";
import { sessionCookieName } from "../cookies.ts";

// 세션에 토큰을 두고 헤더(x-csrf-token)로 받은 값과 맞춘다. 라우트를 걸기 전에 app.use 로
// 통째로 씌우므로 상태를 바꾸는 경로가 이 검사 밖으로 새지 않는다.
//
// CodeQL 의 js/missing-token-validation 은 알려진 패키지(csurf 등)만 알아봐 이 파일을 경고한다.
// csurf 는 관리가 끊겨 쓰지 않는다.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function ensureCsrfToken(req: Request) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("base64url");
  }
  return req.session.csrfToken;
}

function issueCsrfToken(req: Request, res: Response) {
  if (!req.session?.user) {
    return sendProblem(res, "login-required");
  }

  res.set("Cache-Control", "no-store");
  return res.json({ csrfToken: ensureCsrfToken(req) });
}

// 요청에 이 연결의 세션 쿠키가 실렸는지 확인한다
function carriesSessionCookie(req: Request) {
  const name = `${sessionCookieName(req.secure)}=`;
  return (req.headers.cookie ?? "").split(";").some((part) => part.trim().startsWith(name));
}

function requireCsrfToken(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  // 끝난 세션의 로그아웃은 보호할 상태가 없어 이 브라우저의 쿠키만 삭제한다. 단, 세션 쿠키가 실린 요청만 허용한다: 교차 사이트 POST에는 lax 쿠키가 실리지 않으므로
  // 쿠키 없는 요청까지 허용하면 다른 사이트의 폼이 이 브라우저의 로그인 쿠키를 삭제하게 된다(강제 로그아웃)
  if (req.path === "/auth/logout" && !req.session?.user && carriesSessionCookie(req)) return next();

  const expected = req.session?.csrfToken;
  const supplied = req.get("x-csrf-token");
  if (typeof expected !== "string" || typeof supplied !== "string") {
    return sendProblem(res, "bad-csrf-token");
  }

  // 길이를 먼저 잰다. timingSafeEqual 은 길이가 다르면 던진다.
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return sendProblem(res, "bad-csrf-token");
  }

  return next();
}

export { ensureCsrfToken, issueCsrfToken, requireCsrfToken };
