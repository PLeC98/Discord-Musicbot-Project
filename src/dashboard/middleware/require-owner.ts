import type { NextFunction, Request, Response } from "express";
import { isRealOwner } from "../owner.ts";
import { sendProblem } from "../problem.ts";
import { assertSignedIn, markOperator } from "../session-requests.ts";

// 봇 운영자 전용 게이트(운영자는 앱 소유자, OWNER_ID 가 있으면 그것. usecases/app-owners). 디스코드 서버 쪽 권한과는 무관하다.
// 그쪽은 permissions.ts의 isServerManager가 다룬다. 통과한 요청은 운영자 전용으로 적어 운영자에서 빠지면 멈춘다(session-requests)
// 권한 수준 오버라이드를 무시하는 것은 의도적이다: 오버라이드 해제 수단이 이 라우터 안에 있어서,
// 여기까지 낮추면 운영자가 스스로를 잠근다.
function requireOwner<P>(req: Request<P>, res: Response, next: NextFunction) {
  if (!req.session?.user) return sendProblem(res, "login-required");
  assertSignedIn(req as Request);
  if (!isRealOwner(req)) return sendProblem(res, "must-owner");
  markOperator(req as Request);
  next();
}

export { requireOwner };
