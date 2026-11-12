// /help 의 명령 줄. 명령 정의(이름, 한국어 설명)와 명령 모듈의 help(섹션, 권한)에서 만든다.
// 손으로 적은 목록을 두지 않는다. 명령을 더하거나 권한을 바꾸면 도움말이 같이 바뀐다

import * as helpText from "./text/ko/help.ts";
import { commandMention } from "./command-mentions.ts";
import type { Gate } from "../usecases/command-gate.ts";

/** 도움말의 섹션. 순서는 SECTIONS */
type HelpSection = "play" | "queue" | "mode" | "explore" | "channel" | "info";
/** 누가 쓸 수 있나. dj-or-requester 는 자기가 넣은 곡이면 누구나, dj-outside-bot-channel 은 봇 전용 채널에서는 누구나 */
type HelpTier = "everyone" | "dj" | "dj-or-requester" | "dj-outside-bot-channel" | "server-manager" | "owner";
/**
 * 명령 모듈이 적는 도움말 항목. null 이면 도움말에 싣지 않는다(/help 자신).
 * gate: 실행 때 쓰는 확인이 권한 등급의 기본 확인(usecases/command-gate)과 다르면 그 확인을 적는다. /help 명령: 의 "지금은"이 쓴다
 */
type HelpEntry = { section: HelpSection; tier: HelpTier; gate?: Gate };

/** 줄을 만드는 데 읽는 명령 정의(toJSON)의 필드. 옵션은 적지 않는다(입력할 때 디스코드 자동완성이 보인다) */
type Defined = { name: string; description?: string };

const SECTIONS: readonly HelpSection[] = ["play", "queue", "mode", "explore", "channel", "info"];

/** 명령 한 줄: 누르면 입력창에 채워지는 멘션(id 를 모르면 글자), 설명, 권한 표시 */
function lineOf(defined: Defined, tier: HelpTier, guildId: string | null) {
  const mark = helpText.tierMark(tier);
  return `${commandMention(defined.name, guildId)}: ${defined.description ?? ""}${mark ? ` ${mark}` : ""}`;
}

/** 도움말에 싣는 명령을 섹션 순서로(섹션 안은 실행 목록의 순서). help 가 null 인 명령은 뺀다 */
function inHelpOrder<T extends { help: HelpEntry | null }>(commands: T[]) {
  return SECTIONS.flatMap((section) => commands.filter((one): one is T & { help: HelpEntry } => one.help?.section === section));
}

/** 섹션마다의 명령 줄. commands 는 실행 목록의 순서(켜진 명령만), guildId 는 화면을 보이는 서버(멘션이 그 서버의 명령인지 본다) */
function helpSections(commands: Array<{ defined: Defined; help: HelpEntry | null }>, guildId: string | null = null) {
  const ordered = inHelpOrder(commands);
  return SECTIONS.map((section) => ({
    name: helpText.sectionName(section),
    lines: ordered.flatMap(({ defined, help }) => (help.section === section ? [lineOf(defined, help.tier, guildId)] : [])),
  })).filter((one) => one.lines.length > 0);
}

export { helpSections, inHelpOrder, SECTIONS };
export type { HelpSection, HelpTier, HelpEntry };
