// 서버와 화면이 주고받는 모양: 누구인가(/api/me, /api/bot)와 권한 수준 오버라이드.
// contract/ 는 서버 경로가 이 모양으로 응답하고 화면이 타입으로 받는 곳이다. 브라우저도 부르므로 Node를 부르지 않는다

import type { Language } from "../../rules/languages.ts";

/** 권한 수준 오버라이드의 계층. 높은 쪽부터(화면이 이 순서로 그린다) */
const TIERS = ["server-manager", "dj", "user"] as const;
type Tier = (typeof TIERS)[number];
const isTier = (v: unknown): v is Tier => TIERS.some((t) => t === v);
/** 계층의 높이(높을수록 큰 수) */
const TIER_RANK: Record<Tier, number> = { "server-manager": 2, dj: 1, user: 0 };

/**
 * /api/me. avatarUrl은 프로필 이미지(없으면 null), isOwner는 오버라이드가 반영된 값, isRealOwner는 해제 수단을 계속 보이려는 원래 값,
 * canInvite는 대시보드에서 봇을 초대할 수 있는가(공개 봇이거나 앱 소유자, 팀원이고, code grant를 요구하지 않는다),
 * intents는 봇이 로그인한 특권 인텐트(guildMembers가 꺼지면 서버 화면을, messageContent가 꺼지면 전용 채널에 채팅으로 곡 넣기를 쓸 수 없다),
 * language는 개인 언어(디스코드의 본인 응답과 같은 값)
 */
type Me = { id: string; username: string; globalName: string; avatar: string | null; avatarUrl: string | null; isOwner: boolean; isRealOwner: boolean; viewAs: Tier | null; canInvite: boolean; intents: { messageContent: boolean; guildMembers: boolean }; language: MyLanguage };

/** 개인 언어: 언어, 직접 고른 자동("auto"), 정한 적 없음(null, 자동으로 동작한다). 저장한 언어가 지금 쓸 수 없는 언어면 화면은 자동으로 처리한다 */
type MyLanguage = Language | "auto" | null;
/** 고를 수 있는 언어. name은 그 언어로 쓴 이름 */
type LanguageChoice = { tag: Language; name: string };
/** PUT /api/me/language의 본문. 응답은 저장한 값({ language }) */
type MyLanguageBody = { language: Language | "auto" };

/** /api/bot. 로그인 전 화면이 쓰는 봇의 공개 정보. 이름, 프로필 이미지는 봇이 준비되기 전이면 null.
 *  brandColor는 운영자가 정한 임베드 색(EMBED_COLOR, #RRGGBB). 앨범아트가 없을 때 화면 색 체계의 바탕색이다.
 *  faviconVersion은 파비콘의 버전(올리거나 지울 때마다 오른다), languages는 지금 쓸 수 있는 언어, botLanguage는 봇 기본 언어 */
type BotInfo = { name: string | null; avatarUrl: string | null; sourceRepo: string; projectRepo: string; brandColor: string; faviconVersion: number; languages: LanguageChoice[]; botLanguage: Language };

/**
 * 로그인 화면으로 돌려보낼 때 싣는 원인 코드(?error=). 로그인 콜백: 승인 화면에서 취소(denied), 인증 코드 없음(no_code), 디스코드가 봇의 앱 자격(시크릿)을 거절(bad_client), 그 밖의 실패(auth_failed).
 * 화면의 로그아웃: 로그아웃은 됐지만 세션 저장소에 반영하지 못했다(sign-out-unsaved)
 */
type LoginError = "denied" | "no_code" | "bad_client" | "auth_failed" | "sign_out_unsaved";
/** 로그인 실패로 돌려보낼 주소 */
const loginFailed = (why: LoginError) => `/?error=${why}`;

/** /api/admin/view-as의 응답 */
type ViewAsReply = { viewAs: Tier | null };

/** 위험한 조작(비밀값 바꾸기 등)을 받는 로그인 뒤의 시간. 지나면 reauth-required(middleware/recent-login) */
const RECENT_LOGIN_MS = 10 * 60_000;
/**
 * 다른 기기 로그아웃을 재인증 없이 허용하는 로그인 후 유효 시간. 거의 언제나 재로그인을 거치게 해 현재 기기의 세션 ID도 바꾼다(세션 고정 방어용 새 ID 발급).
 * 그래서 이 기기의 쿠키를 복제한 쪽도 끊긴다
 */
const SIGN_OUT_LOGIN_MS = 2 * 60_000;

export { TIERS, isTier, TIER_RANK, loginFailed, RECENT_LOGIN_MS, SIGN_OUT_LOGIN_MS };
/** 로그인한 기기가 있는 곳. private: 내부망(집, 같은 망), geo: IP 위치(모르는 필드는 null), null: 모름(위치 DB를 껐거나 없다) */
type DevicePlace = { kind: "private" } | { kind: "geo"; city: string | null; region: string | null; country: string | null } | null;
/**
 * 설정 창 "계정"의 로그인한 기기 하나. id는 세션을 가리키는 핸들(세션 id가 아니다). current: 지금 이 기기.
 * known: 기기 기록이 있다(없으면 이 기능 전에 로그인하고 그 뒤로 쓰지 않은 세션). kind: desktop, mobile, tablet, 모르면 null
 */
type LoginDevice = { id: string; current: boolean; known: boolean; browser: string | null; os: string | null; kind: "desktop" | "mobile" | "tablet" | null; signedInAt: number | null; seenAt: number | null; place: DevicePlace };
/** geoip: 위치를 IP 위치 DB로 보였다(출처 링크를 단다) */
type LoginDevices = { devices: LoginDevice[]; geoip: boolean };
/** 로그아웃시킨 세션 수 */
type SignedOut = { count: number };

export type { Tier, Me, MyLanguage, LanguageChoice, MyLanguageBody, BotInfo, LoginError, ViewAsReply, DevicePlace, LoginDevice, LoginDevices, SignedOut };
