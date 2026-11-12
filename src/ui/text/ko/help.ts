// /help 화면의 문구

import type { HelpSection, HelpTier } from "../../help-lines.ts";
import { icon, type IconKey } from "../../icons.ts";

// 명령 줄은 명령 정의에서 만든다(ui/help-lines). 여기는 첫 화면, 섹션 이름과 설명, 권한 표시와 그 뜻, 메뉴와 버튼 이름만.
// 아이콘은 그릴 때 붙인다(앱 이모지를 동기화한 뒤의 id 가 실리게)

const SECTION: Record<HelpSection, { icon: IconKey; name: string; about: string }> = {
  play: { icon: "music", name: "재생", about: "곡을 틀고, 멈추고, 넘기고, 원하는 시간으로 옮겨요." },
  queue: { icon: "queue", name: "대기열", about: "대기열을 보고, 곡을 빼거나 옮기고, 섞어요." },
  mode: { icon: "modes", name: "모드 & 오디오", about: "반복, 자동재생, 볼륨을 정해요." },
  explore: { icon: "search", name: "탐색 & 정보", about: "곡을 검색하고, 지금 곡의 정보를 봐요." },
  channel: { icon: "session", name: "채널 & 세션", about: "봇을 부르거나 내보내고, 상주 모드와 서버 설정을 다뤄요." },
  info: { icon: "stats", name: "봇 정보", about: "응답 시간, 라이선스, 초대 링크 같은 봇 정보를 봐요." },
};
/** 섹션의 아이콘 키, 이름, 설명 */
const section = (key: HelpSection) => SECTION[key];

const TIER_MARK: Record<HelpTier, () => string> = {
  everyone: () => "",
  dj: () => icon("dj"),
  "dj-or-requester": () => `${icon("dj")} (자기가 추가한 곡은 누구나)`,
  "dj-outside-bot-channel": () => `(봇 전용 채널에서는 누구나, 그 외 ${icon("dj")})`,
  "server-manager": () => icon("shield"),
  owner: () => icon("owner"),
};
/** 줄 끝의 권한 표시. 누구나 쓰면 빈 문자열 */
const tierMark = (tier: HelpTier) => TIER_MARK[tier]();
/** 보는 사람이 쓸 수 없는 명령의 표시 */
const lockMark = () => icon("locked");

const DJ_LEGEND = () => `${icon("dj")} DJ만 쓸 수 있어요. DJ 역할이 없는 서버는 모두가 DJ예요.`;
const LEGEND: Record<HelpTier, (() => string) | null> = {
  everyone: null,
  dj: DJ_LEGEND,
  "dj-or-requester": DJ_LEGEND,
  "dj-outside-bot-channel": DJ_LEGEND,
  "server-manager": () => `${icon("shield")} 서버 관리자만 쓸 수 있어요.`,
  owner: () => `${icon("owner")} 봇 운영자만 쓸 수 있어요.`,
};
/** 섹션 화면의 작은 글씨: 그 섹션에 나온 표시의 뜻. locked 는 자물쇠가 붙은 줄이 있는지 */
const legend = (tiers: HelpTier[], locked: boolean) => [...[...new Set(tiers.map((tier) => LEGEND[tier]).filter((line) => line !== null))].map((line) => line()), ...(locked ? [`${icon("locked")} 지금 내 권한으로는 쓸 수 없어요.`] : [])];

/** 첫 화면. play 는 /play 의 멘션, help 는 /help 의 멘션, sections 는 명령이 있는 섹션 */
const home = ({ play, help, sections }: { play: string; help: string; sections: HelpSection[] }) => ({
  title: "도움말",
  lines: [`음성 채널에 들어가서 ${play}로 곡을 틀어요. 재생 패널의 버튼으로도 조작할 수 있어요.`, "", ...sections.map((key) => `**${icon(SECTION[key].icon)} ${SECTION[key].name}**: ${SECTION[key].about}`)],
  footer: `아래 메뉴나 ${help}의 분류 칸으로 분류마다 명령어를 볼 수 있어요.`,
});

/** /help 의 분류 칸, 메뉴와 버튼 */
const controls = () => ({ option: "분류", optionDescription: "바로 볼 명령어 분류", placeholder: "명령어 분류를 골라 주세요", back: "뒤로", dashboard: "웹 대시보드" });

export { section, tierMark, lockMark, legend, home, controls };
