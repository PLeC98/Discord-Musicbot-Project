// /help 의 명령 줄. 명령 정의(이름 · 한국어 설명)와 명령 모듈의 help(섹션 · 권한)에서 만든다.
// 손으로 적은 목록을 두지 않는다. 명령을 더하거나 권한을 바꾸면 도움말이 같이 바뀐다

import * as helpText from "./text/ko/help.ts";

/** 도움말의 섹션. 순서는 SECTIONS */
type HelpSection = "play" | "queue" | "mode" | "explore" | "channel" | "info";
/** 누가 쓸 수 있나. dj-or-requester 는 자기가 넣은 곡이면 누구나, dj-outside-bot-channel 은 봇 전용 채널에서는 누구나 */
type HelpTier = "everyone" | "dj" | "dj-or-requester" | "dj-outside-bot-channel" | "moderator" | "owner";
/** 명령 모듈이 적는 도움말 항목. null 이면 도움말에 싣지 않는다(/help 자신) */
type HelpEntry = { section: HelpSection; tier: HelpTier };

/** 줄을 만드는 데 읽는 명령 정의(toJSON)의 필드. 옵션은 적지 않는다(입력할 때 디스코드 자동완성이 보인다) */
type Localized = Partial<Record<string, string | null>> | null | undefined;
type Defined = { name: string; description?: string; description_localizations?: Localized };

const SECTIONS: readonly HelpSection[] = ["play", "queue", "mode", "explore", "channel", "info"];

/** 명령 한 줄 */
function lineOf(defined: Defined, tier: HelpTier) {
  const mark = helpText.tierMark(tier);
  return `\`/${defined.name}\`: ${defined.description_localizations?.ko ?? defined.description ?? ""}${mark ? ` ${mark}` : ""}`;
}

/** 섹션마다의 명령 줄과 지원 플랫폼. commands 는 실행 목록의 순서(켜진 명령만) */
function helpSections(commands: Array<{ defined: Defined; help: HelpEntry | null }>) {
  const listed = SECTIONS.map((section) => ({
    name: helpText.sectionName(section),
    lines: commands.flatMap(({ defined, help }) => (help?.section === section ? [lineOf(defined, help.tier)] : [])),
  })).filter((one) => one.lines.length > 0);
  return [...listed, helpText.platforms()];
}

export { helpSections, SECTIONS };
export type { HelpSection, HelpTier, HelpEntry };
