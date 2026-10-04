// 서버와 화면이 주고받는 모양: 누구인가(/api/me · /api/bot)와 권한 수준 오버라이드.
// contract/ 는 서버 경로가 이 모양으로 답하고 화면이 타입으로 받는 곳이다. 브라우저도 부르므로 Node 를 부르지 않는다

/** 권한 수준 오버라이드의 계층. 높은 쪽부터(화면이 이 차례로 그린다) */
const TIERS = ["owner", "moderator", "dj", "user"] as const;
type Tier = (typeof TIERS)[number];
const isTier = (v: unknown): v is Tier => TIERS.some((t) => t === v);

/** /api/me. isOwner 는 오버라이드가 반영된 값, isRealOwner 는 해제 수단을 계속 보이려는 원래 값 */
type Me = { id: string; username: string; globalName: string; avatar: string | null; isOwner: boolean; isRealOwner: boolean; viewAs: Tier | null };

/** /api/bot. 로그인 전 화면이 쓰는 봇의 공개 정보. 이름 · 그림은 봇이 준비되기 전이면 null */
type BotInfo = { name: string | null; avatarUrl: string | null; sourceRepo: string; projectRepo: string };

/** /api/admin/view-as 의 답 */
type ViewAsReply = { viewAs: Tier | null };

export { TIERS, isTier };
export type { Tier, Me, BotInfo, ViewAsReply };
