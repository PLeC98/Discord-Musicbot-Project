// 사용자가 든 서버(로그인 때 받은 토큰으로 디스코드의 /users/@me/guilds). 초대 화면(관리하는 서버)과,
// 서버 목록 · SSE 연결 · 봇 상태 탭의 "참가한 서버" 필터링 · 표시가 쓴다. 보고 조작하는 권한 판정은 guild-access 의 memberOf 가 한다(이 목록은 낡을 수 있다)

import type { Request } from "express";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { messageOf } from "../rules/error-kind.ts";
import { DISCORD_API, discordHttp, type DiscordHttp } from "./discord-api.ts";
import { tokenStoreOf } from "./session-store.ts";

/** 디스코드가 주는 서버 목록에서 읽는 필드. permissions 는 서버 단위 권한 비트 */
type UserGuild = { id: string; name: string; icon: string | null; owner: boolean; permissions: string };

/** 받은 목록을 세션마다 캐시한다. 이만큼 안이면 다시 묻지 않는다 */
const KEEP_MS = 30_000;
/** 갱신 버튼(fresh)도 이보다 자주는 묻지 않는다 */
const FRESH_GAP_MS = 10_000;
/** 이만큼 쓰지 않은 캐시 항목은 지운다(로그아웃 없이 사라진 세션) */
const IDLE_MS = 10 * 60_000;

// 캐시 항목. guilds 가 null 이면 토큰이 거절됐다(401): 다시 로그인할 때까지 묻지 않는다(401 은 디스코드의 IP 차단 한도에 든다)
type Kept = { at: number; usedAt: number; guilds: UserGuild[] | null };
const kept = new Map<string, Kept>();
// 받는 중. 같은 세션이 한꺼번에 물으면(서버 목록과 SSE 연결) 진행 중인 요청 하나를 공유한다
const loading = new Map<string, Promise<UserGuild[]>>();

const statusOf = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status;

function sweep(now: number) {
  for (const [key, entry] of kept) if (now - entry.usedAt >= IDLE_MS) kept.delete(key);
}

function load(key: string, token: string, http: DiscordHttp, now: number) {
  const running = loading.get(key);
  if (running) return running;
  const started = http
    .get<UserGuild[]>(`${DISCORD_API}/users/@me/guilds`, { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => {
      kept.set(key, { at: now, usedAt: now, guilds: res.data });
      return res.data;
    })
    .catch((error: unknown) => {
      if (statusOf(error) === 401) kept.set(key, { at: now, usedAt: now, guilds: null });
      throw error;
    })
    .finally(() => loading.delete(key));
  loading.set(key, started);
  return started;
}

type ListOptions = { fresh?: boolean; stale?: boolean; http?: DiscordHttp; now?: number };

/** 캐시 항목을 그대로 쓸 수 있나. 401 을 받은 항목이면 던진다 */
function keptList(hit: Kept | undefined, now: number, fresh: boolean) {
  if (!hit) return null;
  hit.usedAt = now;
  if (!hit.guilds) throw Object.assign(new Error("HTTP 401"), { response: { status: 401 } });
  return now - hit.at < (fresh ? FRESH_GAP_MS : KEEP_MS) ? hit.guilds : null;
}

/**
 * 사용자의 서버 전부. key 는 세션 ID(캐시 항목의 키), fresh 면 KEEP_MS 안이어도 다시 받는다(FRESH_GAP_MS 안이면 캐시된 것).
 * stale 이면 KEEP_MS 를 넘은 목록도 바로 주고 새로 받기는 뒤에서 한다(3초마다 묻는 표시가 디스코드를 기다리지 않게).
 * 디스코드가 거절하면 상태와 본문을 실은 오류를 던진다(discord-api). 401 을 받은 세션은 다시 로그인할 때까지 묻지 않고 401 로 던진다
 */
async function userGuilds(key: string, token: string, options: ListOptions = {}): Promise<UserGuild[]> {
  const { fresh = false, stale = false, http = discordHttp, now = Date.now() } = options;
  sweep(now);
  const hit = kept.get(key);
  const usable = keptList(hit, now, fresh);
  if (usable) return usable;
  const next = load(key, token, http, now);
  if (!hit?.guilds || !stale || fresh) return next;
  next.catch(() => {
    /* 뒤에서 받다 실패하면 다음 요청이 다시 받는다 */
  });
  return hit.guilds;
}

/**
 * 이 요청의 사용자가 든 서버 ID. 받지 못하면 ids 가 null 이고 부르는 쪽은 멤버 캐시만 본다(서버마다 REST 로 돌아가지 않는다).
 * relogin: 토큰이 없거나(토큰을 두기 전의 세션 · SECRETS_KEY 를 바꿈) 거절됐다(만료 · 승인 철회). 다시 로그인하면 받는다
 */
async function memberGuildIds(req: Pick<Request, "sessionID" | "sessionStore">, { stale = false, http = discordHttp }: { stale?: boolean; http?: DiscordHttp } = {}) {
  const token = tokenStoreOf(req)?.readDiscordToken(req.sessionID);
  if (!token) return { ids: null, relogin: true };
  try {
    const guilds = await userGuilds(req.sessionID, token, { stale, http });
    return { ids: new Set(guilds.map((g) => g.id)), relogin: false };
  } catch (error) {
    const status = statusOf(error);
    if (status !== 401 && status !== 429) log.debug(`디스코드에서 서버 목록을 받지 못해 멤버 캐시만 봅니다: ${status ? `상태 코드 ${status}` : messageOf(error)}`);
    return { ids: null, relogin: status === 401 };
  }
}

/** 세션이 끝났다(로그아웃 · 기기 해제). 캐시된 목록을 버린다 */
const forgetGuilds = (key: string) => kept.delete(key);

/** 테스트: 캐시를 비운다 */
function _resetUserGuilds() {
  kept.clear();
  loading.clear();
}

export { userGuilds, memberGuildIds, forgetGuilds, _resetUserGuilds, KEEP_MS, FRESH_GAP_MS, IDLE_MS };
export type { UserGuild };
