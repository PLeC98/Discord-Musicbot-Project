// 지원 언어 목록과 언어 맞추기. 봇과 대시보드(브라우저)가 같이 쓴다(Node 없는 모듈).
// 언어 이름은 BCP 47 태그다. 기준 언어(BASE_LANGUAGE)는 문구 계약의 기준이고, 다른 언어 번들에서 빠진 문구를 채우는 원본이다(ui/text).
// 운영자가 고르는 봇 기본 언어와는 다르다(ui/language)

/** 언어 하나. locale: 숫자와 날짜 형식(Intl), discord: 이 언어로 받는 디스코드 로케일(정확히 같은 것만), htmlLang: 화면의 lang 속성 */
type LanguageInfo = { tag: string; name: string; locale: string; discord: readonly string[]; htmlLang: string };

const LANGUAGES = [{ tag: "ko", name: "한국어", locale: "ko-KR", discord: ["ko"], htmlLang: "ko" }] as const satisfies readonly LanguageInfo[];

/**
 * 테스트 언어. 기준 언어의 문구를 바꿔 만든다(rules/pseudo-text). 운영 설정값으로 켜면 언어 목록에 든다.
 * 태그는 실제 언어와 겹치지 않는 것이어야 한다(ko-x-test는 언어 부분 맞추기에서 ko와 겹치고, x-test는 Intl이 받지 않는다)
 */
const TEST_LANGUAGE = "qps-ploc";
const TEST_INFO: LanguageInfo = { tag: TEST_LANGUAGE, name: "Pseudo", locale: "ko-KR", discord: [], htmlLang: TEST_LANGUAGE };

/** 번역이 있는 언어(테스트 언어 빼고) */
type TextLanguage = (typeof LANGUAGES)[number]["tag"];
type Language = TextLanguage | typeof TEST_LANGUAGE;

const BASE_LANGUAGE: TextLanguage = "ko";
/** 로그와 예외 메시지를 그리는 언어. 로그 메시지는 번역하지 않는다 */
const LOG_LANGUAGE: TextLanguage = "ko";

/** 쓸 수 있는 언어. testOn: 테스트 언어를 켰는가(운영 설정값. 이 모듈은 설정을 읽지 않는다) */
const availableLanguages = (testOn: boolean): readonly LanguageInfo[] => (testOn ? [...LANGUAGES, TEST_INFO] : LANGUAGES);

/** 저장할 수 있는 언어 태그 모두(테스트 언어 포함). 저장한 값을 읽을 때 검증에 쓴다. 지금 쓸 수 있는지는 availableLanguages로 본다 */
const KNOWN_TAGS: readonly [Language, ...Language[]] = [TEST_LANGUAGE, ...LANGUAGES.map((one) => one.tag)];
/** 쓸 수 있는 언어 목록에 든 태그인가 */
const isAvailable = (tag: string, languages: readonly LanguageInfo[]): tag is Language => languages.some((one) => one.tag === tag);

const infoOf = (tag: Language): LanguageInfo => (tag === TEST_LANGUAGE ? TEST_INFO : (LANGUAGES.find((one) => one.tag === tag) ?? LANGUAGES[0]));

/**
 * 원하는 언어 태그 목록(앞이 먼저)에서 쓸 수 있는 언어를 찾는다(RFC 4647의 lookup). 태그마다 정확히 같은 것, 그다음 언어 부분이 같은 것(en-GB는 en).
 * 없으면 null. 다른 언어로 넘겨짚지 않는다. 브라우저 언어, Accept-Language에 쓴다
 */
function matchLanguage(tags: readonly string[], languages: readonly LanguageInfo[]): Language | null {
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag || tag === "*") continue;
    const exact = languages.find((one) => one.tag.toLowerCase() === tag);
    if (exact) return exact.tag as Language;
    const primary = tag.split("-")[0];
    const sameBase = languages.find((one) => one.tag.toLowerCase() === primary);
    if (sameBase) return sameBase.tag as Language;
  }
  return null;
}

/** 디스코드 로케일(상호작용의 locale)의 언어. 언어 목록에 적힌 로케일과 정확히 같은 것만 받는다(zh-TW를 zh로 넘겨짚지 않는다). 없으면 null */
function discordLanguage(locale: string | null | undefined, languages: readonly LanguageInfo[]): Language | null {
  if (!locale) return null;
  const found = languages.find((one) => one.discord.includes(locale));
  return found ? (found.tag as Language) : null;
}

/** Accept-Language 헤더의 언어 태그들(q 값이 큰 것부터). q=0은 받지 않는다는 뜻이라 뺀다 */
function acceptedTags(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)?.[1]).find((v) => v !== undefined);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((one) => one.tag && one.q > 0 && Number.isFinite(one.q))
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((one) => one.tag);
}

/** 언어 키로 된 이름 표(MaxMind의 names, AI 모델 프로필의 labelI18n: ko, en, zh-CN 등)에서 해당 언어의 이름. 언어 태그, 로케일, 각각의 기본 언어 코드 순으로 찾고 없으면 undefined */
function nameFor(names: object | undefined, language: Language): string | undefined {
  if (!names) return undefined;
  const table = names as Partial<Record<string, string>>;
  const { tag, locale } = infoOf(language);
  const key = [tag, locale, tag.split("-")[0], locale.split("-")[0]].find((one) => table[one]);
  return key ? table[key] : undefined;
}

export { LANGUAGES, TEST_LANGUAGE, BASE_LANGUAGE, LOG_LANGUAGE, KNOWN_TAGS, availableLanguages, isAvailable, infoOf, matchLanguage, discordLanguage, acceptedTags, nameFor };
export type { LanguageInfo, Language, TextLanguage };
