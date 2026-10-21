// 서버와 화면이 주고받는 모양: 누구인가(/api/me · /api/bot)와 권한 수준 오버라이드.
// contract/ 는 서버 경로가 이 모양으로 답하고 화면이 타입으로 받는 곳이다. 브라우저도 부르므로 Node 를 부르지 않는다

/** 권한 수준 오버라이드의 계층. 높은 쪽부터(화면이 이 순서로 그린다) */
const TIERS = ["moderator", "dj", "user"] as const;
type Tier = (typeof TIERS)[number];
const isTier = (v: unknown): v is Tier => TIERS.some((t) => t === v);

/**
 * /api/me. avatarUrl 은 프로필 그림(없으면 null), isOwner 는 오버라이드가 반영된 값, isRealOwner 는 해제 수단을 계속 보이려는 원래 값,
 * canInvite 는 대시보드에서 봇을 초대할 수 있는가(공개 봇이거나 앱 소유자 · 팀원이고, code grant 를 요구하지 않는다)
 */
type Me = { id: string; username: string; globalName: string; avatar: string | null; avatarUrl: string | null; isOwner: boolean; isRealOwner: boolean; viewAs: Tier | null; canInvite: boolean };

/** /api/bot. 로그인 전 화면이 쓰는 봇의 공개 정보. 이름 · 그림은 봇이 준비되기 전이면 null.
 *  brandColor 는 운영자가 정한 임베드 색(EMBED_COLOR, #RRGGBB). 앨범아트가 없을 때 화면 색 체계의 바탕색이다.
 *  faviconVersion 은 파비콘의 버전(올리거나 지울 때마다 오른다) */
type BotInfo = { name: string | null; avatarUrl: string | null; sourceRepo: string; projectRepo: string; brandColor: string; faviconVersion: number };

/** 로그인 콜백이 로그인 화면으로 돌려보낼 때 싣는 까닭(?error=): 승인 화면에서 취소 · 인증 코드가 없음 · 디스코드가 봇의 앱 자격(시크릿)을 거절 · 그 밖의 실패 */
type LoginError = "denied" | "no_code" | "bad_client" | "auth_failed";
/** 로그인 실패로 돌려보낼 주소 */
const loginFailed = (why: LoginError) => `/?error=${why}`;

/** /api/admin/view-as 의 답 */
type ViewAsReply = { viewAs: Tier | null };

/** 위험한 조작(비밀값 바꾸기 등)을 받는 로그인 뒤의 시간. 지나면 reauth-required(middleware/recent-login) */
const RECENT_LOGIN_MS = 10 * 60_000;

export { TIERS, isTier, loginFailed, RECENT_LOGIN_MS };
export type { Tier, Me, BotInfo, LoginError, ViewAsReply };
