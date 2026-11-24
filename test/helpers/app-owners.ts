// 테스트가 넣는 디스코드 앱 정보(GET /applications/@me 응답 형식): 운영자, 초대 권한을 정하는 필드만

type Flags = { botPublic?: boolean; codeGrant?: boolean };
type Member = { id: string; role: "admin" | "developer" | "read_only"; state?: 1 | 2 };

/** 개인 앱. 소유자 한 명 */
const personalApp = (ownerId: string, { botPublic = false, codeGrant = false }: Flags = {}) => ({
  id: "123456789012345678",
  team: null,
  owner: { id: ownerId, username: `name-${ownerId}` },
  bot_public: botPublic,
  bot_require_code_grant: codeGrant,
});

/** 팀 앱. owner 는 팀을 나타내는 가짜 사용자다(운영자로 쓰지 않는다). state 를 비우면 수락한 팀원(2) */
const teamApp = (ownerId: string, members: Member[], { botPublic = false, codeGrant = false }: Flags = {}) => ({
  id: "123456789012345678",
  owner: { id: "team-pseudo-user", username: "team123", flags: 1024 },
  team: {
    id: "team-1",
    owner_user_id: ownerId,
    members: members.map(({ id, role, state = 2 }) => ({ user: { id, username: `name-${id}` }, role, membership_state: state, team_id: "team-1" })),
  },
  bot_public: botPublic,
  bot_require_code_grant: codeGrant,
});

export { personalApp, teamApp };
