import type { NextFunction, Request, Response } from "express";
import type { SessionUser } from "../express-slots.d.ts";
import { sendProblem } from "../problem.ts";

// 경로 인자 타입(P)은 경로 문자열에서 추론되게 받는 쪽이 정하지 않는다
function requireAuth<P>(req: Request<P>, res: Response, next: NextFunction) {
  if (!req.session?.user) return sendProblem(res, "login-required");
  next();
}

/** 로그인 확인(requireAuth · requireOwner)을 지난 요청의 사용자 */
function signedIn<P>(req: Request<P>): SessionUser {
  const user = req.session.user;
  if (!user) throw new Error("로그인 확인을 지나지 않은 경로가 사용자를 읽었다");
  return user;
}

export { requireAuth, signedIn };
