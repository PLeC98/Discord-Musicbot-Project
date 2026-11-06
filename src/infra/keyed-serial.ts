// 키마다 한 번에 하나씩 차례로 돌린다(서버마다 곡 추가, 서버마다 패널 기록). 앞 일의 꼬리에 잇는다.
// 앞 일을 기다린 뒤에 등록하면 셋째 일부터 함께 돈다. 꼬리를 잡고 등록하는 사이에 await 가 없어 끼어들 틈이 없고, 정리는 자기 것일 때만 한다.
// 일에 시간 상한을 두지 않는다. 두면 끝나지 않은 앞 일과 뒷 일이 겹친다. 상한은 일 안의 단계(연결, HTTP 등)마다 둔다

/** 키마다 차례로 돌리는 줄 하나. 쓰는 쪽마다 따로 만든다(한 줄의 일이 다른 줄의 같은 키를 부르면 서로를 기다리지 않게) */
function keyedSerial() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    /** fn 을 그 키의 앞 일 뒤에 돌린다. 앞 일의 실패는 그 호출자가 받고 이 일을 막지 않는다 */
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const task = (tails.get(key) || Promise.resolve())
        .catch(() => {
          /* 앞 일의 실패는 그 호출자가 받는다 */
        })
        .then(fn);
      tails.set(key, task);
      return task.finally(() => {
        if (tails.get(key) === task) tails.delete(key);
      });
    },
    /** 끝나지 않은 일이 있는 키 수 */
    get size() {
      return tails.size;
    },
  };
}

type KeyedSerial = ReturnType<typeof keyedSerial>;

export { keyedSerial };
export type { KeyedSerial };
