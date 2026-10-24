// 서버와 화면이 주고받는 모양: 봇 초대(/api/invite)

/** 초대할 수 있는 서버 하나. icon 은 서버가 만든 그림 주소(없으면 null), inviteUrl 은 그 서버를 미리 고른 초대 링크 */
type InviteRow = { id: string; name: string; icon: string | null; inviteUrl: string };

/** 초대 화면. ready: 서버 관리 권한이 있고 봇이 없는 서버들, relogin: 디스코드에서 서버 목록을 받으려면 다시 로그인해야 한다(토큰이 없거나 만료) */
type InviteList = { state: "ready"; guilds: InviteRow[] } | { state: "relogin" };

export type { InviteRow, InviteList };
