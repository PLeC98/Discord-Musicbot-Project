// 앨범아트를 좌우로 밀어 곡 넘기기(휴대폰 서버 화면). 왼쪽으로 밀면 다음 곡, 오른쪽이면 이전 곡.
// 끄는 동안 그림이 손가락을 따라오고(넘길 수 없는 쪽이면 끈적하게 조금만), 놓을 때 폭의 30% 를 넘겼거나 빠르게 튕겼으면
// 그 방향으로 빠져나간 뒤 곡을 넘기고(답을 기다려), 새 그림은 반대쪽에서 들어온다. 아니면 제자리로 돌아간다.
// 가로로 움직이기 전에 세로로 먼저 움직이면 화면 스크롤에 넘긴다. 밀었으면 손을 떼며 오는 누름(크게 보기)은 받지 않는다(swiped).

import { computed, ref, type Ref } from "vue";

const SLOP = 8; // 이만큼 움직여야 방향을 정한다
const PASS = 0.3; // 폭의 이만큼 넘기면 넘긴다
const FLING = 0.5; // px/ms 이상으로 놓으면 거리와 상관없이
const RESIST = 0.25; // 넘길 수 없는 쪽으로는 이만큼만 따라온다
const OUT_MS = 200; // 빠져나가는 시간(그 뒤 곡을 넘긴다)

type Actions = { canNext: () => boolean; canPrevious: () => boolean; next: () => unknown; previous: () => unknown };

export function useArtSwipe(el: Ref<HTMLElement | null>, act: Actions) {
  const dx = ref(0);
  const animating = ref(false);
  const swiped = ref(false);
  let start: { id: number; x: number; y: number } | null = null;
  let engaged = false;
  let last = { x: 0, t: 0, v: 0 };

  const width = () => el.value?.offsetWidth || 300;
  const style = computed(() => (dx.value === 0 && !animating.value ? undefined : { translate: `${dx.value}px 0`, opacity: String(1 - Math.min(0.6, Math.abs(dx.value) / width())) }));

  function down(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY };
    engaged = false;
    swiped.value = false;
    last = { x: e.clientX, t: e.timeStamp, v: 0 };
  }

  function move(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    const mx = e.clientX - start.x;
    const my = e.clientY - start.y;
    if (!engaged) {
      if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return;
      if (Math.abs(my) > Math.abs(mx)) {
        start = null;
        return;
      }
      engaged = true;
      swiped.value = true;
      animating.value = false;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    const allowed = mx < 0 ? act.canNext() : act.canPrevious();
    dx.value = allowed ? mx : mx * RESIST;
    const dt = e.timeStamp - last.t;
    if (dt > 0) last = { x: e.clientX, t: e.timeStamp, v: (e.clientX - last.x) / dt };
  }

  function up(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    if (!engaged) return;
    const w = width();
    const toNext = dx.value < 0;
    const allowed = toNext ? act.canNext() : act.canPrevious();
    const far = Math.abs(dx.value) > w * PASS || (toNext ? last.v < -FLING : last.v > FLING);
    animating.value = true;
    if (!allowed || !far) {
      dx.value = 0;
      return;
    }
    // 빠져나간 뒤 곡을 넘기고, 반대쪽에 두었다가 들어오게 한다
    const off = w + 48;
    dx.value = toNext ? -off : off;
    setTimeout(async () => {
      // 넘긴 곡의 그림으로 들어오게 답을 기다린다(늦으면 1초에서 끊는다)
      await Promise.race([Promise.resolve(toNext ? act.next() : act.previous()).catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
      animating.value = false;
      dx.value = toNext ? off : -off;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          animating.value = true;
          dx.value = 0;
        }),
      );
    }, OUT_MS);
  }

  return { down, move, up, style, animating, swiped };
}
