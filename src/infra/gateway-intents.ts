// 이 프로세스가 로그인할 때 요청한 특권 인텐트(디스코드 개발자 포털의 Bot → Privileged Gateway Intents).
// 기동할 때 앱 설정을 읽어 켜진 것만 요청하고(app/privileged-intents), 이 인텐트가 필요한 기능(전용 채널에 채팅으로 곡 넣기, 대시보드의 서버 화면)이 이 값을 본다.
// 실행 중에 포털 스위치를 켜도 이 값은 바뀌지 않는다. 다시 시작해야 적용된다(멤버 캐시는 새 게이트웨이 세션에서 찬다)

type Privileged = "messageContent" | "guildMembers";
type Switches = Record<Privileged, boolean>;
/** 앱 객체에서 읽는 것(GET /applications/@me) */
type AppFlags = { id?: unknown; flags?: unknown; approximate_guild_count?: unknown };

/** 앱 flags의 비트. 100 서버 미만은 포털 스위치(_LIMITED), 이상은 디스코드의 승인(FULL) */
const FLAGS = {
  guildMembers: { full: 1 << 14, limited: 1 << 15 },
  messageContent: { full: 1 << 18, limited: 1 << 19 },
} as const;
/** 개발자 포털에 적힌 스위치 이름(로그) */
const INTENT_NAMES: Record<Privileged, string> = { messageContent: "Message Content Intent", guildMembers: "Server Members Intent" };
/** 이 서버 수부터는 포털 스위치가 아니라 승인이 필요하다 */
const APPROVAL_SERVERS = 100;

/** 서버 수. 모르면 null */
function serversOf(app: AppFlags | null) {
  const count = app?.approximate_guild_count;
  return typeof count === "number" && Number.isFinite(count) ? count : null;
}

/** 승인이 필요한 규모인가(서버 수를 모르면 아니라고 본다) */
const needsApproval = (app: AppFlags | null) => (serversOf(app) ?? 0) >= APPROVAL_SERVERS;

/** 앱 설정에서 켜진 특권 인텐트. 승인이 필요한 규모면 FULL만, 아니면 _LIMITED나 FULL을 켜진 것으로 본다. flags가 없으면 알 수 없어 null */
function switchesOf(app: AppFlags | null): Switches | null {
  const flags = app?.flags;
  if (typeof flags !== "number" || !Number.isInteger(flags)) return null;
  const approved = needsApproval(app);
  const on = (bits: { full: number; limited: number }) => (flags & bits.full) !== 0 || (!approved && (flags & bits.limited) !== 0);
  return { messageContent: on(FLAGS.messageContent), guildMembers: on(FLAGS.guildMembers) };
}

let loggedIn: Switches = { messageContent: true, guildMembers: true };

/** 기동이 로그인한 특권 인텐트를 적는다(로그인 전에 한 번) */
function useLoggedIn(switches: Switches) {
  loggedIn = { ...switches };
}

/** 이 프로세스가 로그인한 특권 인텐트 */
const loggedInIntents = (): Readonly<Switches> => loggedIn;

/** 다른 사용자가 보낸 메시지의 내용을 받는가(전용 채널에 채팅으로 곡 넣기) */
const readsMessageContent = () => loggedIn.messageContent;

/** 멤버 갱신, 탈퇴를 받는가(대시보드의 서버 화면이 멤버 캐시로 권한을 판정한다) */
const tracksMembers = () => loggedIn.guildMembers;

/** 테스트: 처음 상태(둘 다 켜짐)로 */
function _resetIntents() {
  loggedIn = { messageContent: true, guildMembers: true };
}

export { FLAGS, INTENT_NAMES, APPROVAL_SERVERS, switchesOf, serversOf, needsApproval, useLoggedIn, loggedInIntents, readsMessageContent, tracksMembers, _resetIntents };
export type { Privileged, Switches, AppFlags };
