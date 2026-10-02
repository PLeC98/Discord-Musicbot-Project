// /help 화면의 글자

/** 명령 목록. 칸 이름과 줄들 */
const sections = () => [
  {
    name: "🎵 재생",
    lines: ["`/play <곡/URL>`: 음악 재생", "`/playfirst <곡/URL>`: 대기열 맨 앞에 추가 🔒", "`/pause`: 일시정지 / 재개 🔒", "`/stop`: 재생 중지 및 퇴장 🔒", "`/skip`: 다음 곡 🔒 (자기가 추가한 곡은 누구나)", "`/previous`: 이전 곡 🔒", "`/replay`: 현재 곡 처음부터 🔒", "`/seek <시간>`: 특정 위치로 이동 (예: `1:30`, `90`) 🔒", "`/highlight`: 하이라이트 지점으로 이동 🔒"],
  },
  { name: "📋 대기열", lines: ["`/queue [페이지]`: 대기열 표시", "`/clear`: 대기열 비우기 🔒", "`/remove <번호>`: 특정 곡 제거 🔒 (자기가 추가한 곡은 누구나)", "`/move <from> <to>`: 곡 순서 변경 🔒", "`/shuffle`: 대기열 셔플 🔒"] },
  { name: "🎛️ 모드 & 오디오", lines: ["`/loop [mode]`: 반복 설정 (`off` · `track` · `queue`) 🔒", "`/autoplay`: 자동재생 켜기 · 끄기 (켤 때 장르 선택) 🔒", "`/volume <0-100>`: 볼륨 설정 🔒"] },
  { name: "🔍 탐색 & 정보", lines: ["`/search <검색어>`: YouTube 검색 후 선택", "`/nowplaying`: 현재 곡 상세 정보"] },
  {
    name: "📡 채널 & 세션",
    lines: ["`/join`: 음성 채널 입장 (이전 세션 복구)", "`/leave`: 퇴장 및 세션 저장 🔒", "`/setchannel`: 전용 채널 지정 (서버 관리 권한)", "`/setdjrole`: DJ 역할 지정 (서버 관리 권한)", "`/setplaylistlimit [곡 수]`: 재생목록을 한 번에 넣는 곡 수 (서버 관리 권한)", "`/sponsorblock`: SponsorBlock 자동 스킵 설정 (서버 관리 권한)", "`/dashboard`: 컨트롤 패널 재게시 (봇 전용 채널에서는 전원, 그 외 🔒)"],
  },
  { name: "📊 봇 정보", lines: ["`/ping`: 레이턴시 확인 (서버 관리 권한)", "`/system`: 시스템 상태 (봇 운영자)", "`/cachestatus`: 오디오 캐시 통계 (서버 관리 권한)", "`/license`: 라이선스와 소스 코드 위치"] },
  { name: "🌐 지원 플랫폼", lines: ["🔴 **YouTube** - 영상 링크 및 검색", "🟢 **Spotify** - 곡, 재생목록, 앨범 링크", "🟠 **SoundCloud** - 곡 링크 및 검색", "🔗 **직접 링크** - 미디어 파일 URL (MP3 · FLAC · M4A · MP4 등)"] },
];

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

export { sections, intro, stats, links, buttons };
