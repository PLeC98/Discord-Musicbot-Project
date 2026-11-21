// 언어 모듈에서 언어마다 쓸 문구 번들을 만든다(봇 문구 진입점 ui/text, 규칙 문구 진입점 rules/text가 같이 쓴다, Node 없는 모듈).
// 언어마다 한 번 만들어 둔다: 빠진 문구를 기준 언어로 채우고(text-fill), 테스트 언어는 기준 언어를 바꿔 만들고(pseudo-text), 표를 찾는 함수를 묶는다

import { BASE_LANGUAGE, TEST_LANGUAGE, type Language, type TextLanguage } from "./languages.ts";
import { fillFrom } from "./text-fill.ts";
import { pseudoText } from "./pseudo-text.ts";

/** whole: 하나라도 빠지면 통째로 기준 언어로 채우는 모듈, notText: 테스트 언어에서도 바꾸지 않는 함수(모듈.이름) */
type BundleOptions = { whole?: ReadonlySet<string>; notText?: ReadonlySet<string> };

/**
 * 각 언어의 번들을 돌려주는 textFor와, 언어마다 채운 문구의 경로(missingText).
 * sources: 번역이 있는 각 언어의 언어 모듈 번들(기준 언어 포함), bind: 표를 찾는 함수를 묶는 것
 */
function bundles<S, B>(sources: Readonly<Record<TextLanguage, S>>, bind: (text: S) => B, { whole = new Set(), notText = new Set() }: BundleOptions = {}) {
  const base = sources[BASE_LANGUAGE];
  const made = new Map<Language, B>();
  const missing = new Map<TextLanguage, string[]>();
  const build = (language: Language): B => {
    if (language === TEST_LANGUAGE) return bind(pseudoText(base, notText));
    const filled = fillFrom(base, sources[language], whole);
    if (filled.missing.length) missing.set(language, filled.missing);
    return bind(filled.value);
  };
  const textFor = (language: Language): B => {
    const found = made.get(language);
    if (found) return found;
    const fresh = build(language);
    made.set(language, fresh);
    return fresh;
  };
  /** 번역이 있는 모든 언어의 번들을 만들어 보고, 빠진 문구를 기준 언어로 채운 경로 */
  const missingText = (): ReadonlyMap<TextLanguage, string[]> => {
    for (const language of Object.keys(sources) as TextLanguage[]) textFor(language);
    return missing;
  };
  return { textFor, missingText };
}

export { bundles };
export type { BundleOptions };
