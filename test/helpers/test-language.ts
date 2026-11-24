// 테스트 언어(rules/languages의 TEST_LANGUAGE)를 언어 목록에 넣은 채로 부른다. 언어가 둘일 때의 동작을 테스트한다

import { useTestLanguage } from "../../src/rules/languages.ts";

/** on이면 테스트 언어를 넣은 채로 run을 부르고, 끝나면 뺀다 */
function withTestLanguage<T>(on: boolean, run: () => T): T {
  useTestLanguage(on);
  try {
    return run();
  } finally {
    useTestLanguage(false);
  }
}

export { withTestLanguage };
