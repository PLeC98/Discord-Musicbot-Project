// /help 화면의 문구

import type { HelpSection, HelpTier } from "../../help-lines.ts";
import { icon, type IconKey } from "../../icons.ts";

// 명령 줄은 명령 정의에서 만든다(ui/help-lines). 여기는 머리말, 섹션 이름, 권한 표시, 버튼 이름만.
// 아이콘은 그릴 때 붙인다(앱 이모지를 동기화한 뒤의 id 가 실리게)

const SECTION_NAME: Record<HelpSection, [IconKey, string]> = {
  play: ["music", "재생"],
  queue: ["queue", "대기열"],
  mode: ["modes", "모드 & 오디오"],
  explore: ["search", "탐색 & 정보"],
  channel: ["session", "채널 & 세션"],
  info: ["stats", "봇 정보"],
};
/** 섹션 이름 */
const sectionName = (section: HelpSection) => `${icon(SECTION_NAME[section][0])} ${SECTION_NAME[section][1]}`;

const TIER_MARK: Record<HelpTier, () => string> = {
  everyone: () => "",
  dj: () => icon("dj"),
  "dj-or-requester": () => `${icon("dj")} (자기가 추가한 곡은 누구나)`,
  "dj-outside-bot-channel": () => `(봇 전용 채널에서는 전원, 그 외 ${icon("dj")})`,
  "server-manager": () => icon("shield"),
  owner: () => "(봇 운영자)",
};
/** 줄 끝의 권한 표시. 누구나 쓰면 빈 문자열 */
const tierMark = (tier: HelpTier) => TIER_MARK[tier]();

/** 헤더와 머리말. play 는 /play 의 멘션 */
const intro = (play: string) => ({
  title: "도움말",
  lines: [`음성 채널에 들어가서 ${play}로 곡을 틀어요. 재생 패널의 버튼으로도 조작할 수 있어요.`, `${icon("dj")} 봇과 같은 음성 채널에 있는 DJ만 쓸 수 있어요. DJ 역할이 없는 서버는 모두가 DJ이고, 서버 관리자는 늘 쓸 수 있어요.`, `${icon("shield")} 서버 관리자만 쓸 수 있어요.`],
});

/** 작은 글씨 줄. help 는 /help 의 멘션 */
const footer = (help: string) => `${help}의 명령 칸에 명령 이름을 넣으면 하나씩 자세히 볼 수 있어요.`;

/** 버튼 */
const buttons = () => ({ dashboard: "웹 대시보드" });

const WHO: Record<HelpTier, string> = {
  everyone: "누구나",
  dj: "DJ(봇과 같은 음성 채널에서)",
  "dj-or-requester": "DJ, 또는 그 곡을 추가한 사람(봇과 같은 음성 채널에서)",
  "dj-outside-bot-channel": "봇 전용 채널에서는 누구나, 전용 채널이 없는 서버는 DJ",
  "server-manager": "서버 관리 권한이 있는 사람",
  owner: "봇 운영자",
};

/** 옵션 한 줄의 재료. name 은 한국어 이름이 있으면 그것 */
type OptionLine = { name: string; description: string; required: boolean };

/** 지금 그 사람이 쓸 수 있는지. why 는 못 쓰는 까닭 문장 */
type Now = { state: "yes" } | { state: "own-track" } | { state: "no"; why: string };

const NOW_LINE = {
  yes: () => "쓸 수 있어요.",
  "own-track": () => "DJ가 아니라서 자기가 추가한 곡에만 쓸 수 있어요.",
  no: (why: string) => `쓸 수 없어요. ${why}`,
};

/** /help 명령: 의 화면. mention 은 그 명령의 멘션 */
const detail = ({ mention, description, options, tier, now }: { mention: string; description: string; options: OptionLine[]; tier: HelpTier; now: Now }) => ({
  title: mention,
  lines: [description, ...(options.length ? ["", "**입력**", ...options.map((o) => `- \`${o.name}\`${o.required ? "" : " (선택)"}: ${o.description}`)] : []), "", `**쓸 수 있는 사람**: ${WHO[tier]}`, `**지금은**: ${now.state === "no" ? NOW_LINE.no(now.why) : NOW_LINE[now.state]()}`],
});

/** 자세히 보기의 작은 글씨 줄. "지금은"이 보는 것의 범위 */
const detailFooter = () => "권한과 음성 채널만 봐요. 재생 중인 곡이 없는 것처럼 지금 상태 때문에 안 되면 실행할 때 알려 줘요.";

/** 자동완성 한 줄(100자 안에서 자른다) */
const choice = (name: string, description: string) => `/${name}: ${description}`.slice(0, 100);

export { sectionName, tierMark, intro, footer, buttons, detail, detailFooter, choice };
export type { OptionLine, Now };
