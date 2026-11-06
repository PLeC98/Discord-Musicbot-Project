// 대시보드가 붙이는 쿠키(로그인 세션, OAuth 로그인)의 이름과 속성. 한 곳에서 정해 붙이는 쪽과 지우는 쪽이 같은 이름, 같은 속성을 쓴다.
// OAuth 로그인 쿠키는 요청이 HTTPS 면(믿는 프록시가 알린 것 포함, req.secure) __Host- 이름에 Secure 를 붙인다:
// 다른 하위 도메인이 같은 이름으로 심지 못한다(RFC 6265bis 4.1.3.2). 평문이면 그 이름을 쓸 수 없어 일반 이름이다

import type { Request, Response } from "express";
import config from "../config/index.ts";

/** 로그인 세션 쿠키의 이름(express-session 의 기본 이름) */
const SESSION_COOKIE = "connect.sid";

/** 이 브라우저의 로그인 세션 쿠키를 지운다. 세션 미들웨어가 붙인 쿠키와 이름, 경로가 같아야 지워진다 */
function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax" });
}

/** OAuth 로그인(state, 팝업 여부)을 콜백까지 들고 가는 쿠키의 수명. 디스코드 승인 화면에서 돌아올 때까지 */
const LOGIN_COOKIE_MS = 10 * 60_000;

// 같은 호스트에서 포트만 다른 봇끼리 겹치지 않게 앱(클라이언트 ID)을 붙인다. 쿠키는 포트를 가르지 않는다
const loginCookieName = (secure: boolean) => `${secure ? "__Host-" : ""}musicbot-login-${config.discord.clientId}`;
// SameSite=Lax: 디스코드에서 돌아오는 최상위 GET 에 실린다
const loginCookieOptions = (secure: boolean) => ({ path: "/", httpOnly: true, sameSite: "lax" as const, secure });

/** OAuth 로그인 쿠키를 붙인다 */
function setLoginCookie(req: Request, res: Response, value: string) {
  res.cookie(loginCookieName(req.secure), value, { ...loginCookieOptions(req.secure), maxAge: LOGIN_COOKIE_MS });
}

/** OAuth 로그인 쿠키를 읽고 지운다(콜백의 모든 길에서). 없으면 null */
function takeLoginCookie(req: Request, res: Response): string | null {
  const name = loginCookieName(req.secure);
  res.clearCookie(name, loginCookieOptions(req.secure));
  return cookieValue(req, name);
}

// 요청의 Cookie 헤더에서 이름 하나의 값. 쿠키 파서를 따로 두지 않는다
function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export { SESSION_COOKIE, LOGIN_COOKIE_MS, clearSessionCookie, setLoginCookie, takeLoginCookie };
