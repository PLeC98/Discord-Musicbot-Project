// 볼륨 슬라이더. 끄는 동안 그 값으로 바로 틀고, 보이는 값도 끄는 값이다.
//
// 요청은 한 번에 하나씩, 앞 요청을 보낸 뒤 MIN_GAP_MS 가 지나야 다음을 보낸다. 그사이 움직인 것은
// 마지막 값만 남긴다. 놓은 뒤 마지막 요청이 끝나면 서버 값을 보여 준다.
// 서버 값을 바로 묶으면 화면이 다시 그려질 때마다(진행바가 1초마다 그린다) 손잡이가 서버 값으로 튄다.
import { ref, computed, type Ref } from "vue";
import { notifyProblem } from "./toasts.ts";

const MIN_GAP_MS = 200;

/**
 * serverVolume: 서버가 알려 준 음량. send: 음량을 보내고 응답을 상태에 반영한다
 */
export function useVolumeControl(serverVolume: Readonly<Ref<number | undefined>>, send: (level: number) => Promise<unknown>) {
  const draft = ref<number | null>(null);
  let pending: number | null = null; // 아직 안 보낸 마지막 값
  let busy = false; // 보내는 중이거나 간격을 기다리는 중
  let released = true;
  let lastSent: number | null = null;

  async function pump(): Promise<void> {
    if (busy || pending === null) return;
    const level = pending;
    pending = null;
    busy = true;
    const started = Date.now();
    try {
      lastSent = level;
      await send(level);
    } catch (e) {
      notifyProblem(e, "볼륨을 바꾸지 못했어요.");
    }
    const wait = MIN_GAP_MS - (Date.now() - started);
    if (wait > 0 && pending !== null) await new Promise((done) => setTimeout(done, wait));
    busy = false;
    if (pending !== null) return pump();
    if (released) draft.value = null;
  }

  function set(value: unknown, final: boolean) {
    const level = Math.round(Number(value));
    if (!Number.isFinite(level)) return;
    released = final;
    draft.value = level;
    // 놓았는데 마지막으로 보낸 값과 같으면 더 보낼 것이 없다
    if (level === lastSent && pending === null) {
      if (final && !busy) draft.value = null;
      return;
    }
    pending = level;
    void pump();
  }

  return {
    shown: computed(() => draft.value ?? serverVolume.value ?? 0),
    input: (value: unknown) => set(value, false),
    change: (value: unknown) => set(value, true),
  };
}
