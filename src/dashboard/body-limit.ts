/**
 * 본문 크기 상한. 대부분은 설정 몇 줄과 공지문(4096자)뿐이라 32kb 면 넉넉하다.
 * 판정 프롬프트만 예외다: 로어북을 붙인 긴 프롬프트가 32kb 를 넘어 413 이 났다.
 */
import express, { type NextFunction, type Request, type Response } from "express";

// 프롬프트를 싣는 경로. 저장은 AI 설정과 한 요청(/ai/settings)이다
const PROMPT_PATHS = ["/api/admin/ai/settings", "/api/admin/ai/tokens", "/api/admin/ai/preview", "/api/admin/ai/judge/run"];

function bodyLimit() {
  const small = express.json({ limit: "32kb" });
  const prompt = express.json({ limit: "1mb" });
  return (req: Request, res: Response, next: NextFunction) => (PROMPT_PATHS.includes(req.path) ? prompt : small)(req, res, next);
}

export { bodyLimit, PROMPT_PATHS };
