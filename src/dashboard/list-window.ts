// 운영자 화면의 긴 목록(상태 탭의 플레이어 · 자식 프로세스, 서버 관리 탭의 서버)을 보이는 구간만 준다: 쿼리 읽기와 자르기.
// Node 를 부르지 않아 더미 대시보드의 가짜 서버도 쓴다.
// 쿼리는 화면이 보내는 값이라 잘못된 값은 막지 않고 없는 것으로 본다(같은 이름이 여럿이면 Express 가 배열로 준다)

import { koMatch } from "../rules/ko-search.ts";
import { GUILD_QUERY, GUILD_SORTS, LIST_WINDOW_MAX, PLAYER_STATES, PROCESS_SORTS, Q_MAX, STATUS_QUERY, type AdminGuild, type AdminGuilds, type GuildQuery, type GuildSort, type Span, type StatusQuery } from "./contract/admin.ts";

/** "시작,개수". 개수는 LIST_WINDOW_MAX 까지 */
function spanOf(value: unknown, fallback: Span): Span {
  const m = typeof value === "string" ? /^(\d{1,9}),(\d{1,9})$/.exec(value) : null;
  return m ? { from: Number(m[1]), count: Math.min(Number(m[2]), LIST_WINDOW_MAX) } : fallback;
}

function oneOf<T extends string>(value: unknown, known: readonly T[], fallback: T): T {
  return known.find((k) => k === value) ?? fallback;
}

/** 상태 탭 목록의 쿼리. states 가 빈 값이면 아무 상태도 보이지 않는다(없을 때와 다르다) */
function statusQueryOf(query: Record<string, unknown>): StatusQuery {
  const { states, q, desc } = query;
  return {
    players: spanOf(query.players, STATUS_QUERY.players),
    states: typeof states === "string" ? PLAYER_STATES.filter((s) => states.split(",").includes(s)) : STATUS_QUERY.states,
    q: typeof q === "string" ? q.slice(0, Q_MAX) : STATUS_QUERY.q,
    procs: spanOf(query.procs, STATUS_QUERY.procs),
    sort: oneOf(query.sort, PROCESS_SORTS, STATUS_QUERY.sort),
    desc: desc === "0" ? false : desc === "1" ? true : STATUS_QUERY.desc,
  };
}

/** 서버 관리 탭 목록의 쿼리 */
function guildQueryOf(query: Record<string, unknown>): GuildQuery {
  const { q, playing } = query;
  return { guilds: spanOf(query.guilds, GUILD_QUERY.guilds), q: typeof q === "string" ? q.slice(0, Q_MAX) : GUILD_QUERY.q, playing: playing === "1", sort: oneOf(query.sort, GUILD_SORTS, GUILD_QUERY.sort) };
}

const collator = new Intl.Collator("ko");
const GUILD_ORDER: Record<GuildSort, (a: AdminGuild, b: AdminGuild) => number> = {
  name: (a, b) => collator.compare(a.name, b.name),
  "name-desc": (a, b) => collator.compare(b.name, a.name),
  "members-desc": (a, b) => b.memberCount - a.memberCount,
  "members-asc": (a, b) => a.memberCount - b.memberCount,
};

// 서버 ID(스노플레이크)는 자릿수가 다를 수 있어 길이부터 견준다
const byId = (a: AdminGuild, b: AdminGuild) => a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 서버 관리 탭: 필터링하고(재생 중만 · 이름 검색) 정렬하고(같으면 서버 ID) 자른다. 수는 전부 · 재생 중 · 필터링된 것 */
function guildList(all: AdminGuild[], query: GuildQuery): AdminGuilds {
  const order = GUILD_ORDER[query.sort];
  const matched = all.filter((g) => (!query.playing || g.hasPlayer) && koMatch(g.name, query.q)).sort((a, b) => order(a, b) || byId(a, b));
  const { from, rows } = cut(matched, query.guilds);
  return { total: all.length, playing: all.filter((g) => g.hasPlayer).length, matched: matched.length, from, guilds: rows };
}

/** 구간을 자른다. 시작이 필터링된 수를 넘으면(나가기 · 필터링으로 줄었다) 마지막 구간으로 당긴다 */
function cut<T>(rows: readonly T[], span: Span): { from: number; rows: T[] } {
  const from = span.from < rows.length ? span.from : Math.max(0, rows.length - span.count);
  return { from, rows: rows.slice(from, from + span.count) };
}

export { statusQueryOf, guildQueryOf, guildList, cut };
