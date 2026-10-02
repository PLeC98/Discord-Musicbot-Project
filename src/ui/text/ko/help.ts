// /help 화면의 글자

import type { HelpSection, HelpTier } from "../../helpLines.ts";

// 명령 줄은 명령 정의에서 만든다(ui/helpLines). 여기는 묶음 이름 · 권한 표시 · 지원 플랫폼만

const SECTION_NAME: Record<HelpSection, string> = {
  play: "🎵 재생",
  queue: "📋 대기열",
  mode: "🎛️ 모드 & 오디오",
  explore: "🔍 탐색 & 정보",
  channel: "📡 채널 & 세션",
  info: "📊 봇 정보",
};
/** 묶음 이름 */
const sectionName = (section: HelpSection) => SECTION_NAME[section];

const TIER_MARK: Record<HelpTier, string> = {
  everyone: "",
  dj: "🔒",
  "dj-or-requester": "🔒 (자기가 추가한 곡은 누구나)",
  "dj-outside-bot-channel": "(봇 전용 채널에서는 전원, 그 외 🔒)",
  moderator: "(서버 관리 권한)",
  owner: "(봇 운영자)",
};
/** 줄 끝의 권한 표시. 누구나 쓰면 빈 글자 */
const tierMark = (tier: HelpTier) => TIER_MARK[tier];

/** 지원 플랫폼 칸 */
const platforms = () => ({ name: "🌐 지원 플랫폼", lines: ["🔴 **YouTube** - 영상 링크 및 검색", "🟢 **Spotify** - 곡, 재생목록, 앨범 링크", "🟠 **SoundCloud** - 곡 링크 및 검색", "🔗 **직접 링크** - 미디어 파일 URL (MP3 · FLAC · M4A · MP4 등)"] });

/** 머리 */
const intro = () => ({
  title: "🎵 도움말",
  description: "🔒 표시 명령은 **봇과 같은 음성 채널에 있는 DJ**만 쓸 수 있어요. 서버 관리자는 채널에 없어도 쓸 수 있어요.\nDJ 역할을 정하지 않은 서버에서는 모두가 DJ 역할을 가진 것으로 간주해요. (`/setdjrole`)",
});

/** 통계 칸. uptime 은 말로 적은 가동 시간 */
const stats = ({ guilds, users, active, uptime }: { guilds: number; users: number; active: number; uptime: string }) => ({
  name: "📊 통계",
  lines: [`🏠 **서버:** ${guilds}개`, `👥 **사용자:** ${users.toLocaleString()}명`, `🎵 **재생 중인 서버:** ${active}개`, `⏱️ **업타임:** ${uptime}`],
});

/** 링크 칸. website 는 없을 수 있다 */
const links = ({ invite, website }: { invite: string; website: string | null }) => ({
  name: "🔗 링크",
  lines: [...(website ? [`[🌐 웹사이트](${website})`] : []), `[📄 봇 초대하기](${invite})`],
});

/** 버튼 */
const buttons = () => ({ website: "웹사이트", refresh: "새로고침" });

export { sectionName, tierMark, platforms, intro, stats, links, buttons };
