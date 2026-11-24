// AI 판정 프롬프트("ai-prompt" 문서)의 섹션과 검사. 저장 경로(dashboard)와 화면이 같이 쓴다. 자리표시자는 rules/line-format

import { PROMPT_NAMES, parseFormat, usesName } from "../../rules/line-format.ts";
import { rule, type RuleProblem } from "../../rules/rule-problem.ts";

/** 프롬프트 섹션 하나. 역할(system, user, assistant)과 내용 */
type PromptSection = { role: string; text: string };

const AI_ROLES = ["system", "user", "assistant"];

/** 프롬프트에서 후보 목록이 들어갈 위치 */
const LIST_MARK = "{{list}}";

const textOf = (section: unknown) => String((section as { text?: unknown } | null)?.text ?? "");

/** 후보 목록이 들어갈 위치({{list}})가 어느 섹션에든 있는가(블록 안 포함). 없으면 모델은 무엇을 판정할지 모른다 */
const hasListMark = (sections: readonly unknown[]) => sections.some((section) => usesName(parseFormat(textOf(section), PROMPT_NAMES).nodes, "list"));

/** 프롬프트의 문제 목록. 비우면 기본 구성을 쓰므로 적었을 때만 따진다. on: AI 보조가 켜져 있다(후보 목록 위치가 있어야 한다) */
function promptProblems(prompt: unknown, on: boolean): RuleProblem[] {
  if (prompt == null) return [];
  if (!Array.isArray(prompt)) return [rule("prompt-shape")];
  if (!prompt.length) return [];

  const problems: RuleProblem[] = [];
  prompt.forEach((item: unknown, i) => {
    const section = i + 1;
    if (!item || typeof item !== "object") return problems.push(rule("prompt-section-shape", { section }));
    const one = item as { role?: unknown; text?: unknown };
    if (!AI_ROLES.includes(one.role as string)) problems.push(rule("prompt-role", { section, roles: AI_ROLES.join(", ") }));
    if (one.text != null && typeof one.text !== "string") problems.push(rule("prompt-text", { section }));
    else for (const found of parseFormat(textOf(one), PROMPT_NAMES).problems) problems.push(rule("prompt-format", { section, at: found.at + 1 }, found.rule));
    // 역할 표시 문자열은 넣지 못하게 한다. ChatML 템플릿으로 프롬프트를 짜는 모델에 섹션 경계로 섞여 들어가지 않게
    if (/<\|im_(start|end)\|>/.test(String(one?.text ?? ""))) problems.push(rule("prompt-chatml", { section }));
  });

  // 켜 둔 채 후보 목록 위치가 없으면 요청마다 헛돈다
  if (on && !hasListMark(prompt)) problems.push(rule("prompt-needs-list", { mark: LIST_MARK }));
  return problems;
}

export { AI_ROLES, LIST_MARK, hasListMark, promptProblems };
export type { PromptSection };
