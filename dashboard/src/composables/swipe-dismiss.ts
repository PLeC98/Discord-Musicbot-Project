// 알림 카드를 오른쪽으로 밀어 치우기(마우스, 터치, 펜). 떠 있는 알림(components/ToastStack)과 알림함(shell/NoticeInbox)이 같이 쓴다.
// 폭의 30%를 넘기거나 빠르게 튕기면(0.5px/ms 이상, 16px 이상) 치운다. 못 미치면 제자리로 돌아간다.
// 치운 카드는 손을 뗀 자리에서 나가는 움직임을 잇도록 사라질 때까지 위치를 쥐고 있는다(onLeft에서 놓는다). 쥔 동안의 모양은 호출부가 정한다(released).
// 조금이라도 밀었으면(4px 넘게) 뗄 때의 누름은 카드에 넘기지 않는다(밀다가 카드가 펼쳐지지 않게)

import { ref } from "vue";

type Drag = { id: number; el: HTMLElement; pointer: number; startX: number; dx: number; width: number; lastX: number; lastT: number; speed: number; live: boolean };

export function useSwipeDismiss(dismiss: (id: number) => void, released: (dx: number, fade: string) => Record<string, string>) {
  const drag = ref<Drag | null>(null);
  let swallowClick = false;

  function styleOf(id: number) {
    const d = drag.value;
    if (!d || d.id !== id) return undefined;
    const fade = String(1 - Math.min(d.dx / d.width, 1) * 0.5);
    if (!d.live) return released(d.dx, fade);
    return { translate: `${d.dx}px 0`, opacity: fade, transition: "none" };
  }

  function onDown(event: PointerEvent, id: number) {
    if (drag.value || (event.target as Element).closest("a, button")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const el = event.currentTarget as HTMLElement;
    swallowClick = false;
    drag.value = { id, el, pointer: event.pointerId, startX: event.clientX, dx: 0, width: el.offsetWidth, lastX: event.clientX, lastT: event.timeStamp, speed: 0, live: true };
    // 잡기 전에 카드 밖에서 떼도 끝나게
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
  }

  function onMove(event: PointerEvent) {
    const d = drag.value;
    if (!d?.live) return;
    // 왼쪽으로는 밀리지 않는다
    d.dx = Math.max(0, event.clientX - d.startX);
    // 밀기 시작했으면 그때 포인터를 잡는다(누르자마자 잡으면 그냥 누름의 click이 카드가 아니라 감싼 요소로 간다)
    if (d.dx > 4 && !swallowClick) {
      swallowClick = true;
      d.el.setPointerCapture(d.pointer);
    }
    const dt = event.timeStamp - d.lastT;
    if (dt > 0) d.speed = (event.clientX - d.lastX) / dt;
    d.lastX = event.clientX;
    d.lastT = event.timeStamp;
  }

  function onUp(event: PointerEvent) {
    const d = drag.value;
    if (!d?.live) return;
    d.live = false;
    // 멈췄다가 뗐으면 튕긴 것이 아니다(마지막으로 움직일 때의 빠르기가 남아 있다)
    if (event.timeStamp - d.lastT > 100) d.speed = 0;
    if (d.dx > d.width * 0.3 || (d.speed > 0.5 && d.dx > 16)) dismiss(d.id);
    else drag.value = null;
  }

  // 치운 카드가 다 빠졌으면 쥐고 있던 위치를 놓는다(다른 카드를 미는 중이면 그대로)
  function onLeft() {
    if (drag.value && !drag.value.live) drag.value = null;
  }

  // 카드를 감싼 요소의 click.capture에. 밀었던 누름이면 카드까지 가지 않게 막는다
  function onClickCapture(event: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    event.stopPropagation();
  }

  return { styleOf, onDown, onMove, onUp, onLeft, onClickCapture };
}
