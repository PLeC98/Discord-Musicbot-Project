// /help 화면의 문구

import type { HelpSection, HelpTier } from "../../help-lines.ts";
import { icon, type IconKey } from "../../icons.ts";

// 명령 줄은 명령 정의에서 만든다(ui/help-lines). 여기는 섹션 이름 · 권한 표시 · 지원 플랫폼만.
// 아이콘은 그릴 때 붙인다(앱 이모지를 맞춘 뒤의 id 가 실리게). 플랫폼을 색으로 나타내는 점(🔴 🟢 🟠)은 유니코드 그대로

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
  moderator: () => icon("shield"),
  owner: () => "(봇 운영자)",
};
/** 줄 끝의 권한 표시. 누구나 쓰면 빈 문자열 */
const tierMark = (tier: HelpTier) => TIER_MARK[tier]();

/** 지원 플랫폼 필드 */
const platforms = () => ({ name: `${icon("web")} 지원 플랫폼`, lines: ["🔴 **YouTube** - 영상 링크 및 검색", "🟢 **Spotify** - 곡, 재생목록, 앨범 링크", "🟠 **SoundCloud** - 곡 링크 및 검색", "🔗 **직접 링크** - 미디어 파일 URL (MP3 · FLAC · M4A · MP4 등)"] });

/** 헤더 */
const intro = () => ({
  title: `${icon("music")} 도움말`,
  description: `${icon("dj")}: 봇과 같은 음성 채널에 있는 DJ들만 쓸 수 있어요. (서버 관리자들은 예외예요)\n⠀⠀⠀- DJ 역할이 없는 서버는 모두가 DJ예요\n${icon("shield")}: 서버 관리자들만 사용할 수 있어요.`,
});

/** 통계 필드. uptime 은 말로 적은 가동 시간 */
const stats = ({ guilds, users, active, uptime }: { guilds: number; users: number; active: number; uptime: string }) => ({
  name: `${icon("stats")} 통계`,
  lines: [`${icon("servers")} **서버:** ${guilds}개`, `${icon("users")} **사용자:** ${users.toLocaleString()}명`, `${icon("players")} **재생 중인 서버:** ${active}개`, `${icon("uptime")} **업타임:** ${uptime}`],
});

/** 링크 필드. website 는 없을 수 있다 */
const links = ({ invite, website }: { invite: string; website: string | null }) => ({
  name: `${icon("link")} 링크`,
  lines: [...(website ? [`${icon("web")} [웹사이트](${website})`] : []), `${icon("invite")} [봇 초대하기](${invite})`],
});

/** 버튼 */
const buttons = () => ({ website: "웹사이트", refresh: "새로고침" });

export { sectionName, tierMark, platforms, intro, stats, links, buttons };
