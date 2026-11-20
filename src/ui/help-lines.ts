// /help의 명령 줄. 명령 정의(이름, 한국어 설명)와 명령 모듈의 help(섹션, 권한)에서 만든다.
// 손으로 적은 목록을 두지 않는다. 명령을 더하거나 권한을 바꾸면 도움말이 같이 바뀐다

import type { BotText } from "./text/index.ts";
import { commandMention } from "./command-mentions.ts";

/** 도움말의 섹션. 순서는 SECTIONS */
type HelpSection = "play" | "queue" | "mode" | "explore" | "channel" | "info";
/** 누가 쓸 수 있나. dj-or-requester는 자기가 넣은 곡이면 누구나, dj-outside-bot-channel은 봇 전용 채널에서는 누구나 */
type HelpTier = "everyone" | "dj" | "dj-or-requester" | "dj-outside-bot-channel" | "server-manager" | "owner";
/** 명령 모듈이 적는 도움말 항목. null이면 도움말에 싣지 않는다(/help 자신) */
type HelpEntry = { section: HelpSection; tier: HelpTier };

/** 줄을 만드는 데 읽는 명령 정의(toJSON)의 필드. 옵션은 적지 않는다(입력할 때 디스코드 자동완성이 보인다) */
type Defined = { name: string; description?: string };

const SECTIONS: readonly HelpSection[] = ["play", "queue", "mode", "explore", "channel", "info"];

/** 보는 사람이 그 권한 등급의 명령을 쓸 수 있나(usecases/help-access). 못 쓰면 줄 끝에 자물쇠 */
type Open = (tier: HelpTier) => boolean;
const ALL_OPEN: Open = () => true;

/** 명령 한 줄: 누르면 입력창에 채워지는 멘션(id를 모르면 글자), 설명, 권한 표시, 못 쓰면 자물쇠 */
function lineOf(T: BotText, defined: Defined, tier: HelpTier, guildId: string | null, open: Open) {
  const marks = [T.help.tierMark(tier), open(tier) ? "" : T.help.lockMark()].filter(Boolean).join(" ");
  return `${commandMention(defined.name, guildId)}: ${defined.description ?? ""}${marks ? ` ${marks}` : ""}`;
}

/** 도움말에 싣는 명령을 섹션 순서로(섹션 안은 실행 목록의 순서). help가 null인 명령은 뺀다 */
function inHelpOrder<T extends { help: HelpEntry | null }>(commands: T[]) {
  return SECTIONS.flatMap((section) => commands.filter((one): one is T & { help: HelpEntry } => one.help?.section === section));
}

/**
 * 섹션마다의 명령 줄, 그 섹션에 나온 권한 등급, 자물쇠가 붙었는지. 명령이 없는 섹션은 뺀다.
 * T는 보는 사람의 문구표, commands는 실행 목록의 순서(켜진 명령만), guildId는 화면을 보여 주는 서버(멘션이 그 서버의 명령인지 본다)
 */
function helpSections(T: BotText, commands: Array<{ defined: Defined; help: HelpEntry | null }>, guildId: string | null = null, open: Open = ALL_OPEN) {
  const ordered = inHelpOrder(commands);
  return SECTIONS.map((section) => {
    const inSection = ordered.filter(({ help }) => help.section === section);
    return {
      key: section,
      lines: inSection.map(({ defined, help }) => lineOf(T, defined, help.tier, guildId, open)),
      tiers: [...new Set(inSection.map(({ help }) => help.tier))],
      locked: inSection.some(({ help }) => !open(help.tier)),
    };
  }).filter((one) => one.lines.length > 0);
}

export { helpSections, SECTIONS };
export type { HelpSection, HelpTier, HelpEntry, Open };
