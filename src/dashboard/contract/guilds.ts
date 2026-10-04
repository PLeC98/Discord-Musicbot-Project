// 서버와 화면이 주고받는 모양: 서버 목록 · 실시간 알림 · 서버 설정(/api/guilds 아래)

/** 서버 목록의 상태: 봇이 음성 채널 밖 = idle, 곡을 트는 중 = playing, 일시정지 = paused, 음성 채널에 있지만 곡이 없다 = waiting */
type ListState = "idle" | "playing" | "paused" | "waiting";

/** 서버 목록의 한 줄. canManageGuild 는 그 서버의 "서버 관리" 권한, listening 은 봇과 같은 음성 채널에 있는지(전역 재생 바가 고르는 기준) */
type GuildRow = { id: string; name: string; icon: string | null; canManageGuild: boolean; hasPlayer: boolean; state: ListState; memberCount: number; listening: boolean };
type GuildList = { guilds: GuildRow[] };

/** 실시간 알림(/api/guilds/events)의 한 건. 받은 화면이 그 서버의 상태를 다시 읽는다 */
type GuildEvent = { t: "changed"; g: string };

/** 서버 설정 화면. value 는 저장값(null 이면 기본), effective 는 실제로 쓰는 값 */
type GuildSettings = {
  guildName: string;
  canEdit: boolean;
  djRoleIds: string[];
  botChannelId: string | null;
  roles: Array<{ id: string; name: string; color: string | null }>;
  channels: Array<{ id: string; name: string }>;
  sponsorblock: { masterEnabled: boolean; enabled: boolean; categories: string[]; available: Array<{ id: string; label: string; description: string }> };
  playlistAdd: { value: number | null; effective: number; min: number; max: number; default: number };
};

/** 서버 설정 저장의 답 */
type Saved = { success: true };

export type { ListState, GuildRow, GuildList, GuildEvent, GuildSettings, Saved };
