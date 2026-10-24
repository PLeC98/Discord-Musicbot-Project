// 응답을 기다리는 조작. 그동안 그 버튼을 끄고 같은 조작을 겹쳐 보내지 않는다. 재생 바와 서버 화면이 같이 쓴다

import { ref } from "vue";

export function useBusy() {
  const busy = ref(new Set<string>());
  const isBusy = (key: string) => busy.value.has(key);

  function setBusy(key: string, on: boolean) {
    const next = new Set(busy.value);
    if (on) next.add(key);
    else next.delete(key);
    busy.value = next;
  }

  /** key 가 기다리는 중이 아니면 work 를 하고 끝나면 푼다. 기다리는 중이면 하지 않는다(undefined) */
  async function whileBusy<T>(key: string, work: () => Promise<T>): Promise<T | undefined> {
    if (isBusy(key)) return undefined;
    setBusy(key, true);
    try {
      return await work();
    } finally {
      setBusy(key, false);
    }
  }

  return { busy, isBusy, whileBusy };
}
