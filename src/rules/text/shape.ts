// 규칙 문구 번들의 모양(타입만, Node 없는 모듈. 화면도 타입을 가져온다). 언어 모듈은 이 모양을 맞춘다

import type { RuleSentences } from "../rule-problem.ts";

/** 입력란 하나의 글: 이름, 설명, 빈 값 이름 */
type FieldText = { label: string; hint?: string; emptyLabel?: string };
/** 소스 종류 하나의 글: 이름, 설명, 입력란 키마다의 글 */
type SourceText = { label: string; hint?: string; fields: Readonly<Record<string, FieldText>> };
/** 선택지 이름 묶음(config/schema/genre-sources의 optionText). 묶음마다 API 값 → 보일 이름 */
type OptionGroup = "sort" | "season" | "anisongSongTypes" | "anisongAnimeTypes" | "anisongCategories" | "anisongBroadcasts" | "language";

/** 언어 모듈 번들이 맞출 모양 */
type RuleSource = {
  problems: RuleSentences;
  sources: Readonly<Record<string, SourceText>>;
  options: Readonly<Record<OptionGroup, Readonly<Record<string, string>>>>;
  songTypesHint: (defaults: string) => string;
};

export type { FieldText, SourceText, OptionGroup, RuleSource };
