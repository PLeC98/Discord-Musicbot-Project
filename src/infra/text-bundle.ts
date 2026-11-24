// 언어 모듈에서 언어마다 쓸 문구 번들을 만든다(봇 문구 ui/text, 규칙 문구 rules/text가 같이 쓴다, Node 없는 모듈).
// 언어마다 한 번 만들어 둔다: 빠진 문구를 기준 언어로 채우고(text-fill), 테스트 언어는 기준 언어를 바꿔 만들고(pseudo-text), 표를 찾는 함수를 묶는다.
// 가장 아래층이라 언어 목록을 모른다. 기준 언어와 테스트 언어의 태그는 부르는 쪽이 넘긴다

import { fillFrom } from "./text-fill.ts";
import { pseudoText } from "./pseudo-text.ts";

/** base: 기준 언어(다른 언어에서 빠진 문구를 채우는 원본), test: 테스트 언어, whole: 하나라도 빠지면 통째로 기준 언어로 채우는 모듈, notText: 테스트 언어에서도 바꾸지 않는 함수(모듈.이름) */
type BundleOptions<T extends string, X extends string> = { base: T; test: X; whole?: ReadonlySet<string>; notText?: ReadonlySet<string> };

/**
 * 각 언어의 번들을 돌려주는 textFor와, 언어마다 채운 문구의 경로(missingText).
 * sources: 번역이 있는 각 언어의 언어 모듈 번들(기준 언어 포함), bind: 표를 찾는 함수를 묶는 것
 */
function bundles<T extends string, X extends string, S, B>(sources: Readonly<Record<T, S>>, bind: (text: S) => B, { base, test, whole = new Set(), notText = new Set() }: BundleOptions<T, X>) {
  const made = new Map<T | X, B>();
  const missing = new Map<T, string[]>();
  const build = (language: T | X): B => {
    if (language === test) return bind(pseudoText(sources[base], notText));
    const filled = fillFrom(sources[base], sources[language as T], whole);
    if (filled.missing.length) missing.set(language as T, filled.missing);
    return bind(filled.value);
  };
  const textFor = (language: T | X): B => {
    const found = made.get(language);
    if (found) return found;
    const fresh = build(language);
    made.set(language, fresh);
    return fresh;
  };
  /** 번역이 있는 모든 언어의 번들을 만들어 보고, 빠진 문구를 기준 언어로 채운 경로 */
  const missingText = (): ReadonlyMap<T, string[]> => {
    for (const language of Object.keys(sources) as T[]) textFor(language);
    return missing;
  };
  return { textFor, missingText };
}

export { bundles };
export type { BundleOptions };
