// 봇 초대. 누가 초대할 수 있나(디스코드 앱 정보)와, 초대할 수 있는 서버(로그인 때 받은 토큰으로 디스코드에서 받은 서버 목록).
// 봇을 서버에 넣으려면 그 서버의 서버 관리 권한이 있어야 한다. 디스코드 승인 화면이 그 권한을 다시 본다

import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { userGuilds, type UserGuild } from "./user-guilds.ts";
import { appOwners } from "../usecases/app-owners.ts";
import { canInviteBy } from "../rules/app-owners.ts";

/** 이 사용자가 대시보드에서 봇을 초대할 수 있나(앱 정보는 usecases/app-owners 가 보관한다. 기동이 넣고 다시 받는다) */
const canInvite = (userId: string) => canInviteBy(appOwners(), userId);

// ── 서버 목록 ──

/** 서버 관리 권한이 있는 서버(봇이 들었는지는 호출부가 지금 값으로 뺀다) */
type ManagedGuild = { id: string; name: string; icon: string | null };

const manages = (g: UserGuild) => g.owner || new PermissionsBitField(BigInt(g.permissions)).has(PermissionFlagsBits.ManageGuild);

/** 사용자가 관리하는 서버. 받기, 캐시, 거절은 user-guilds의 userGuilds와 같다 */
async function managedGuilds(key: string, token: string, options: Parameters<typeof userGuilds>[2] = {}) {
  const guilds = await userGuilds(key, token, options);
  return guilds.filter(manages).map(({ id, name, icon }) => ({ id, name, icon }));
}

export { canInvite, managedGuilds };
export type { ManagedGuild };
