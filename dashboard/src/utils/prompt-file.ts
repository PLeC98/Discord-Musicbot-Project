// AI 판정 프롬프트 한 벌(후보 목록의 줄 형식 + 섹션들)을 파일로 주고받는 형식. 섹션은 줄 형식이 만든 {{list}} 를 쓰므로 함께 다닌다.
// 파일은 { musicbotPrompt: 형식 번호, lineFormat, sections: [{ role, name, text }] }. 불러온 뒤에는 편집기 · 저장 검사(schema/ai · ai-prompt)가 평소처럼 본다

const FORMAT = 1;

/** 파일에 담는 섹션 하나. name 은 표시용 이름(요청에는 안 쓰인다) */
type PromptFileSection = { role: string; name: string; text: string };

/** 받을 파일 이름과 내용 */
function promptFile(lineFormat: string, sections: PromptFileSection[]): { name: string; body: string } {
  return { name: "ai-prompt.json", body: `${JSON.stringify({ musicbotPrompt: FORMAT, lineFormat, sections }, null, 2)}\n` };
}

/**
 * 프롬프트 파일이면 줄 형식과 섹션들, 아니면 null(JSON 이 아님 · 다른 파일 · 모르는 형식 번호).
 * 객체가 아닌 섹션만 뺀다(dropped). 역할이 맞지 않는 것 등은 남긴다. 편집기가 문제를 보이고 고치기 전에는 저장되지 않는다
 */
function parsePromptFile(text: string): { lineFormat: string; sections: PromptFileSection[]; dropped: number } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const file = data as { musicbotPrompt?: unknown; lineFormat?: unknown; sections?: unknown } | null;
  if (!file || typeof file !== "object" || file.musicbotPrompt !== FORMAT || !Array.isArray(file.sections)) return null;
  const list: unknown[] = file.sections;
  const sections = list.flatMap((one): PromptFileSection[] => {
    if (!one || typeof one !== "object" || Array.isArray(one)) return [];
    const section = one as { role?: unknown; name?: unknown; text?: unknown };
    return [{ role: String(section.role ?? ""), name: typeof section.name === "string" ? section.name : "", text: typeof section.text === "string" ? section.text : String(section.text ?? "") }];
  });
  return { lineFormat: typeof file.lineFormat === "string" ? file.lineFormat : "", sections, dropped: list.length - sections.length };
}

export { promptFile, parsePromptFile };
export type { PromptFileSection };
