// 화면 문구표. 언어마다 같은 형태의 번들(text/<언어>/index.ts)을 두고, 고른 언어의 번들로 같은 문구표 객체(text) 안의 값을 갈아 끼운다(새로고침하지 않고 그 자리에서 글자가 바뀐다).
// 기준 언어 번들은 늘 싣는다(처음 그리는 글자이고, 다른 언어에서 빠진 문구를 채운다). 다른 언어는 고를 때 받는다. 테스트 언어는 기준 언어를 바꿔 만든다(rules/pseudo-text).
// 모듈마다 같은 그릇을 지킨다: `const T = text.shell`처럼 모듈을 가리켜 둔 곳은 그대로 바뀌고, 모듈 안의 값을 꺼내 둔 곳은 바뀌지 않는다(읽을 때 꺼낸다).
// 말투는 해요체, 버튼, 제목은 명사형, 툴팁은 짧게, 화면 읽기 이름(aria-label)은 무엇인지 드러나게.
// 봇과 같은 뜻의 문장(거절, 오류, 라벨)은 여기 두지 않고 봇 문구표에서 부른다(text.bot, 봇의 src/ui/text/<언어>/shared)

import { ref, shallowReactive } from "vue";
import * as base from "./ko/index.ts";
import type { TextShape } from "../../../src/ui/text/contract.ts";
import { fillFrom } from "../../../src/rules/text-fill.ts";
import { pseudoText } from "../../../src/rules/pseudo-text.ts";
import { withErrors } from "../../../src/ui/text/bundle.ts";
import { BASE_LANGUAGE, TEST_LANGUAGE, type Language, type TextLanguage } from "../../../src/rules/languages.ts";

/** 언어 번들이 따라야 할 모양(문구의 리터럴 타입을 넓힌 것) */
type ScreenSource = TextShape<typeof base>;
/** 화면이 쓰는 문구표의 모양. 기준 언어 번들의 타입 그대로라 아이콘 이름 같은 뜻이 있는 리터럴이 남는다. 봇 오류 안내는 표를 찾는 함수를 묶은 것 */
type Built = Omit<typeof base, "bot"> & { bot: ReturnType<typeof withErrors<typeof base.bot>> };

/** 기준 언어 외의 언어 번들. 고를 때 받는다(언어를 더하면 여기 한 줄) */
const LOADERS: Readonly<Partial<Record<TextLanguage, () => Promise<ScreenSource>>>> = {};

/** 언어 번들 하나를 화면이 쓰는 모양으로: 빠진 문구는 기준 언어로 채우고, 봇 오류 안내의 표를 찾는 함수를 묶는다 */
function build(source: ScreenSource): Built {
  const { value } = fillFrom(base as ScreenSource, source, new Set());
  return { ...value, bot: withErrors(value.bot) } as unknown as Built;
}

type Modules = Omit<Built, "bot">;

// 모듈별 그릇. 같은 그릇을 지키고 값만 갈아 끼운다
const holder = <T extends object>(module: T): T => shallowReactive({ ...module }) as T;
const first = build(base);
const text = {
  ...(Object.fromEntries(Object.entries(first).map(([key, module]) => [key, key === "bot" ? null : holder(module as object)])) as Modules),
  bot: Object.fromEntries(Object.entries(first.bot).map(([key, module]) => [key, holder(module as object)])) as Built["bot"],
} as Built;

/** 지금 화면 문구의 언어 */
const textLanguage = ref<Language>(BASE_LANGUAGE);

// 그릇마다 새 값을 넣는다
function apply(next: Built) {
  for (const [key, module] of Object.entries(next)) if (key !== "bot") Object.assign((text as Record<string, object>)[key], module);
  for (const [key, module] of Object.entries(next.bot)) Object.assign((text.bot as Record<string, object>)[key], module);
}

/** 화면 문구를 그 언어로 바꾼다. 번들을 받는 동안에는 지금 글자를 그대로 둔다 */
async function useTextLanguage(language: Language) {
  if (language === textLanguage.value) return;
  const load = language === TEST_LANGUAGE ? async () => pseudoText(base as ScreenSource) : language === BASE_LANGUAGE ? async () => base as ScreenSource : LOADERS[language];
  // 번들이 없는 언어(목록과 번들이 어긋남)는 바꾸지 않는다
  if (!load) return;
  apply(build(await load()));
  textLanguage.value = language;
}

export { text, textLanguage, useTextLanguage };
export type { ScreenSource };
