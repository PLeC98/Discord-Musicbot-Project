// 색 역할을 한 박자로 옮긴다. 모든 --md-* 를 같은 시계로, OKLab 에서 사이 값을 만들어 매 프레임 깐다.
// (CSS 로 역할마다 번지게 하면 등록한 것 · 안 한 것의 박자가 어긋나고, 화면 통째로 겹쳐 넘기면 끝에서 튄다)

import { labToRgb, rgbToLab, type Lab } from "./oklab.ts";

const hexToLab = (hex: string): Lab => {
  const n = parseInt(hex.slice(1), 16);
  return rgbToLab(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const labToHex = ([L, A, B]: Lab) =>
  `#${labToRgb(L, A, B)
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

// 처음엔 빠르게, 끝은 천천히 내려앉는다(M3 의 강조 감속)
const ease = (t: number) => 1 - (1 - t) ** 3;

let frame = 0;
// 옮기는 동안 :root 에 붙는 표시. 색 트랜지션이 걸린 요소(버튼 등)가 매 프레임 새 트랜지션을 시작해 뒤처졌다가 끝에 튀지 않게 트랜지션을 끈다(style.css)
const SHIFTING = "shifting";
// 30Hz 한 주기(33.3ms)보다 조금 짧게. 60Hz 화면에서 프레임 시각이 흔들려도 두 프레임에 한 번씩 고르게 바뀌게
const MIN_STEP_MS = 32;

/** 지금 깔린 색에서 target 으로 duration 동안 옮긴다. 진행 중이면 그 자리에서 이어 간다 */
export function blendTo(target: Record<string, string>, duration: number) {
  const root = document.documentElement;
  cancelAnimationFrame(frame);
  root.dataset[SHIFTING] = "";
  const from: Record<string, Lab> = {};
  const to: Record<string, Lab> = {};
  for (const [name, hex] of Object.entries(target)) {
    const now = root.style.getPropertyValue(name).trim();
    from[name] = hexToLab(/^#[0-9a-f]{6}$/i.test(now) ? now : hex);
    to[name] = hexToLab(hex);
  }
  const start = performance.now();
  let last = -Infinity;
  const step = (time: number) => {
    // 프레임 시각은 그 프레임이 시작된 때라 start 보다 앞설 수 있다. 0 아래로 내려가면 첫 프레임이 반대쪽으로 튄다
    const t = Math.min(1, Math.max(0, (time - start) / duration));
    // 색을 바꾸면 화면 전체를 다시 그린다. 120 · 144Hz 화면에서도 1초에 30번까지만 바꾼다(0.7초 동안 21단계, 느린 색 변화라 눈에 띄지 않는다)
    if (t < 1 && time - last < MIN_STEP_MS) {
      frame = requestAnimationFrame(step);
      return;
    }
    last = time;
    const k = ease(t);
    for (const name of Object.keys(to)) {
      const a = from[name];
      const b = to[name];
      root.style.setProperty(name, t === 1 ? target[name] : labToHex([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]));
    }
    if (t < 1) frame = requestAnimationFrame(step);
    else delete root.dataset[SHIFTING];
  };
  frame = requestAnimationFrame(step);
}

/** 바로 깐다(처음 · 움직임 줄이기) */
export function setNow(target: Record<string, string>) {
  cancelAnimationFrame(frame);
  const root = document.documentElement;
  delete root.dataset[SHIFTING];
  for (const [name, hex] of Object.entries(target)) root.style.setProperty(name, hex);
}
