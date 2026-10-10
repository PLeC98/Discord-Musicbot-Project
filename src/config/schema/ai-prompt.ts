// AI 판정 프롬프트(ai-prompt.chatml)의 섹션과 검사. 저장 경로(dashboard)와 화면이 같이 쓴다

/** 프롬프트 섹션 하나. 역할(system · user · assistant)과 내용 */
type PromptSection = { role: string; text: string };

// 프롬프트는 섹션 목록이다. 섹션마다 역할(system·user·assistant)과 내용을 갖는다.
// 비우면 기본 구성을 쓰므로, 적었을 때만 따진다.
const AI_ROLES = ["system", "user", "assistant"];

/** 프롬프트에서 후보 목록이 들어갈 자리 */
const LIST_MARK = "{{목록}}";
/** 후보 한 줄의 자리표시자 이름(줄 형식에 {{이름}} 으로 적는다. autoplay/assist 가 채운다) */
const LINE_MARKS = ["번호", "장르", "제목", "길이분", "길이초"] as const;

/** 후보 목록이 들어갈 자리({{목록}})가 어느 섹션에든 있는가. 없으면 모델은 무엇을 판정할지 모른다 */
const hasListMark = (sections: readonly unknown[]) => sections.some((section) => /\{\{\s*목록\s*\}\}/.test(String((section as { text?: unknown } | null)?.text ?? "")));

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
    // ChatML 은 블록 안에 끝 표시가 또 나오면 파일이 깨진다
    if (/<\|im_(start|end)\|>/.test(String(section?.text ?? ""))) problems.push(`${where}: 내용에 <|im_start|>·<|im_end|> 를 적을 수 없습니다.`);
  });

  // 후보를 어디에도 안 넣으면 모델은 무엇을 판정할지 모른다. 켜 두고 이러면 매번 헛돈다.
  if (on && !hasListMark(prompt)) problems.push("어딘가에 {{목록}} 이 있어야 합니다. 그 자리에 판정할 후보가 들어갑니다.");
  return problems;
}

export { AI_ROLES, LIST_MARK, LINE_MARKS, hasListMark, promptProblems };
export type { PromptSection };
