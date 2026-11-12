// /help 화면의 문구

import type { HelpSection, HelpTier } from "../../help-lines.ts";
import { icon, type IconKey } from "../../icons.ts";

// 명령 줄은 명령 정의에서 만든다(ui/help-lines). 여기는 첫 화면, 섹션 이름, 권한 표시와 그 뜻, 메뉴와 버튼 이름만.
// 아이콘은 그릴 때 붙인다(앱 이모지를 동기화한 뒤의 id 가 실리게)

const SECTION: Record<HelpSection, { icon: IconKey; name: string }> = {
  play: { icon: "music", name: "재생" },
  queue: { icon: "queue", name: "대기열" },
  mode: { icon: "modes", name: "모드 & 오디오" },
  explore: { icon: "search", name: "탐색 & 정보" },
  channel: { icon: "session", name: "채널 & 세션" },
  info: { icon: "stats", name: "봇 정보" },
};
/** 섹션의 아이콘 키와 이름 */
const section = (key: HelpSection) => SECTION[key];

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

const DJ_LEGEND = () => `${icon("dj")} 봇과 같은 음성 채널에 있는 DJ만 쓸 수 있어요. DJ 역할이 없는 서버는 모두가 DJ이고, 서버 관리자는 늘 쓸 수 있어요.`;
const LEGEND: Record<HelpTier, (() => string) | null> = {
  everyone: null,
  dj: DJ_LEGEND,
  "dj-or-requester": DJ_LEGEND,
  "dj-outside-bot-channel": DJ_LEGEND,
  "server-manager": () => `${icon("shield")} 서버 관리자만 쓸 수 있어요.`,
  owner: null,
};
/** 섹션 화면의 작은 글씨: 그 섹션에 나온 권한 표시의 뜻 */
const legend = (tiers: HelpTier[]) => [...new Set(tiers.map((tier) => LEGEND[tier]).filter((line) => line !== null))].map((line) => line());

/** 첫 화면. play 는 /play 의 멘션, dashboard 는 웹 대시보드 버튼이 있는지 */
const home = ({ play, dashboard }: { play: string; dashboard: boolean }) => ({
  title: "도움말",
  lines: [`- 음성 채널에 들어가서 ${play}로 곡을 틀어요. 재생 패널의 버튼으로도 조작할 수 있어요.`, "- 전용 채널이 있는 서버는 그 채널에 곡 이름이나 링크만 넣어도 돼요.", ...(dashboard ? ["- 모든 조작과 설정은 웹 대시보드에서도 할 수 있어요."] : [])],
});

/** 메뉴와 버튼 */
const controls = () => ({ placeholder: "명령어 분류를 골라 주세요", back: "뒤로", dashboard: "웹 대시보드" });

export { section, tierMark, legend, home, controls };
