/**
 * 본문 크기 상한 — 대부분은 설정 몇 줄과 공지문(4096자)뿐이라 32kb 면 넉넉하다.
 * 판정 프롬프트만 예외다: 로어북을 붙인 긴 프롬프트가 32kb 를 넘어 413 이 났다.
 */
const express = require("express");

const PROMPT_PATHS = ["/api/admin/ai/prompt", "/api/admin/ai/tokens", "/api/admin/ai/preview", "/api/admin/ai/test", "/api/admin/ai/judge/run"];

function bodyLimit() {
  const small = express.json({ limit: "32kb" });
  const prompt = express.json({ limit: "1mb" });
  // 테스트는 라우터를 /api/admin 에 직접 붙이기도 한다 — 그때는 경로가 /ai/... 로 온다
  const isPrompt = (path) => PROMPT_PATHS.includes(path) || PROMPT_PATHS.includes(`/api/admin${path}`);
  return (req, res, next) => (isPrompt(req.path) ? prompt : small)(req, res, next);
}

module.exports = { bodyLimit, PROMPT_PATHS };
