// 볼륨 슬라이더. 드래그하는 동안 그 값으로 바로 틀고, 보이는 값도 드래그 중인 값이다.
//
// 요청은 한 번에 하나씩, 앞 요청을 보낸 뒤 MIN_GAP_MS 가 지나야 다음을 보낸다. 그사이 움직인 것은
// 마지막 값만 남긴다. 놓은 뒤 마지막 요청이 끝나면 서버 값을 보여 준다.
// 서버 값을 바로 묶으면 화면이 다시 그려질 때마다(진행바가 1초마다 그린다) 핸들이 서버 값으로 튄다.
//
// 보낼지는 서버가 받아들인 값(serverVolume)과 보내는 중인 값으로 구분한다. 보낸 값으로 구분하면 실패한 값을
// 다시 놓아도 보내지 않는다. 실패하면 저절로 다시 보내지 않는다(사람이 다시 놓는 것이 다시 하기다).
import { ref, computed, type Ref } from "vue";
import { notifyProblem } from "./toasts.ts";
import { text } from "../text/index.ts";

const MIN_GAP_MS = 200;

/**
 * serverVolume: 서버가 받아들인 볼륨(요청의 응답, 실시간 알림으로 바뀐다). send: 볼륨을 보내고 응답을 상태에 반영한다.
 * notify: 보내지 못했을 때 알리는 곳
 */
export function useVolumeControl(serverVolume: Readonly<Ref<number | undefined>>, send: (level: number) => Promise<unknown>, notify: (error: unknown, fallback: string) => void = notifyProblem) {
  const draft = ref<number | null>(null);
  let pending: number | null = null; // 다음에 보낼 값(보내는 중, 간격을 기다리는 중에 놓은 마지막 값)
  let sending: number | null = null; // 보내는 중인 값
  let busy = false; // 보내는 중이거나 간격을 기다리는 중
  let released = true;

  async function pump(): Promise<void> {
    if (busy) return;
    busy = true;
    while (pending !== null) {
      const level = pending;
      pending = null;
      if (level === serverVolume.value) continue; // 서버가 이미 이 값이다
      sending = level;
      const started = Date.now();
      try {
        await send(level);
      } catch (e) {
        notify(e, text.player.volumeFailed);
      }
      sending = null;
      const wait = MIN_GAP_MS - (Date.now() - started);
      if (wait > 0 && pending !== null) await new Promise((done) => setTimeout(done, wait));
    }
    busy = false;
    if (released) draft.value = null;
  }

  function set(value: unknown, final: boolean) {
    const level = Math.round(Number(value));
    if (!Number.isFinite(level)) return;
    released = final;
    draft.value = level;
    // 보내는 중인 값으로 돌아왔으면 그 요청이 맡는다(60을 보내는 중에 70 → 60)
    pending = level === sending ? null : level;
    void pump();
  }

  return {
    shown: computed(() => draft.value ?? serverVolume.value ?? 0),
    input: (value: unknown) => set(value, false),
    change: (value: unknown) => set(value, true),
  };
}
