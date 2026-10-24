// 탐색 막대. 재생 바와 서버 화면이 같이 쓴다.
// 포인터 이벤트(마우스 · 터치 · 펜)를 막대가 붙잡고(setPointerCapture), 끄는 동안의 값을 들고, 놓으면 보낸다.
// 끄는 사이 곡이 바뀌면 취소하고 알린다(다음 곡을 옮기지 않게). 브라우저가 끌기를 빼앗으면(pointercancel) 보내지 않는다

import { ref, watch, onUnmounted, type Ref } from "vue";
import { seekPosition } from "../utils/playback.ts";
import { notify } from "./toasts.ts";
import { text } from "../text/index.ts";

/** 항목 번호(지금 곡). 없으면 null */
type Entry = number | null | undefined;

/**
 * el: 막대 요소 ref. duration(): 지금 곡 길이(초). enabled(): 잡을 수 있는지. entry(): 지금 곡 항목 번호.
 * send(초, 잡을 때의 항목 번호): 놓은 위치로 보낸다. 거절되면 부른 쪽이 다시 읽어 핸들을 서버 위치로 돌린다
 */
export function useSeekBar({ el, duration, enabled, entry, send }: { el: Readonly<Ref<HTMLElement | null | undefined>>; duration: () => number; enabled: () => boolean; entry: () => Entry; send: (sec: number, from: Entry) => unknown }) {
  const dragging = ref(false);
  const value = ref(0);
  let held: { bar: HTMLElement; pointerId: number; entry: Entry } | null = null;

  const at = (e: PointerEvent) => seekPosition(e.clientX, el.value?.getBoundingClientRect(), duration());

  function release() {
    dragging.value = false;
    if (!held) return;
    const { bar, pointerId } = held;
    held = null;
    bar.removeEventListener("pointermove", onMove);
    bar.removeEventListener("pointerup", onUp);
    bar.removeEventListener("pointercancel", release);
    if (bar.hasPointerCapture?.(pointerId)) bar.releasePointerCapture(pointerId);
  }

  function onPointerDown(e: PointerEvent) {
    const bar = el.value;
    if (!bar || !enabled() || e.button > 0 || held) return;
    held = { bar, pointerId: e.pointerId, entry: entry() };
    bar.setPointerCapture?.(e.pointerId);
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
    bar.addEventListener("pointercancel", release);
    value.value = at(e);
    dragging.value = true;
  }

  function onMove(e: PointerEvent) {
    value.value = at(e);
  }

  function onUp(e: PointerEvent) {
    if (!held) return;
    const sec = at(e);
    const from = held.entry;
    release();
    send(sec, from);
  }

  watch(entry, () => {
    if (!held) return;
    release();
    notify({ title: text.player.seekCancelled, severity: "warning" });
  });
  onUnmounted(release);

  return { dragging, value, onPointerDown };
}
