// 화면 문구표. 언어마다 같은 형태의 번들(locales/<언어>/screen/index.ts)을 두고, 고른 언어의 번들로 같은 문구표 객체(text) 안의 값을 갈아 끼운다(새로고침하지 않고 그 자리에서 글자가 바뀐다).
// 기준 언어 번들은 늘 싣는다(처음 그리는 글자이고, 다른 언어에서 빠진 문구를 채운다). 다른 언어는 고를 때 받는다. 테스트 언어는 기준 언어를 바꿔 만든다(rules/pseudo-text).
// 모듈과 그 안의 객체마다 같은 그릇을 지킨다: `const T = text.shell`, `const D = text.settings.devices`처럼 객체를 가리켜 둔 곳은 함께 바뀌고,
// 문자열, 함수, 배열을 꺼내 둔 곳은 바뀌지 않는다(읽을 때 꺼낸다. test/dashboard/client/text-copies로 검사한다).
// 말투는 해요체, 버튼, 제목은 명사형, 툴팁은 짧게, 화면 읽기 이름(aria-label)은 무엇인지 드러나게.
// 봇과 같은 뜻의 문장(거절, 오류, 라벨)은 여기 두지 않고 봇 문구표에서 부른다(text.bot, 봇의 locales/<언어>/bot/shared)

import { ref, shallowReactive } from "vue";
import * as base from "../../../locales/ko/screen/index.ts";
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

// 그릇을 두는 객체: 모듈(네임스페이스)과 일반 객체. 배열, 함수, 문자열은 값이라 통째로 바꾼다
const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** 객체마다 반응형 그릇을 만든다(안쪽 객체도 그릇) */
function holder<T>(value: T): T {
  if (!isPlain(value)) return value;
  return shallowReactive(Object.fromEntries(Object.entries(value).map(([key, one]) => [key, holder(one)]))) as T;
}

/** 그릇에 새 값을 넣는다. 둘 다 객체면 안쪽 그릇을 지키고 채운다 */
function fillInto(target: Record<string, unknown>, next: Record<string, unknown>) {
  for (const [key, one] of Object.entries(next)) {
    const now = target[key];
    if (isPlain(one) && isPlain(now)) fillInto(now, one);
    else target[key] = holder(one);
  }
}

const text = holder(build(base));

/** 지금 화면 문구의 언어 */
const textLanguage = ref<Language>(BASE_LANGUAGE);

/** 화면 문구를 그 언어로 바꾼다. 번들을 받는 동안에는 지금 글자를 그대로 둔다 */
async function useTextLanguage(language: Language) {
  if (language === textLanguage.value) return;
  const load = language === TEST_LANGUAGE ? async () => pseudoText(base as ScreenSource) : language === BASE_LANGUAGE ? async () => base as ScreenSource : LOADERS[language];
  // 번들이 없는 언어(목록과 번들이 어긋남)는 바꾸지 않는다
  if (!load) return;
  fillInto(text as unknown as Record<string, unknown>, build(await load()) as unknown as Record<string, unknown>);
  textLanguage.value = language;
}

export { text, textLanguage, useTextLanguage };
export type { ScreenSource };
