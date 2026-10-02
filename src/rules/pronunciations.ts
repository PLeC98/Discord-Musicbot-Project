// 영어 발음 사전(CMU, 13만여 낱말, 약 5MB). 조사 도우미(rules/josa)가 영어로 끝나는 말의 마지막 소리를 본다.
// Node 에서는 처음 쓸 때 한 번 읽는다. 브라우저(대시보드 빌드)는 같은 이름을 내보내는 pronunciations.browser.ts 로 바꿔 끼운다

import { createRequire } from "node:module";

let dictionary: Record<string, string> | null = null;

/** 사전을 받아 둔다. Node 는 처음 찾을 때 읽으니 이미 된 것과 같다(브라우저 쪽과 이름을 맞춘다) */
const loadPronunciations = () => Promise.resolve();

/** 소문자 낱말의 발음(ARPAbet). 사전에 없으면 null */
function pronunciationOf(word: string): string | null {
  dictionary ??= (createRequire(import.meta.url)("cmu-pronouncing-dictionary") as { dictionary: Record<string, string> }).dictionary;
  return dictionary[word] ?? null;
}

export { pronunciationOf, loadPronunciations };
