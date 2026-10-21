// 봇 초대. 누가 초대할 수 있나(디스코드 앱 정보)와, 초대할 수 있는 서버(로그인 때 받은 토큰으로 디스코드에서 받은 서버 목록).
// 봇을 서버에 넣으려면 그 서버의 서버 관리 권한이 있어야 한다. 디스코드 승인 화면이 그 권한을 다시 본다

import { PermissionFlagsBits, PermissionsBitField, type Client } from "discord.js";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { messageOf } from "../rules/error-kind.ts";
import { DISCORD_API, discordHttp, type DiscordHttp } from "./discord-api.ts";

/** 누가 초대할 수 있나. 공개 봇이 아니면 앱 소유자(팀이면 팀원)만 넣을 수 있고, code grant 를 요구하면 초대 링크만으로는 들어오지 않는다 */
type AppInfo = { botPublic: boolean; requireCodeGrant: boolean; ownerIds: string[] };

let appInfo: AppInfo | null = null;
let loading: Promise<void> | null = null;

/**
 * 앱 정보를 받는다(기동 마무리에서 한 번). 실패하면 초대 화면을 묻는 때 다시 받는다(한 번에 하나만).
 * 포털에서 Public Bot 을 바꾼 것은 다시 시작할 때 따라간다
 */
function loadAppInfo(client: Client): Promise<void> {
  loading ??= client.application
    ? client.application
        .fetch()
        .then((app) => {
          const owner = app.owner;
          const ownerIds = !owner ? [] : "members" in owner ? [...owner.members.keys()] : [owner.id];
          appInfo = { botPublic: app.botPublic === true, requireCodeGrant: app.botRequireCodeGrant === true, ownerIds };
        })
        .catch((error: unknown) => log.warn(`디스코드 앱 정보를 받지 못해 초대 화면을 잠시 닫습니다: ${messageOf(error)}`))
        .finally(() => (loading = null))
    : Promise.resolve();
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

/** 디스코드가 주는 서버 목록에서 읽는 필드(/users/@me/guilds). permissions 는 서버 단위 권한 비트 */
type UserGuild = { id: string; name: string; icon: string | null; owner: boolean; permissions: string };
/** 서버 관리 권한이 있는 서버(봇이 들었는지는 부르는 쪽이 지금 값으로 뺀다) */
type ManagedGuild = { id: string; name: string; icon: string | null };

/** 받은 목록을 세션마다 잠깐 둔다. 화면을 다시 열거나 봇이 들고 나서 다시 읽을 때 디스코드에 묻지 않게 */
const KEEP_MS = 30_000;
/** 갱신 버튼(fresh)도 이보다 자주는 묻지 않는다 */
const FRESH_GAP_MS = 10_000;
const kept = new Map<string, { at: number; guilds: ManagedGuild[] }>();

const manages = (g: UserGuild) => g.owner || new PermissionsBitField(BigInt(g.permissions)).has(PermissionFlagsBits.ManageGuild);

/**
 * 그 사람이 관리하는 서버. key 는 세션(캐시 칸), fresh 면 KEEP_MS 안이어도 다시 받는다(FRESH_GAP_MS 안이면 둔 것).
 * 디스코드가 거절하면 상태와 본문을 실은 오류를 던진다(discord-api)
 */
async function managedGuilds(key: string, token: string, { fresh = false, http = discordHttp, now = Date.now() }: { fresh?: boolean; http?: DiscordHttp; now?: number } = {}) {
  for (const [k, v] of kept) if (now - v.at >= KEEP_MS) kept.delete(k);
  const hit = kept.get(key);
  if (hit && now - hit.at < (fresh ? FRESH_GAP_MS : KEEP_MS)) return hit.guilds;
  const res = await http.get<UserGuild[]>(`${DISCORD_API}/users/@me/guilds`, { headers: { Authorization: `Bearer ${token}` } });
  const guilds = res.data.filter(manages).map(({ id, name, icon }) => ({ id, name, icon }));
  kept.set(key, { at: now, guilds });
  return guilds;
}

/** 세션이 끝났다(로그아웃). 둔 목록을 버린다 */
const forgetGuilds = (key: string) => kept.delete(key);

// 테스트 시임
function _setAppInfo(info: AppInfo | null) {
  appInfo = info;
  kept.clear();
}

export { loadAppInfo, canInvite, managedGuilds, forgetGuilds, _setAppInfo, KEEP_MS, FRESH_GAP_MS };
export type { AppInfo, ManagedGuild };
