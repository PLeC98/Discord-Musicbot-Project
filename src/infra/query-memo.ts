// 검색 결과를 잠시 기억하고, 같은 검색어로 동시에 온 요청은 검색 하나를 함께 기다리게 한다. 실패는 기억하지 않는다.
// 키는 부르는 쪽이 다듬어 넘긴다. 오래된 것부터 지워 max 개를 넘지 않는다

type Remembered<T> = { at: number; value: T };

/** now: 지금 시각(ms). 테스트가 시계를 넘긴다 */
function queryMemo<T>({ ttlMs, max, now }: { ttlMs: number; max: number; now: () => number }) {
  const done = new Map<string, Remembered<T>>();
  const running = new Map<string, Promise<T>>();

  function fresh(key: string): Remembered<T> | null {
    const hit = done.get(key);
    if (!hit) return null;
    if (now() - hit.at <= ttlMs) return hit;
    done.delete(key);
    return null;
  }

  function remember(key: string, value: T) {
    done.delete(key);
    done.set(key, { at: now(), value });
    for (const oldest of done.keys()) {
      if (done.size <= max) break;
      done.delete(oldest);
    }
  }

  return {
    /** 기억해 둔 결과. 없거나 지났으면 null */
    get(key: string): T | null {
      return fresh(key)?.value ?? null;
    },

    /** key 가 그것으로 시작하는 기억 중 가장 긴 것(key 자신 포함). 없으면 null */
    longestPrefix(key: string): T | null {
      let best: string | null = null;
      for (const known of [...done.keys()]) {
        if (key.startsWith(known) && (best === null || known.length > best.length) && fresh(known)) best = known;
      }
      return best === null ? null : (fresh(best)?.value ?? null);
    },

    /** 기억해 둔 결과 중 지나지 않은 것, 최근 것부터 */
    recent(): T[] {
      return [...done.keys()].reverse().flatMap((key) => {
        const hit = fresh(key);
        return hit ? [hit.value] : [];
      });
    },

    /** 결과. 기억이 있으면 그것, 같은 키를 찾는 중이면 그 검색을 함께 기다린다. 실패는 기다리던 쪽마다 받는다 */
    run(key: string, search: () => Promise<T>): Promise<T> {
      const hit = fresh(key);
      if (hit) return Promise.resolve(hit.value);
      const already = running.get(key);
      if (already) return already;
      const started = search()
        .then((value) => {
          remember(key, value);
          return value;
        })
        .finally(() => running.delete(key));
      // 기다리던 쪽이 마감으로 먼저 떠나도 실패가 처리되지 않은 거부로 새지 않게
      started.catch(() => undefined);
      running.set(key, started);
      return started;
    },
  };
}

export { queryMemo };
