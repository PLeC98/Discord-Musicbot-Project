// AI 보조 설정과 프롬프트(settings.db 의 "ai" · "ai-prompt" 문서, config/documents). 키는 비밀 표에 있다(store/ai-keys).

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
import * as documents from "./documents.ts";
import { aiProblems } from "./schema/ai.ts";
import { promptProblems, type PromptSection } from "./schema/ai-prompt.ts";

const validateAi = aiProblems;

/** AI 설정 문서. 맨 위는 늘 표다 */
type ConfigData = Record<string, unknown>;

/** 지금 프롬프트. 비면 빈 목록(부르는 쪽이 기본 구성을 쓴다). 모양이 틀린 문서도 빈 목록이다 */
function aiPrompt(): PromptSection[] {
  const data = documents.get("ai-prompt");
  return Array.isArray(data) && !promptProblems(data, false).length ? (data as PromptSection[]) : [];
}

// ── AI 설정 ─────────────────────────────────────────────────────────────

// 상태와 같은 처지다. 곡을 선택할 때마다 읽히므로 던지지 않는다.
// 던지면 자동재생이 통째로 멈춘다. AI는 없어도 되는 기능이라 그건 과하다.
let aiWarned = "";

/** 읽은 그대로의 AI 설정. 문제가 있으면 enabled: false 를 얹는다 */
function ai(): ConfigData {
  const raw = documents.get("ai");
  const data = (raw && typeof raw === "object" ? raw : {}) as ConfigData;

  const problems = validateAi(data);
  const key = problems.join("|");
  if (problems.length && key !== aiWarned) log.warn(`AI 보조 설정: ${problems.join(" / ")}`);
  aiWarned = key;

  // 하나라도 어긋나면 켜지 않는다. 반만 맞는 설정으로 부르면 매번 실패하고 로그만 쌓인다
  return problems.length ? { ...data, enabled: false } : data;
}

export { ai, aiPrompt, validateAi };
export type { ConfigData };
