// 화면의 한 항목으로 가서 M3 포커스 표시기(Material Web md-focus-ring)를 잠깐 보인다(봇 상태 탭의 주의 칩, 연령 제한 탭의 POToken 권고 줄).
// 두께 3px, 바깥 간격 2px, secondary. 나타날 때 600ms(long4) 중 1/4은 0 → 8px로 두꺼워지고 3/4은 3px로 줄어든다(emphasized). 스크롤이 멎은 뒤 시작해 잠깐 두고 지운다.
// 사라질 때(규격에 없어 정했다): 두께는 그대로 흐려지기만 한다(300ms, emphasized accelerate). 두께를 줄이면 outline이 px 단위로 끊겨 버벅여 보인다

import { scrollMotion } from "./motion.ts";

const RING = { width: 3, active: 8, offset: 2, durationMs: 600, holdMs: 1200, exitMs: 300, easing: "cubic-bezier(0.2, 0, 0, 1)", exitEasing: "cubic-bezier(0.3, 0, 0.8, 0.15)" }; // --ease-smooth, --ease-accelerate와 같은 값(Web Animations는 var()를 읽지 못한다)
// 나타날 때를 기다리는 최대 시간(ms). 처음 여는 탭은 카드를 불러오고 값을 읽은 뒤에 그려진다
const APPEAR_MS = 5000;

let ringAnimation: Animation | null = null;
let cancelPendingRing: (() => void) | null = null;

/** 표시기와 항목 사이의 간격(px). 안쪽 여백이 없는 항목(설정 칸)은 넓혀 글자에 붙지 않게 한다 */
type RingOptions = { offset?: number };

/** el로 스크롤하고, 스크롤이 멎으면(이미 보이는 위치라 스크롤되지 않으면 바로) 표시기를 보인다. 앞의 것은 지운다 */
function ringAt(el: HTMLElement, { offset = RING.offset }: RingOptions = {}) {
  ringAnimation?.cancel();
  cancelPendingRing?.();
  const scroller = el.closest<HTMLElement>(".overflow-y-auto");
  const before = scroller?.scrollTop ?? 0;
  el.scrollIntoView({ behavior: scrollMotion(), block: "center" });
  let timer = 0;
  const start = () => {
    cancelPendingRing?.();
    playRing(el, offset);
  };
  const onEnd = () => start();
  scroller?.addEventListener("scrollend", onEnd, { once: true });
  timer = window.setTimeout(() => (scroller && scroller.scrollTop !== before ? (timer = window.setTimeout(start, 900)) : start()), 60);
  cancelPendingRing = () => {
    scroller?.removeEventListener("scrollend", onEnd);
    clearTimeout(timer);
    cancelPendingRing = null;
  };
}

function playRing(el: HTMLElement, offset: number) {
  const color = getComputedStyle(el).getPropertyValue("--md-secondary").trim();
  const ringFrame = (width: number, c = color) => ({ outline: `${width}px solid ${c}`, outlineOffset: `${offset}px` });
  const total = RING.durationMs + RING.holdMs + RING.exitMs;
  const thickenMs = RING.durationMs * 0.25;
  // 움직임 줄이기를 켰으면 두꺼워졌다 줄어드는 움직임 없이 링만(Material Web도 같다)
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    ringAnimation = el.animate([ringFrame(RING.width), { ...ringFrame(RING.width), offset: 1 - RING.exitMs / total }, ringFrame(RING.width, "transparent")], { duration: total });
    return;
  }
  ringAnimation = el.animate(
    [
      { ...ringFrame(0), offset: 0, easing: RING.easing },
      { ...ringFrame(RING.active), offset: thickenMs / total, easing: RING.easing },
      { ...ringFrame(RING.width), offset: RING.durationMs / total },
      { ...ringFrame(RING.width), offset: (RING.durationMs + RING.holdMs) / total, easing: RING.exitEasing },
      { ...ringFrame(RING.width, "transparent"), offset: 1 },
    ],
    { duration: total },
  );
}

/** selector의 항목이 화면에 생기고 보이면(다른 탭으로 막 바꿨을 때) ringAt. APPEAR_MS 안에 생기지 않으면 하지 않는다 */
function ringWhenShown(selector: string, options: RingOptions = {}) {
  const until = Date.now() + APPEAR_MS;
  const look = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.offsetParent !== null) return ringAt(el, options);
    if (Date.now() < until) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

export { ringAt, ringWhenShown };
