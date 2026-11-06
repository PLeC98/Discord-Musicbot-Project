// 로그인 세션 쿠키의 이름과 지우기. 세션 미들웨어(dashboard/index)와 로그아웃이 같은 이름을 쓴다

import type { Response } from "express";

/** 로그인 세션 쿠키의 이름(express-session 의 기본 이름) */
const SESSION_COOKIE = "connect.sid";

/** 이 브라우저의 로그인 세션 쿠키를 지운다. 세션 미들웨어가 붙인 쿠키와 이름, 경로가 같아야 지워진다 */
function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "lax" });
}

export { SESSION_COOKIE, clearSessionCookie };
