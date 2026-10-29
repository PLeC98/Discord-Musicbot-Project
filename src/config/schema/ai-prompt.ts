// AI 판정 프롬프트("ai-prompt" 문서)의 섹션과 검사. 저장 경로(dashboard)와 화면이 같이 쓴다. 자리표시자는 rules/line-format

import { PROMPT_NAMES, parseFormat, usesName } from "../../rules/line-format.ts";

/** 프롬프트 섹션 하나. 역할(system · user · assistant)과 내용 */
type PromptSection = { role: string; text: string };

const AI_ROLES = ["system", "user", "assistant"];

/** 프롬프트에서 후보 목록이 들어갈 위치 */
const LIST_MARK = "{{list}}";

const textOf = (section: unknown) => String((section as { text?: unknown } | null)?.text ?? "");

/** 후보 목록이 들어갈 위치({{list}})가 어느 섹션에든 있는가(블록 안 포함). 없으면 모델은 무엇을 판정할지 모른다 */
const hasListMark = (sections: readonly unknown[]) => sections.some((section) => usesName(parseFormat(textOf(section), PROMPT_NAMES).nodes, "list"));

/** 프롬프트의 문제 목록. 비우면 기본 구성을 쓰므로 적었을 때만 따진다. on: AI 보조가 켜져 있다(후보 목록 위치가 있어야 한다) */
function promptProblems(prompt: unknown, on: boolean): string[] {
  if (prompt == null) return [];
  if (!Array.isArray(prompt)) return ["프롬프트는 섹션 목록이어야 합니다(역할과 내용을 가진 항목들)."];
  if (!prompt.length) return [];

  const problems: string[] = [];
  prompt.forEach((item: unknown, i) => {
    const where = `${i + 1}번째 섹션`;
    if (!item || typeof item !== "object") return problems.push(`${where}: 역할과 내용을 적어야 합니다.`);
    const section = item as { role?: unknown; text?: unknown };
    if (!AI_ROLES.includes(section.role as string)) problems.push(`${where}: 역할은 ${AI_ROLES.join(" · ")} 중 하나여야 합니다.`);
    if (section.text != null && typeof section.text !== "string") problems.push(`${where}: 내용은 글로 적어야 합니다.`);
    else for (const one of parseFormat(textOf(section), PROMPT_NAMES).problems) problems.push(`${where} ${one.at + 1}번째 글자: ${one.message}`);
    // 역할 표시 문자열은 넣지 못하게 한다. ChatML 템플릿으로 프롬프트를 짜는 모델에 섹션 경계로 섞여 들어가지 않게
    if (/<\|im_(start|end)\|>/.test(String(section?.text ?? ""))) problems.push(`${where}: 내용에 <|im_start|>·<|im_end|> 를 적을 수 없습니다.`);
  });

  // 켜 둔 채 후보 목록 위치가 없으면 요청마다 헛돈다
  if (on && !hasListMark(prompt)) problems.push(`어딘가에 ${LIST_MARK} 이 있어야 합니다. 그 위치에 판정할 후보가 들어갑니다.`);
  return problems;
}

export { AI_ROLES, LIST_MARK, hasListMark, promptProblems };
export type { PromptSection };
