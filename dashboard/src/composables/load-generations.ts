// 다시 읽기의 세대를 관리한다(캐시 DB처럼 블록 단위로 이어서 불러오는 테이블). 새 세대를 열면 이전 세대의 요청을 취소한다.
// 후처리(불러온 행 반영, 알림, 로딩 표시 해제)는 현재 세대의 요청만 수행한다. 늦게 끝난 이전 세대의 finally가 새 세대를 건드리지 않도록 진행 중인 블록은 세대마다 따로 둔다.
// 같은 세대에서 같은 블록을 겹쳐 불러오면 진행 중인 요청을 함께 기다린다. 세대의 리비전은 처음 반영한 블록의 것이고, 리비전이 다른 블록은 반영하지 않는다(블록을 불러오는 사이에 데이터가 바뀐 경우).
// 화면을 떠나면 dispose: 지금 세대를 취소하고, 그 뒤로 늦게 온 응답은 반영하지 않는다

/** 블록 하나를 불러온 결과. ok: 반영했다, changed: 리비전이 달라 반영하지 않았다, gone: 그사이 새 세대가 열렸거나 화면을 떠났다. 요청이 실패하면 reject한다 */
type BlockResult = "ok" | "changed" | "gone";
type Generation = { id: number; controller: AbortController; pending: Map<number, Promise<BlockResult>>; revision: number | null };

export function createLoadGenerations() {
  let current: Generation = { id: 0, controller: new AbortController(), pending: new Map(), revision: null };
  let disposed = false;
  const isCurrent = (id: number) => !disposed && id === current.id;

  return {
    /** 새 세대를 열고 그 번호를 반환한다. 이전 세대의 요청은 취소한다 */
    begin(): number {
      current.controller.abort();
      current = { id: current.id + 1, controller: new AbortController(), pending: new Map(), revision: null };
      return current.id;
    },
    get id() {
      return current.id;
    },
    /** 지금 세대가 처음 반영한 블록의 리비전(아직 없으면 null) */
    get revision() {
      return current.revision;
    },
    isCurrent,
    /**
     * 지금 세대에서 블록 하나를 불러온다. fetch 는 세대의 취소 신호(signal)를 받아 응답을 주고, apply 는 리비전이 이 세대와 같은 응답만 받는다.
     * 같은 블록을 불러오는 중이면 그 요청을 함께 기다린다
     */
    load<T extends { revision: number }>(block: number, fetch: (signal: AbortSignal) => Promise<T>, apply: (data: T) => void): Promise<BlockResult> {
      const gen = current;
      if (!isCurrent(gen.id)) return Promise.resolve("gone");
      const running = gen.pending.get(block);
      if (running) return running;
      const run = (async (): Promise<BlockResult> => {
        try {
          const data = await fetch(gen.controller.signal);
          if (!isCurrent(gen.id)) return "gone";
          if (gen.revision !== null && data.revision !== gen.revision) return "changed";
          gen.revision = data.revision;
          apply(data);
          return "ok";
        } catch (error) {
          if (!isCurrent(gen.id)) return "gone";
          throw error;
        } finally {
          gen.pending.delete(block);
        }
      })();
      gen.pending.set(block, run);
      return run;
    },
    /**
     * 지금 세대의 블록 0 ~ count-1 을 모두 불러온다(이미 반영한 블록은 건너뛰고, 불러오는 중인 블록은 함께 기다린다).
     * 시작한 세대의 모든 블록이 같은 리비전으로 다 왔으면 true. 그사이 새 세대가 열렸거나(gone), 리비전이 달랐거나, 요청이 실패하면 false(실패 알림은 loadOne 이 한다).
     * loadOne 은 이 세대의 load 결과를 준다
     */
    async loadAll(count: number, loaded: (block: number) => boolean, loadOne: (block: number) => Promise<BlockResult>): Promise<boolean> {
      for (let block = 0; block < count; block++) {
        if (loaded(block)) continue;
        try {
          if ((await loadOne(block)) !== "ok") return false;
        } catch {
          return false;
        }
      }
      return true;
    },
    /** 화면을 떠날 때 호출한다. 지금 세대를 취소하고 늦게 온 응답을 반영하지 않는다 */
    dispose() {
      disposed = true;
      current.controller.abort();
    },
  };
}

export type { BlockResult };
