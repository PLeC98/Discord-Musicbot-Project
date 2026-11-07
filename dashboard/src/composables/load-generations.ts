// 다시 읽기의 세대를 관리한다(캐시 DB처럼 블록 단위로 이어서 불러오는 테이블). 새 세대를 열면 이전 세대의 요청을 취소한다.
// 후처리(불러온 행 반영, 알림, 로딩 표시 해제)는 현재 세대의 요청만 수행한다. 늦게 끝난 이전 세대의 finally가 새 세대를 건드리지 않도록 로딩 표시는 세대마다 따로 둔다

type Generation = { id: number; controller: AbortController; pending: Set<number> };

/** 블록 하나를 불러올 때 발급하는 티켓이다. id는 세대 번호이고, signal은 요청에 전달하며, done은 요청이 끝나면(finally) 호출한다 */
type Ticket = { id: number; signal: AbortSignal; done: () => void };

export function createLoadGenerations() {
  let current: Generation = { id: 0, controller: new AbortController(), pending: new Set() };
  return {
    /** 새 세대를 열고 그 번호를 반환한다. 이전 세대의 요청은 취소한다 */
    begin(): number {
      current.controller.abort();
      current = { id: current.id + 1, controller: new AbortController(), pending: new Set() };
      return current.id;
    },
    get id() {
      return current.id;
    },
    isCurrent: (id: number) => id === current.id,
    /** 현재 세대에서 이 블록을 불러오기 시작한다. 이미 불러오는 중이면 null을 반환한다 */
    claim(block: number): Ticket | null {
      if (current.pending.has(block)) return null;
      const mine = current;
      mine.pending.add(block);
      return { id: mine.id, signal: mine.controller.signal, done: () => void mine.pending.delete(block) };
    },
  };
}

export type { Ticket };
