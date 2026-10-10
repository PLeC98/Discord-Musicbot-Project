import type { NextFunction, Request, Response } from "express";
import { sendProblem } from "../problem.ts";
import { RECENT_LOGIN_MS } from "../contract/identity.ts";

// 위험한 조작(비밀값 · 주소 바꾸기, 내보내기 · 가져오기)은 로그인한 지 10분 안이어야 한다.
// 훔친 로그인 쿠키(7일)로는 이 조작을 못 하게 디스코드 로그인을 다시 거치게 한다. 로그인 시각은 OAuth 콜백이 세션을 새로 만들 때 적는다.
// 세션은 살아 있으므로 401(세션 끝)이 아니라 reauth-required(403). 화면은 새 창에서 다시 로그인하게 하고 고치던 내용은 그대로 둔다
function requireRecentLogin<P>(req: Request<P>, res: Response, next: NextFunction) {
  if (!req.session?.user) return sendProblem(res, "login-required");
  const at = req.session.loginAt;
  if (typeof at !== "number" || Date.now() - at > RECENT_LOGIN_MS) return sendProblem(res, "reauth-required");
  next();
}

export { requireRecentLogin, RECENT_LOGIN_MS };
