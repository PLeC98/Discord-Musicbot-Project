// 언어 모듈에서 언어마다 쓸 문구 번들을 만든다(봇 진입점 ui/text/index, 화면도 쓰는 진입점 ui/text/shared가 같이 쓴다, Node 없는 모듈).
// 언어마다 한 번 만들어 둔다: 빠진 문구를 기준 언어로 채우고(rules/text-fill), 테스트 언어는 기준 언어를 바꿔 만들고(rules/pseudo-text), 표를 찾는 함수를 묶는다

import { BASE_LANGUAGE, TEST_LANGUAGE, type Language, type TextLanguage } from "../../rules/languages.ts";
import { fillFrom } from "../../rules/text-fill.ts";
import { pseudoText } from "../../rules/pseudo-text.ts";
import { bindErrors, type ErrorTable, type LinkLook } from "./notice.ts";

/** 하나라도 빠지면 통째로 기준 언어로 채우는 모듈: 선택지 이름을 만드는 함수와, 입력란에 들어간 그 이름에서 검색어를 꺼내는 함수가 짝이다 */
const WHOLE_MODULES: ReadonlySet<string> = new Set(["search"]);
/** 문구가 아니라 사용자가 입력한 글에서 꺼낸 값을 돌려주는 함수. 테스트 언어에서도 바꾸지 않는다 */
const NOT_TEXT: ReadonlySet<string> = new Set(["search.queryOfTyped"]);

/** 오류 안내의 문장표를 찾는 함수(notice, noticeFor)를 그 언어의 표에 묶는다. 채운 뒤의 표를 봐야 빠진 항목이 기준 언어로 나온다 */
const withErrors = <S extends { errors: { TEXT: ErrorTable; PLAIN: LinkLook } }>(text: S) => ({ ...text, errors: { ...text.errors, ...bindErrors(text.errors.TEXT, text.errors.PLAIN) } });

/**
 * 각 언어의 번들을 돌려주는 textFor와, 언어마다 채운 문구의 경로(missingText).
 * sources: 번역이 있는 각 언어의 언어 모듈 번들(기준 언어 포함), bind: 표를 찾는 함수를 묶는 것
 */
function bundles<S, B>(sources: Readonly<Record<TextLanguage, S>>, bind: (text: S) => B) {
  const base = sources[BASE_LANGUAGE];
  const made = new Map<Language, B>();
  const missing = new Map<TextLanguage, string[]>();
  const build = (language: Language): B => {
    if (language === TEST_LANGUAGE) return bind(pseudoText(base, NOT_TEXT));
    const filled = fillFrom(base, sources[language], WHOLE_MODULES);
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

export { bundles, withErrors, WHOLE_MODULES, NOT_TEXT };
