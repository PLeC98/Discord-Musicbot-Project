import type { NextFunction, Request, Response } from "express";
import { sendProblem } from "../problem.ts";

// 탭이 생각하는 사용자(화면이 싣는 X-Dashboard-User, 헤더를 못 싣는 스트림은 uid 쿼리)와 세션의 사용자가 다르면 409 account-changed.
// 쿠키는 브라우저의 탭이 함께 쓰므로, 다른 탭에서 다른 계정으로 로그인하면 옛 계정 화면이 남은 탭의 요청이 새 계정으로 간다
// (CSRF 거절 뒤 새 토큰으로 다시 보내기, 다른 계정으로 다시 로그인한 뒤 기다리던 조작 다시 보내기, 숨긴 탭의 스트림 다시 열기).
// 접근 통제가 아니라 사용자의 뜻을 지키는 것이다: 싣지 않은 요청(주소로 여는 내려받기)은 보지 않는다. CSRF 검사보다 앞에 둔다
//   보지 않는 곳  /api/me(계정을 알아보는 요청), /auth/logout(이 브라우저의 로그아웃은 어느 탭에서 눌러도 지금 쿠키를 끝낸다)

const UNCHECKED = new Set(["/api/me", "/auth/logout"]);
/** 헤더를 싣지 못하는 스트림(EventSource). 이 경로에서만 uid 쿼리를 본다 */
const STREAMS = new Set(["/api/guilds/events", "/api/admin/logs/stream", "/api/admin/ai/logs/stream"]);

function requireSameAccount(req: Request, res: Response, next: NextFunction) {
  if (UNCHECKED.has(req.path)) return next();
  const header = req.get("x-dashboard-user");
  const expected = header ?? (STREAMS.has(req.path) && typeof req.query.uid === "string" ? req.query.uid : undefined);
  const user = req.session?.user;
  if (expected && user && expected !== user.id) return sendProblem(res, "account-changed");
  next();
}

export { requireSameAccount };
