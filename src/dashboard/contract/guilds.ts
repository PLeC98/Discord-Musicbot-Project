// 백엔드와 화면이 주고받는 모양: 서버 목록 · 실시간 알림 · 서버 설정(/api/guilds 아래)

import type { AgePlace } from "../../rules/age-place.ts";

/** 서버 목록의 상태: 봇이 음성 채널 밖 = idle, 곡을 트는 중 = playing, 일시정지 = paused, 음성 채널에 있지만 곡이 없다 = waiting */
type ListState = "idle" | "playing" | "paused" | "waiting";

/** 서버 목록의 지금 곡. 곡이 없으면 null */
type GuildTrack = { title: string | null; artist: string | null; thumbnail: string | null };

/** 서버 목록의 한 줄. canManageGuild 는 그 서버의 "서버 관리" 권한, listening 은 봇과 같은 음성 채널에 있는지(전역 재생 바가 선택하는 기준), nowPlaying 은 그 서버의 지금 곡 */
type GuildRow = { id: string; name: string; icon: string | null; canManageGuild: boolean; hasPlayer: boolean; state: ListState; memberCount: number; listening: boolean; nowPlaying: GuildTrack | null };
/** relogin: 디스코드에서 사용자의 서버 목록을 받지 못해(토큰이 없거나 거절됨) 이미 확인한 서버만 보인다. 다시 로그인하면 모두 보인다 */
type GuildList = { guilds: GuildRow[]; relogin?: true };

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
  sponsorblock: { masterEnabled: boolean; enabled: boolean; categories: string[] };
  playlistAdd: { value: number | null; effective: number; min: number; max: number; default: number };
  /** 연령 제한 콘텐츠를 틀 곳. 운영자가 연령 제한 콘텐츠를 꺼 두었으면 null(화면에 입력란이 없다) */
  agePlace: AgePlace | null;
  /** 24/7. channel 은 자리 채널(꺼져 있으면 null). 운영자가 봇 전체에서 껐으면 null(화면에 카드가 없다) */
  stay: StayView | null;
};

/** 24/7 의 지금 상태 */
type StayView = { channel: { id: string; name: string } | null };
/** 24/7 켜기 · 끄기의 답 */
type StaySet = { success: true; stay: StayView };

/** 서버 설정 저장의 답 */
type Saved = { success: true };

export type { ListState, GuildTrack, GuildRow, GuildList, GuildEvent, GuildSettings, Saved, StayView, StaySet };
