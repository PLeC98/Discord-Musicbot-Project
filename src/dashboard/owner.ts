import type { Request } from "express";
import { isBotOwner } from "../usecases/permissions.ts";

/**
 * 봇 운영자(앱 소유자, OWNER_ID 가 있으면 그것. usecases/app-owners) 여부를 요청마다 지금 값으로 다시 판정한다.
 * 디스코드 서버 쪽 권한(서버 관리)과는 다른 개념이다(그쪽은 `isServerManager`).
 *
 * 로그인 시점 값을 세션에 굳혀두면 운영자에서 빠져도 기존 세션의 권한이 철회되지 않는다.
 * 세션은 SQLite에 남고 쿠키 수명이 7일이라, 고정 `SESSION_SECRET`이면 다시 시작도 견딘다.
 */
function isRealOwner<P>(req: Request<P>) {
  const id = req.session?.user?.id;
  return !!id && isBotOwner(id);
}

export { isRealOwner };
