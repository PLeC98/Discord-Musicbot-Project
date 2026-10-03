import type { NextFunction, Request, Response } from "express";
import { isRealOwner } from "../owner.ts";
import { sendProblem } from "../problem.ts";

// 봇 운영자(OWNER_ID) 전용 게이트. 디스코드 서버 쪽 권한과는 무관하다.
// 그쪽은 permissions.ts의 isModerator가 다룬다.
// 권한 수준 오버라이드를 무시하는 것은 의도적이다: 오버라이드 해제 수단이 이 라우터 안에 있어서,
// 여기까지 낮추면 운영자가 스스로를 잠근다.
function requireOwner<P>(req: Request<P>, res: Response, next: NextFunction) {
  if (!req.session?.user) return sendProblem(res, "login-required");
  if (!isRealOwner(req)) return sendProblem(res, "must-owner");
  next();
}

export { requireOwner };
