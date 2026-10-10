// v-tooltip="text". 네이티브 title 대신 커스텀 디자인 툴팁.
// 단일 DOM 노드를 body에 붙여 재사용, 대상 위(공간 없으면 아래) 4 떨어진 자리에 중앙 정렬로 표시(M3 일반 툴팁, 꼬리 없음).
//
// 마우스: 올리면 뜨고 떠나거나 누르면 꺼진다. 키보드: 초점이 오면 뜬다. 어디든 구르면 꺼진다.
// 터치 · 펜: 톡 치면 브라우저가 마우스 흉내(올림 → 누름)를 연달아 보내 떴다가 바로 꺼지므로, 그 흉내는 받지 않고 따로 다룬다.
//   누르는 기능이 없는 것(도움말 아이콘 · 이름표)은 톡 치면 켜고 끄고, 단추 · 링크처럼 누르면 동작하는 것은 길게 누르면 뜬다(M3 모바일 툴팁.
//   이때 손을 떼며 오는 누름은 막는다: 툴팁을 보려던 것이지 누르려던 것이 아니다). 다른 곳을 치면 꺼진다.

import type { Directive } from "vue";

/** 요소마다 든 것: 띄울 글과 붙인 처리기 */
type Held = { text: string | null | undefined; show: () => void; hide: () => void; down: (e: PointerEvent) => void; up: (e: PointerEvent) => void; cancel: () => void; click: (e: MouseEvent) => void };
const held = new WeakMap<HTMLElement, Held>();

const LONG_PRESS_MS = 500;
const MOUSE_AFTER_TOUCH_MS = 800; // 터치 뒤 브라우저가 흉내 내는 마우스 신호를 무시하는 시간
// 누르면 동작하는 것(이것 안이면 톡 쳐도 툴팁을 띄우지 않고 길게 눌러야 뜬다). 이름표(label)는 칸에 초점을 줄 뿐이라 넣지 않는다
const PRESSABLE = "button, a, input, select, textarea, [role=button], [role=switch], [role=radio], [role=menuitem], [role=option], [draggable=true]";

let tipEl: HTMLDivElement | null = null;
// 지금 툴팁을 띄운 요소. 다른 요소가 떠나거나 사라질 때 남의 툴팁을 끄지 않게, 떠 있는 글을 고칠 때 그 요소인지 보려고 든다
let owner: HTMLElement | null = null;
let lastTouch = 0;
let pressTimer = 0;
// 길게 눌러 툴팁을 띄웠다: 손을 떼며 오는 누름(click)을 한 번 막는다
let swallowClick: HTMLElement | null = null;
let pressStart: { x: number; y: number } | null = null;

function ensureEl() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "app-tooltip";
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);
  // 터치로 띄운 툴팁은 다른 곳을 치면 끈다
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" && owner && !owner.contains(e.target as Node)) hide(owner);
  });
  // 어디든 구르면 끈다. 툴팁은 화면에 고정된 자리라 대상만 굴러가 떨어져 남는다(M3 툴팁도 굴리면 사라진다)
  window.addEventListener("scroll", () => owner && hide(owner), { capture: true, passive: true });
  return tipEl;
}

function show(el: HTMLElement) {
  const text = held.get(el)?.text;
  if (!text) return hide(el);
  owner = el;
  const t = ensureEl();
  t.textContent = text;
  t.style.display = "block";
  t.style.opacity = "0";

  const r = el.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  const pad = 6;
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - tr.width - pad));
  const gap = 4;
  let top = r.top - tr.height - gap;
  if (top < pad) top = r.bottom + gap;
  t.style.left = `${Math.round(left)}px`;
  t.style.top = `${Math.round(top)}px`;
  requestAnimationFrame(() => {
    t.style.opacity = "1";
  });
}

/** el 이 띄운 툴팁이면 끈다 */
function hide(el: HTMLElement) {
  if (!tipEl || owner !== el) return;
  owner = null;
  tipEl.style.opacity = "0";
  tipEl.style.display = "none";
}

const fromTouch = () => Date.now() - lastTouch < MOUSE_AFTER_TOUCH_MS;

const tooltip: Directive<HTMLElement, string | null | undefined> = {
  mounted(el, binding) {
    const one: Held = {
      text: binding.value,
      // 터치 뒤의 마우스 흉내는 받지 않는다
      show: () => !fromTouch() && show(el),
      hide: () => !fromTouch() && hide(el),
      down(e) {
        if (e.pointerType === "mouse") return;
        lastTouch = Date.now();
        clearTimeout(pressTimer);
        // 길게 누른 뒤 누름이 오지 않는 기기도 있다. 새로 누르기 시작하면 막기를 푼다
        swallowClick = null;
        pressStart = { x: e.clientX, y: e.clientY };
        // 누르면 동작하는 것은 길게 눌러야 뜬다
        if (el.closest(PRESSABLE))
          pressTimer = window.setTimeout(() => {
            show(el);
            swallowClick = el;
          }, LONG_PRESS_MS);
      },
      up(e) {
        if (e.pointerType === "mouse") return;
        lastTouch = Date.now();
        clearTimeout(pressTimer);
        const moved = pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10;
        pressStart = null;
        // 누르는 기능이 없는 것은 톡 치면 켜고 끈다(굴리느라 움직였으면 아니다)
        if (!moved && !el.closest(PRESSABLE)) {
          if (owner === el) hide(el);
          else show(el);
        }
      },
      cancel: () => clearTimeout(pressTimer),
      click(e) {
        if (swallowClick !== el) return;
        swallowClick = null;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
    };
    held.set(el, one);
    el.addEventListener("mouseenter", one.show);
    el.addEventListener("mouseleave", one.hide);
    el.addEventListener("mousedown", one.hide); // 클릭/스크럽 시작 시 숨김
    el.addEventListener("focus", one.show);
    el.addEventListener("blur", one.hide);
    el.addEventListener("pointerdown", one.down);
    el.addEventListener("pointerup", one.up);
    el.addEventListener("pointercancel", one.cancel);
    el.addEventListener("click", one.click, true);
  },
  updated(el, binding) {
    const one = held.get(el);
    if (!one || one.text === binding.value) return;
    one.text = binding.value;
    // 떠 있는 동안 글이 바뀌었다(볼륨 값 등). 새 글로 다시 띄운다(비면 끈다)
    if (owner === el) show(el);
  },
  unmounted(el) {
    const one = held.get(el);
    if (one) {
      el.removeEventListener("mouseenter", one.show);
      el.removeEventListener("mouseleave", one.hide);
      el.removeEventListener("mousedown", one.hide);
      el.removeEventListener("focus", one.show);
      el.removeEventListener("blur", one.hide);
      el.removeEventListener("pointerdown", one.down);
      el.removeEventListener("pointerup", one.up);
      el.removeEventListener("pointercancel", one.cancel);
      el.removeEventListener("click", one.click, true);
      held.delete(el);
    }
    hide(el);
  },
};

export default tooltip;
