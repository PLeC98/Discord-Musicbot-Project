/**
 * 본문 크기 상한. 대부분은 설정 몇 줄과 공지문(4096자)뿐이라 32kb 면 넉넉하다.
 * 판정 프롬프트와 캐시 DB 쓰기만 예외다: 로어북을 붙인 긴 프롬프트가 32kb 를 넘어 413 이 났고, 캐시 DB 쓰기는 조작을 200개까지 싣는다.
 */
import express, { type NextFunction, type Request, type Response } from "express";

// 큰 본문을 싣는 경로. 프롬프트 저장은 AI 설정과 한 요청(/ai/settings)이다
const LARGE_PATHS = ["/api/admin/ai/settings", "/api/admin/ai/tokens", "/api/admin/ai/preview", "/api/admin/ai/judge/run", "/api/admin/track-cache"];

function bodyLimit() {
  const small = express.json({ limit: "32kb" });
  const large = express.json({ limit: "1mb" });
  // 끝의 / 는 express 가 같은 경로로 받는다
  return (req: Request, res: Response, next: NextFunction) => (LARGE_PATHS.includes(req.path.replace(/(?<=.)\/$/, "")) ? large : small)(req, res, next);
}

export { bodyLimit, LARGE_PATHS };
