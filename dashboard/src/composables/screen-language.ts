// 화면 언어. 시작할 때 정하고(start), 설정 창과 로그인 화면에서 바꾼다(새로고침하지 않고 그 자리에서 글자가 바뀐다).
// 고른 값은 언어나 자동이다. 자동은 브라우저 언어, 봇 기본 언어, 기준 언어 차례로 쓸 수 있는 것을 쓴다(봇의 viewerLanguage와 같은 차례).
// 브라우저는 마지막으로 쓴 값을 기억한다(로그아웃해도 로그인 화면이 같은 언어로 보이게).
// 로그인하면 계정 값이 우선한다. 계정이 정한 적 없음이고 이번 로그인 화면에서 언어를 골랐으면 그 언어를 계정에 저장한다.
// 브라우저가 예전부터 기억한 값은 계정에 옮기지 않는다(공용 PC에서 앞사람의 선택이 다음 사람의 계정에 들어가지 않게)

import { computed, shallowRef } from "vue";
import axios from "axios";
import { BASE_LANGUAGE, infoOf, matchLanguage, type Language } from "../../../src/rules/languages.ts";
import type { BotInfo, LanguageChoice, Me, MyLanguage, MyLanguageBody } from "../../../src/dashboard/contract/identity.ts";
import { readStored, removeStored, writeStored } from "../utils/storage.ts";
import { text, useTextLanguage } from "../text/index.ts";
import type { Option } from "../utils/options.ts";
import { useLocale } from "../utils/locale.ts";

/** 고른 값: 언어나 자동 */
type Wanted = Language | "auto";

/** 브라우저가 마지막으로 쓴 값(언어 태그나 auto) */
const MEMORY_KEY = "language";
/** 이번 로그인 화면에서 고른 표시. 디스코드 로그인에 다녀오는 동안만 남는다(탭 저장소) */
const PICKED_KEY = "language:picked";

/** 쓸 수 있는 언어(/api/bot). 받기 전에는 기준 언어 하나 */
const languages = shallowRef<readonly LanguageChoice[]>([{ tag: BASE_LANGUAGE, name: infoOf(BASE_LANGUAGE).name }]);
const botDefault = shallowRef<Language>(BASE_LANGUAGE);
/** 지금 고른 값 */
const wanted = shallowRef<Wanted>("auto");
/** 지금 화면 언어 */
const shown = shallowRef<Language>(BASE_LANGUAGE);

const isListed = (tag: string | null | undefined, list: readonly LanguageChoice[]): tag is Language => !!tag && list.some((one) => one.tag === tag);

/** 자동일 때의 언어: 브라우저 언어 → 봇 기본 언어 → 기준 언어 */
function autoLanguage(browser: readonly string[], list: readonly LanguageChoice[], botLanguage: Language): Language {
  return (
    matchLanguage(
      browser,
      list.map(({ tag }) => infoOf(tag as Language)),
    ) ?? (isListed(botLanguage, list) ? botLanguage : BASE_LANGUAGE)
  );
}

/** 고른 값을 화면 언어로. 쓸 수 없는 언어(목록에서 빠짐)는 자동으로 */
const resolve = (choice: Wanted, browser: readonly string[], list: readonly LanguageChoice[], botLanguage: Language): Language => (choice !== "auto" && isListed(choice, list) ? choice : autoLanguage(browser, list, botLanguage));

/** 브라우저 기억에서 읽은 값. 모르는 값이면 null */
const storedChoice = (raw: string | null, list: readonly LanguageChoice[]): Wanted | null => (raw === "auto" || isListed(raw, list) ? raw : null);

/**
 * 시작할 때 따를 값. account: 로그인했으면 계정의 개인 언어(undefined는 로그인하지 않았거나 모름), stored: 브라우저 기억, picked: 이번 로그인 화면에서 골랐는지.
 * toAccount: 계정에 저장할 언어(정한 적 없는 계정이 이번 로그인 화면에서 언어를 골랐을 때)
 */
function startChoice({ account, stored, picked }: { account: MyLanguage | undefined; stored: Wanted | null; picked: boolean }): { choice: Wanted; toAccount: Language | null } {
  if (account === undefined) return { choice: stored ?? "auto", toAccount: null };
  if (account !== null) return { choice: account, toAccount: null };
  if (picked && stored && stored !== "auto") return { choice: stored, toAccount: stored };
  return { choice: "auto", toAccount: null };
}

/** 화면을 그 언어로: 문구를 채운 뒤 형식 로케일과 <html lang>을 같이 바꾼다 */
async function show(language: Language) {
  await useTextLanguage(language);
  const info = infoOf(language);
  useLocale(info.locale);
  document.documentElement.lang = info.htmlLang;
  shown.value = language;
}

/**
 * 시작할 때 화면 언어를 정한다. me: /api/me(로그인하지 않았으면 null, 모르면 undefined), bot: /api/bot(모르면 null).
 * 계정에 저장할 언어가 있으면 돌려준다(앱을 만든 뒤 saveToAccount로)
 */
async function startLanguage({ me, bot }: { me: Me | null | undefined; bot: BotInfo | null }): Promise<Language | null> {
  if (bot) {
    languages.value = bot.languages;
    botDefault.value = bot.botLanguage;
  }
  const picked = readStored(PICKED_KEY, true) !== null;
  const { choice, toAccount } = startChoice({ account: me?.language, stored: storedChoice(readStored(MEMORY_KEY), languages.value), picked });
  wanted.value = choice;
  // 로그인했으면 고른 표시를 지우고, 기억도 계정 값으로 고친다(로그아웃한 뒤의 로그인 화면이 같은 언어로)
  if (me) {
    removeStored(PICKED_KEY, true);
    writeStored(MEMORY_KEY, choice);
  }
  await show(resolve(choice, navigator.languages, languages.value, botDefault.value));
  return toAccount;
}

/** 개인 언어 저장(디스코드의 본인 응답에도 쓴다) */
async function saveToAccount(language: Wanted): Promise<void> {
  await axios.put("/api/me/language", { language } satisfies MyLanguageBody);
}

/**
 * 화면 언어를 바꾼다. 로그인했으면 계정에도 저장하고(실패하면 예외를 던진다), 로그인 화면이면 고른 표시를 남겨 로그인한 뒤 계정에 옮긴다
 */
async function chooseLanguage(choice: Wanted, { signedIn }: { signedIn: boolean }): Promise<void> {
  if (signedIn) await saveToAccount(choice);
  else writeStored(PICKED_KEY, "1", true);
  wanted.value = choice;
  writeStored(MEMORY_KEY, choice);
  await show(resolve(choice, navigator.languages, languages.value, botDefault.value));
}

/** 고를 언어가 있는가(언어가 하나면 고르는 곳을 감춘다. 디스코드 /language와 같다) */
const canChoose = computed(() => languages.value.length > 1);

/** 고르는 드롭다운의 선택지: 자동(지금 쓰는 언어를 같이), 언어마다 그 언어로 쓴 이름 */
const languageOptions = computed<Option[]>(() => {
  const auto = autoLanguage(navigator.languages, languages.value, botDefault.value);
  const autoName = languages.value.find((one) => one.tag === auto)?.name ?? auto;
  return [{ value: "auto", label: text.language.autoWith(autoName) }, ...languages.value.map(({ tag, name }) => ({ value: tag, label: name }))];
});

export { languages, wanted, shown, canChoose, languageOptions, startChoice, resolve, startLanguage, saveToAccount, chooseLanguage };
export type { Wanted };
