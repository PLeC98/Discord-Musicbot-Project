// 운영자 화면의 긴 목록(상태 탭의 플레이어 · 자식 프로세스)을 보이는 구간만 준다: 질의 읽기와 자르기.
// 질의는 화면이 보내는 값이라 잘못된 값은 막지 않고 없는 것으로 본다(같은 이름이 여럿이면 Express 가 배열로 준다)

import { LIST_WINDOW_MAX, PLAYER_STATES, PROCESS_SORTS, Q_MAX, STATUS_QUERY, type Span, type StatusQuery } from "./contract/admin.ts";

/** "시작,개수". 개수는 LIST_WINDOW_MAX 까지 */
function spanOf(value: unknown, fallback: Span): Span {
  const m = typeof value === "string" ? /^(\d{1,9}),(\d{1,9})$/.exec(value) : null;
  return m ? { from: Number(m[1]), count: Math.min(Number(m[2]), LIST_WINDOW_MAX) } : fallback;
}

function oneOf<T extends string>(value: unknown, known: readonly T[], fallback: T): T {
  return known.find((k) => k === value) ?? fallback;
}

/** 상태 탭 목록의 질의. states 가 빈 값이면 아무 상태도 보이지 않는다(없을 때와 다르다) */
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

/** 구간을 자른다. 시작이 거른 수를 넘으면(나가기 · 거르기로 줄었다) 마지막 구간으로 당긴다 */
function cut<T>(rows: readonly T[], span: Span): { from: number; rows: T[] } {
  const from = span.from < rows.length ? span.from : Math.max(0, rows.length - span.count);
  return { from, rows: rows.slice(from, from + span.count) };
}

export { statusQueryOf, cut };
