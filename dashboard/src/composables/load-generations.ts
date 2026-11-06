// 다시 읽기의 세대(캐시 DB 처럼 블록마다 이어 불러오는 표). 새 세대를 열면 앞 세대의 요청을 끊는다.
// 끝맺음(받은 행 넣기, 알림, 받는 중 표시 지우기)은 그 세대의 것만 한다. 늦게 끝난 앞 세대의 finally 가 새 세대를 건드리지 않게, 받는 중 표시는 세대마다 따로

type Generation = { id: number; controller: AbortController; pending: Set<number> };

/** 블록 하나를 받는 표. id: 그 세대, signal: 요청에 건다, done: 끝나면(finally) 부른다 */
type Ticket = { id: number; signal: AbortSignal; done: () => void };

export function createLoadGenerations() {
  let current: Generation = { id: 0, controller: new AbortController(), pending: new Set() };
  return {
    /** 새 세대를 열고 그 번호. 앞 세대의 요청을 끊는다 */
    begin(): number {
      current.controller.abort();
      current = { id: current.id + 1, controller: new AbortController(), pending: new Set() };
      return current.id;
    },
    get id() {
      return current.id;
    },
    isCurrent: (id: number) => id === current.id,
    /** 지금 세대에서 이 블록을 받기 시작한다. 이미 받는 중이면 null */
    claim(block: number): Ticket | null {
      if (current.pending.has(block)) return null;
      const mine = current;
      mine.pending.add(block);
      return { id: mine.id, signal: mine.controller.signal, done: () => void mine.pending.delete(block) };
    },
  };
}

export type { Ticket };
