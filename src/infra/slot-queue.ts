// 동시에 도는 수를 묶는 줄. 자리가 나면 기다리던 것을 차례(rank 가 작은 것부터, 같으면 온 차례)로 들인다.
// 크기는 들일 때마다 다시 읽는다(조정값을 바꾸면 다음 자리부터 따른다). 줄이면 도는 것이 끝나기를 기다린다

type Waiter = { rank: number; enter: (leave: () => void) => void; refuse: (error: unknown) => void };
/** 지금 도는 수 · 크기 · 기다리는 수 */
type SlotStats = { running: number; size: number; waiting: number };

class SlotQueue {
  #running = 0;
  #waiting: Waiter[] = [];
  #closed: Error | null = null;
  readonly #size: () => number;

  constructor(size: () => number) {
    this.#size = size;
  }

  /**
   * 자리를 잡는다. 돌려주는 것은 자리를 내놓는 함수(두 번 불러도 한 번만 센다).
   * signal 이 끊기면 줄에서 빠지고 그 까닭으로 거절된다. 닫힌 줄은 곧바로 거절한다
   */
  take({ rank = 1, signal }: { rank?: number; signal?: AbortSignal } = {}): Promise<() => void> {
    if (this.#closed) return Promise.reject(this.#closed);
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const drop = () => {
        const at = this.#waiting.indexOf(waiter);
        if (at < 0) return;
        this.#waiting.splice(at, 1);
        reject(signal?.reason);
      };
      const waiter: Waiter = {
        rank,
        enter: (leave) => {
          signal?.removeEventListener("abort", drop);
          resolve(leave);
        },
        refuse: (error) => {
          signal?.removeEventListener("abort", drop);
          reject(error);
        },
      };
      signal?.addEventListener("abort", drop, { once: true });
      const before = this.#waiting.findIndex((other) => other.rank > rank);
      this.#waiting.splice(before < 0 ? this.#waiting.length : before, 0, waiter);
      this.#drain();
    });
  }

  /** 기다리던 것을 error 로 거절하고 새로 잡는 것도 거절한다. 도는 것은 그대로 끝난다 */
  close(error: Error) {
    this.#closed = error;
    for (const waiter of this.#waiting.splice(0)) waiter.refuse(error);
  }

  stats(): SlotStats {
    return { running: this.#running, size: this.#size(), waiting: this.#waiting.length };
  }

  #drain() {
    while (this.#waiting.length && this.#running < this.#size()) {
      const waiter = this.#waiting.shift()!;
      this.#running++;
      let left = false;
      waiter.enter(() => {
        if (left) return;
        left = true;
        this.#running--;
        this.#drain();
      });
    }
  }
}

export { SlotQueue };
export type { SlotStats };
