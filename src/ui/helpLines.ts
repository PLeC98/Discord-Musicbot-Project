// /help 의 명령 줄. 명령 정의(이름 · 옵션 · 한국어 설명)와 명령 모듈의 help(묶음 · 권한)에서 만든다.
// 손으로 적은 목록을 두지 않는다. 명령을 더하거나 권한을 바꾸면 도움말이 같이 바뀐다

import * as helpText from "./text/ko/help.ts";

/** 도움말의 묶음. 차례는 SECTIONS */
type HelpSection = "play" | "queue" | "mode" | "explore" | "channel" | "info";
/** 누가 쓸 수 있나. dj-or-requester 는 자기가 넣은 곡이면 누구나, dj-outside-bot-channel 은 봇 전용 채널에서는 누구나 */
type HelpTier = "everyone" | "dj" | "dj-or-requester" | "dj-outside-bot-channel" | "moderator" | "owner";
/** 명령 모듈이 적는 도움말 자리. null 이면 도움말에 싣지 않는다(/help 자신) */
type HelpEntry = { section: HelpSection; tier: HelpTier };

/** 줄을 만드는 데 읽는 명령 정의(toJSON)의 칸 */
type Localized = Partial<Record<string, string | null>> | null | undefined;
type Defined = {
  name: string;
  description?: string;
  description_localizations?: Localized;
  options?: Array<{ name: string; name_localizations?: Localized; required?: boolean }>;
};

const SECTIONS: readonly HelpSection[] = ["play", "queue", "mode", "explore", "channel", "info"];

// 옵션 자리표시. 꼭 넣을 것은 <이름>, 넣지 않아도 되는 것은 [이름]. 이름은 디스코드가 보여 주는 한국어 이름
const usageOf = ({ options = [] }: Defined) => options.map((o) => (o.required ? ` <${o.name_localizations?.ko ?? o.name}>` : ` [${o.name_localizations?.ko ?? o.name}]`)).join("");

/** 명령 한 줄 */
function lineOf(defined: Defined, tier: HelpTier) {
  const mark = helpText.tierMark(tier);
  return `\`/${defined.name}${usageOf(defined)}\`: ${defined.description_localizations?.ko ?? defined.description ?? ""}${mark ? ` ${mark}` : ""}`;
}

/** 묶음마다의 명령 줄과 지원 플랫폼. commands 는 실행 목록의 차례(켜진 명령만) */
function helpSections(commands: Array<{ defined: Defined; help: HelpEntry | null }>) {
  const listed = SECTIONS.map((section) => ({
    name: helpText.sectionName(section),
    lines: commands.flatMap(({ defined, help }) => (help?.section === section ? [lineOf(defined, help.tier)] : [])),
  })).filter((one) => one.lines.length > 0);
  return [...listed, helpText.platforms()];
}

export { helpSections, SECTIONS };
export type { HelpSection, HelpTier, HelpEntry };
