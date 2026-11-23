// 봇 문구 번들을 만든다(봇 진입점 ui/text/index, 화면도 쓰는 진입점 ui/text/shared가 같이 쓴다, Node 없는 모듈).
// 만드는 일은 infra/text-bundle이 하고, 여기서는 봇 문구만의 것(통째로 채울 모듈, 바꾸지 않을 함수, 오류 안내의 표를 찾는 함수)을 넘긴다

import { BASE_LANGUAGE, TEST_LANGUAGE, type TextLanguage } from "../../rules/languages.ts";
import { bundles as textBundles } from "../../infra/text-bundle.ts";
import { bindErrors, type ErrorTable, type LinkLook } from "./notice.ts";

/** 하나라도 빠지면 통째로 기준 언어로 채우는 모듈: 선택지 이름을 만드는 함수와, 입력란에 들어간 그 이름에서 검색어를 꺼내는 함수가 짝이다 */
const WHOLE_MODULES: ReadonlySet<string> = new Set(["search"]);
/** 문구가 아니라 사용자가 입력한 글에서 꺼낸 값을 돌려주는 함수. 테스트 언어에서도 바꾸지 않는다 */
const NOT_TEXT: ReadonlySet<string> = new Set(["search.queryOfChoice", "search.titleOfPick"]);

/** 오류 안내의 문장표를 찾는 함수(notice, noticeFor)를 그 언어의 표에 묶는다. 채운 뒤의 표를 봐야 빠진 항목이 기준 언어로 나온다 */
const withErrors = <S extends { errors: { TEXT: ErrorTable; PLAIN: LinkLook } }>(text: S) => ({ ...text, errors: { ...text.errors, ...bindErrors(text.errors.TEXT, text.errors.PLAIN) } });

/** 각 언어의 봇 문구 번들(textFor)과 빠진 문구의 경로(missingText) */
const bundles = <S, B>(sources: Readonly<Record<TextLanguage, S>>, bind: (text: S) => B) => textBundles(sources, bind, { base: BASE_LANGUAGE, test: TEST_LANGUAGE, whole: WHOLE_MODULES, notText: NOT_TEXT });

export { bundles, withErrors, WHOLE_MODULES, NOT_TEXT };
