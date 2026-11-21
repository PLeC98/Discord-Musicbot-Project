// 이모지 선택 목록. 분류와 순서는 언어와 무관하게 같고(디스코드 선택기 그대로), 이름과 검색어만 언어별로 다르다.
// 언어별 데이터 파일(언어 폴더의 locales/<언어>/screen/emoji.ts, scripts/build-emoji-list.ts로 생성)을 두고 필요할 때 불러온다. 분류는 id로 구분한다(이름은 화면 문구표, 접은 분류 저장도 id 기준)

import { BASE_LANGUAGE, TEST_LANGUAGE, type Language, type TextLanguage } from "../../../src/rules/languages.ts";

/** 분류 id. 순서는 디스코드 선택기 그대로 */
const EMOJI_GROUP_IDS = ["people", "nature", "food", "activities", "travel", "objects", "symbols", "flags"] as const;
type EmojiGroupId = (typeof EMOJI_GROUP_IDS)[number];

/** 선택 목록의 이모지 하나. search는 이름과 검색어를 소문자로 이은 것 */
type Emoji = { char: string; label: string; search: string };
/** 분류 하나. id가 app이면 앱 이모지 분류(목록 파일에는 없다) */
type EmojiGroup = { id: EmojiGroupId | "app"; emoji: Emoji[] };
type EmojiList = { TWEMOJI_VERSION: string; EMOJI_GROUPS: EmojiGroup[] };

const LISTS: Readonly<Record<TextLanguage, () => Promise<EmojiList>>> = {
  ko: () => import("../../../locales/ko/screen/emoji.ts"),
};

/** 해당 언어의 이모지 목록. 테스트 언어는 기준 언어 목록을 사용한다 */
const loadEmojiList = (language: Language) => LISTS[language === TEST_LANGUAGE ? BASE_LANGUAGE : language]();

export { EMOJI_GROUP_IDS, loadEmojiList };
export type { Emoji, EmojiGroup, EmojiGroupId, EmojiList };
