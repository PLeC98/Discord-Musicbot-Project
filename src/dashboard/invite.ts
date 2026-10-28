// 봇 초대. 누가 초대할 수 있나(디스코드 앱 정보)와, 초대할 수 있는 서버(로그인 때 받은 토큰으로 디스코드에서 받은 서버 목록).
// 봇을 서버에 넣으려면 그 서버의 서버 관리 권한이 있어야 한다. 디스코드 승인 화면이 그 권한을 다시 본다

import { PermissionFlagsBits, PermissionsBitField, type Client } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { messageOf } from "../rules/error-kind.ts";
import { userGuilds, _resetUserGuilds, type UserGuild } from "./user-guilds.ts";

/** 누가 초대할 수 있나. 공개 봇이 아니면 앱 소유자(팀이면 팀원)만 넣을 수 있고, code grant 를 요구하면 초대 링크만으로는 들어오지 않는다 */
type AppInfo = { botPublic: boolean; requireCodeGrant: boolean; ownerIds: string[] };

let appInfo: AppInfo | null = null;
let loading: Promise<void> | null = null;

/**
 * 앱 정보를 받는다(기동 마무리에서 한 번). 실패하면 초대 화면을 묻는 때 다시 받는다(한 번에 하나만).
 * 포털에서 Public Bot 을 바꾼 것은 다시 시작할 때 따라간다
 */
function loadAppInfo(client: Client): Promise<void> {
  // 봇이 준비되기 전(화면이 다시 이으며 /api/me 를 부를 때)에는 앱이 없다. 받는 중으로 두지 않아 준비된 뒤 다시 받는다
  if (!client.application) return Promise.resolve();
  loading ??= client.application
    .fetch()
    .then((app) => {
      const owner = app.owner;
      const ownerIds = !owner ? [] : "members" in owner ? [...owner.members.keys()] : [owner.id];
      appInfo = { botPublic: app.botPublic === true, requireCodeGrant: app.botRequireCodeGrant === true, ownerIds };
    })
    .catch((error: unknown) => log.warn(`디스코드 앱 정보를 받지 못해 초대 화면을 잠시 닫습니다: ${messageOf(error)}`))
    .finally(() => (loading = null));
  return loading;
}

/** 이 사람이 대시보드에서 봇을 초대할 수 있나. 앱 정보를 아직 못 받았으면 받기 시작하고 false */
function canInvite(client: Client, userId: string) {
  if (!appInfo) {
    void loadAppInfo(client);
    return false;
  }
  if (appInfo.requireCodeGrant) return false;
  return appInfo.botPublic || appInfo.ownerIds.includes(userId);
}

// ── 서버 목록 ──

/** 서버 관리 권한이 있는 서버(봇이 들었는지는 부르는 쪽이 지금 값으로 뺀다) */
type ManagedGuild = { id: string; name: string; icon: string | null };

const manages = (g: UserGuild) => g.owner || new PermissionsBitField(BigInt(g.permissions)).has(PermissionFlagsBits.ManageGuild);

/** 사용자가 관리하는 서버. 받기 · 캐시 · 거절은 user-guilds 의 userGuilds 와 같다 */
async function managedGuilds(key: string, token: string, options: Parameters<typeof userGuilds>[2] = {}) {
  const guilds = await userGuilds(key, token, options);
  return guilds.filter(manages).map(({ id, name, icon }) => ({ id, name, icon }));
}

// 테스트 시임
function _setAppInfo(info: AppInfo | null) {
  appInfo = info;
  loading = null;
  _resetUserGuilds();
}

export { loadAppInfo, canInvite, managedGuilds, _setAppInfo };
export type { AppInfo, ManagedGuild };
