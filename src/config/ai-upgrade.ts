// 저장된 AI 설정 · 프롬프트가 예전 기본값 그대로면 지금 기본값으로 바꾼다. 기동 때 문서를 올리며(config/documents 의 attach) 한 번 본다.
// 글자까지 같을 때만 바꾼다(운영자가 고친 적이 없다). 고친 것은 그대로 둔다. 예전 기본값은 config/legacy-ai-defaults.
//   ai         줄 형식(list.lineFormat)이 예전 기본값이면 지금 기본값으로. 이제 읽지 않는 옛 칸(unknownDuration · unknownText)은 뺀다
//   ai-prompt  예전 기본 구성(판정 기준 + 목록 자리)이면 비운다(비어 있으면 코드에 든 지금 기본 구성을 쓴다)

import aiDefault from "./defaults/ai.ts";
import { LEGACY_LINE_FORMATS, LEGACY_LIST_MARKS, LEGACY_PROMPTS } from "./legacy-ai-defaults.ts";

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** 바꿀 AI 설정. 바꿀 것이 없으면 null */
function upgradeAi(data: unknown): Record<string, unknown> | null {
  if (!isObject(data) || !isObject(data.list) || !LEGACY_LINE_FORMATS.includes(String(data.list.lineFormat))) return null;
  const { unknownDuration: _hide, unknownText: _text, ...list } = data.list;
  return { ...data, list: { ...list, lineFormat: (aiDefault.list as { lineFormat: string }).lineFormat } };
}

/** 바꿀 프롬프트. 예전 기본 구성 그대로면 빈 구성, 아니면 null */
function upgradePrompt(data: unknown): unknown[] | null {
  if (!Array.isArray(data) || data.length !== 2) return null;
  const [system, user] = data as Array<{ role?: unknown; text?: unknown } | null>;
  const legacy = system?.role === "system" && LEGACY_PROMPTS.includes(String(system.text)) && user?.role === "user" && LEGACY_LIST_MARKS.includes(String(user.text).trim());
  return legacy ? [] : null;
}

/** 문서 하나를 본다. 바꿀 것이 있으면 바꾼 문서, 없으면 null */
function upgradeDoc(name: string, data: unknown): unknown {
  if (name === "ai") return upgradeAi(data);
  if (name === "ai-prompt") return upgradePrompt(data);
  return null;
}

export { upgradeAi, upgradePrompt, upgradeDoc };
