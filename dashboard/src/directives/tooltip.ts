// v-tooltip="text". 네이티브 title 대신 커스텀 디자인 툴팁.
// 단일 DOM 노드를 body에 붙여 재사용, 대상 위(공간 없으면 아래)에 중앙 정렬로 표시.

import type { Directive } from "vue";

/** 요소마다 든 것: 띄울 글과 붙인 처리기 */
type Held = { text: string | null | undefined; show: () => void; hide: () => void };
const held = new WeakMap<HTMLElement, Held>();

let tipEl: HTMLDivElement | null = null;
// 지금 툴팁을 띄운 요소. 다른 요소가 떠나거나 사라질 때 남의 툴팁을 끄지 않게, 떠 있는 글을 고칠 때 그 요소인지 보려고 든다
let owner: HTMLElement | null = null;

function ensureEl() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "app-tooltip";
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);
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
  let top = r.top - tr.height - 8;
  let below = false;
  if (top < pad) {
    top = r.bottom + 8;
    below = true;
  }
  t.style.left = `${Math.round(left)}px`;
  t.style.top = `${Math.round(top)}px`;
  t.classList.toggle("app-tooltip--below", below);
  // 화살표 x 위치 (대상 중앙을 가리키도록)
  const arrowX = r.left + r.width / 2 - left;
  t.style.setProperty("--tt-arrow-x", `${Math.round(Math.max(10, Math.min(arrowX, tr.width - 10)))}px`);
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

const tooltip: Directive<HTMLElement, string | null | undefined> = {
  mounted(el, binding) {
    const one: Held = { text: binding.value, show: () => show(el), hide: () => hide(el) };
    held.set(el, one);
    el.addEventListener("mouseenter", one.show);
    el.addEventListener("mouseleave", one.hide);
    el.addEventListener("mousedown", one.hide); // 클릭/스크럽 시작 시 숨김
    el.addEventListener("focus", one.show);
    el.addEventListener("blur", one.hide);
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
      held.delete(el);
    }
    hide(el);
  },
};

export default tooltip;
