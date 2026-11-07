// 대시보드가 붙이는 쿠키(로그인 세션, OAuth 로그인)의 이름과 속성. 한 곳에서 정해 붙이는 쪽과 삭제하는 쪽이 같은 이름, 같은 속성을 쓴다.
// 요청이 HTTPS면(신뢰하는 프록시가 알린 경우 포함, req.secure) __Host- 접두사와 Secure 속성을 붙인다: 다른 하위 도메인이 같은 이름으로 쿠키를 심거나
// 더 긴 경로로 가리지 못한다(RFC 6265bis 4.1.3.2). 평문 HTTP에서는 __Host- 접두사를 쓸 수 없으므로 일반 이름을 쓴다(기존 HTTP 환경에서 로그인이 막히지 않게 한다).
// 같은 호스트에서 포트만 다른 봇끼리 겹치지 않게 클라이언트 ID를 붙인다. 쿠키는 포트를 구분하지 않는다

import type { Request, Response } from "express";
import config from "../config/index.ts";

/** 로그인 세션 쿠키의 이름. secure: HTTPS 요청 여부(세션 미들웨어가 요청마다 선택한다, dashboard/index) */
const sessionCookieName = (secure: boolean) => `${secure ? "__Host-" : ""}musicbot-session-${config.discord.clientId}`;

/** 이 브라우저의 로그인 세션 쿠키를 삭제한다. 세션 미들웨어가 붙인 쿠키와 이름, 경로, Secure가 같아야 삭제된다 */
function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(sessionCookieName(req.secure), { path: "/", httpOnly: true, sameSite: "lax", secure: req.secure });
}

/** OAuth 로그인(state, 팝업 여부)을 콜백까지 들고 가는 쿠키의 수명. 디스코드 승인 화면에서 돌아올 때까지 */
const LOGIN_COOKIE_MS = 10 * 60_000;

const loginCookieName = (secure: boolean) => `${secure ? "__Host-" : ""}musicbot-login-${config.discord.clientId}`;
// SameSite=Lax: 디스코드에서 돌아오는 최상위 GET에 실린다
const loginCookieOptions = (secure: boolean) => ({ path: "/", httpOnly: true, sameSite: "lax" as const, secure });

/** OAuth 로그인 쿠키를 붙인다 */
function setLoginCookie(req: Request, res: Response, value: string) {
  res.cookie(loginCookieName(req.secure), value, { ...loginCookieOptions(req.secure), maxAge: LOGIN_COOKIE_MS });
}

/** OAuth 로그인 쿠키를 읽고 삭제한다(콜백의 모든 분기에서). 없으면 null */
function takeLoginCookie(req: Request, res: Response): string | null {
  const name = loginCookieName(req.secure);
  res.clearCookie(name, loginCookieOptions(req.secure));
  return cookieValue(req, name);
}

// 요청의 Cookie 헤더에서 지정한 이름의 쿠키 값을 읽는다. 쿠키 파서를 따로 두지 않는다
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

export { sessionCookieName, LOGIN_COOKIE_MS, clearSessionCookie, setLoginCookie, takeLoginCookie };
