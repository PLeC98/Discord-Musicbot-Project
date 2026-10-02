// 브라우저(대시보드)의 영어 발음 사전. pronunciations.ts 와 같은 이름을 내보내고 대시보드 빌드가 이것으로 바꿔 끼운다.
// 사전은 따로 떨어진 조각으로 받는다. 다 받기 전에는 없음이라 조사 도우미가 철자로 어림한다

let dictionary: Record<string, string> | null = null;
let loading: Promise<void> | null = null;

/** 사전을 받아 둔다. 화면이 뜰 때 한 번 부른다 */
function loadPronunciations() {
  loading ??= import("cmu-pronouncing-dictionary").then((module) => {
    dictionary = module.dictionary;
  });
  return loading;
}

/** 소문자 낱말의 발음(ARPAbet). 사전에 없거나 아직 받지 않았으면 null */
const pronunciationOf = (word: string): string | null => dictionary?.[word] ?? null;

export { pronunciationOf, loadPronunciations };
