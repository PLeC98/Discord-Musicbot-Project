// v-tooltip="text" — 네이티브 title 대신 커스텀 디자인 툴팁.
// 단일 DOM 노드를 body에 붙여 재사용, 대상 위(공간 없으면 아래)에 중앙 정렬로 표시.

let tipEl = null;

function ensureEl() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "app-tooltip";
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);
  return tipEl;
}

function show(el) {
  const text = el._ttText;
  if (!text) return;
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

function hide() {
  if (!tipEl) return;
  tipEl.style.opacity = "0";
  tipEl.style.display = "none";
}

export default {
  mounted(el, binding) {
    el._ttText = binding.value;
    el._ttShow = () => show(el);
    el._ttHide = hide;
    el.addEventListener("mouseenter", el._ttShow);
    el.addEventListener("mouseleave", el._ttHide);
    el.addEventListener("mousedown", el._ttHide); // 클릭/스크럽 시작 시 숨김
    el.addEventListener("focus", el._ttShow);
    el.addEventListener("blur", el._ttHide);
  },
  updated(el, binding) {
    el._ttText = binding.value;
  },
  unmounted(el) {
    el.removeEventListener("mouseenter", el._ttShow);
    el.removeEventListener("mouseleave", el._ttHide);
    el.removeEventListener("mousedown", el._ttHide);
    el.removeEventListener("focus", el._ttShow);
    el.removeEventListener("blur", el._ttHide);
    hide();
  },
};
