// 앱 정보(GET /applications/@me)에서 봇 운영자와 봇을 초대할 수 있는 사람을 정한다.
// 팀 앱의 owner 는 사람이 아니라 팀을 나타내는 가짜 사용자라 쓰지 않는다. 팀 소유자는 role 필드에 없어 team.owner_user_id 로 알아낸다

/** 운영자를 넓히는 범위. owner: 소유자만, admin: 팀 Admin 까지, developer: 팀 Developer 까지 */
const OPERATOR_SCOPES = ["owner", "admin", "developer"] as const;
type OperatorScope = (typeof OPERATOR_SCOPES)[number];

/** 팀원. accepted: 초대를 수락했다(membership_state 2) */
type TeamMember = { id: string; name: string; role: string; accepted: boolean };

/** 봇 공개 설정. 모르는 값은 null */
type InviteFlags = { botPublic: boolean | null; requireCodeGrant: boolean | null };

/** 형식을 확인한 앱 정보. 개인 앱이거나 팀 앱이다 */
type AppOwners = ({ kind: "personal"; ownerId: string; ownerName: string } & InviteFlags) | ({ kind: "team"; ownerId: string; members: TeamMember[] } & InviteFlags);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown) => (typeof value === "string" && value ? value : null);
const flag = (value: unknown) => (typeof value === "boolean" ? value : null);

/** 팀원 하나. 형식이 틀리면 null */
function memberOf(raw: unknown): TeamMember | null {
  if (!isObject(raw) || !isObject(raw.user)) return null;
  const id = text(raw.user.id);
  if (!id || typeof raw.role !== "string") return null;
  return { id, name: text(raw.user.username) ?? id, role: raw.role, accepted: raw.membership_state === 2 };
}

/**
 * 응답에서 운영자, 초대에 쓰는 것을 꺼낸다. 개인 앱은 team 이 null, 팀 앱은 team 이 객체로 온다.
 * 그 밖(team 이 없거나 형식이 틀림)은 모르는 것으로 null 이다. 모르면 팀 앱의 가짜 사용자를 소유자로 잘못 읽을 수 있다
 */
function readAppOwners(raw: unknown): AppOwners | null {
  if (!isObject(raw)) return null;
  const flags: InviteFlags = { botPublic: flag(raw.bot_public), requireCodeGrant: flag(raw.bot_require_code_grant) };
  if (raw.team === null) {
    const owner = isObject(raw.owner) ? raw.owner : null;
    const ownerId = text(owner?.id);
    return ownerId ? { kind: "personal", ownerId, ownerName: text(owner?.username) ?? ownerId, ...flags } : null;
  }
  if (!isObject(raw.team) || !Array.isArray(raw.team.members)) return null;
  const ownerId = text(raw.team.owner_user_id);
  if (!ownerId) return null;
  const members = raw.team.members.map(memberOf);
  if (members.some((one) => one === null)) return null;
  return { kind: "team", ownerId, members: members as TeamMember[], ...flags };
}

/** 범위마다 운영자에 넣는 팀 역할 */
const ROLES_IN: Record<OperatorScope, readonly string[]> = { owner: [], admin: ["admin"], developer: ["admin", "developer"] };

/** 운영자. 개인 앱은 소유자, 팀 앱은 팀 소유자와, 범위가 넣는 역할이면서 초대를 수락한 팀원(Read-only 는 넣지 않는다) */
function operatorsOf(app: AppOwners, scope: OperatorScope): string[] {
  if (app.kind === "personal") return [app.ownerId];
  const widened = app.members.filter((one) => one.accepted && ROLES_IN[scope].includes(one.role)).map((one) => one.id);
  return [...new Set([app.ownerId, ...widened])];
}

/** 운영자의 이름(로그). 모르면 ID */
function nameOf(app: AppOwners, id: string) {
  if (app.kind === "personal") return id === app.ownerId ? app.ownerName : id;
  return app.members.find((one) => one.id === id)?.name ?? id;
}

/**
 * 대시보드에서 봇을 초대할 수 있나. 공개 봇이면 누구나, 아니면 소유자(팀이면 팀 소유자와 수락한 팀원 전부. 디스코드가 Read-only 도 비공개 봇을 초대하게 한다).
 * code grant 를 요구하지 않는다고 확인될 때만이다(요구하면 초대 링크만으로는 들어오지 않는다). 앱 정보를 모르면 아무도
 */
function canInviteBy(app: AppOwners | null, userId: string): boolean {
  if (!app || app.requireCodeGrant !== false) return false;
  if (app.botPublic === true) return true;
  if (app.botPublic !== false) return false;
  if (app.kind === "personal") return userId === app.ownerId;
  return userId === app.ownerId || app.members.some((one) => one.accepted && one.id === userId);
}

/** 덮어쓰기 목록(OWNER_ID, 쉼표로 여럿). 비었으면 null. 형식은 보지 않고 적힌 그대로다(틀리면 아무와도 맞지 않는다) */
function overrideIds(value: string | null | undefined): string[] | null {
  const ids = String(value ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter(Boolean);
  return ids.length ? ids : null;
}

const isOperatorScope = (value: unknown): value is OperatorScope => (OPERATOR_SCOPES as readonly unknown[]).includes(value);

export { OPERATOR_SCOPES, readAppOwners, operatorsOf, nameOf, canInviteBy, overrideIds, isOperatorScope };
export type { AppOwners, OperatorScope, TeamMember };
