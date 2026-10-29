// 앨범아트를 좌우로 밀어 곡 넘기기(휴대폰 서버 화면). 왼쪽으로 밀면 다음 곡, 오른쪽이면 이전 곡.
// 그림은 [이전 | 지금 | 다음] 세 칸이 나란히 붙은 띠다. 드래그하는 동안 띠가 손가락을 따라와 옆 칸이 들어오고(넘길 수 없는 쪽이면 끈적하게 조금만),
// 놓을 때 폭의 30% 를 넘겼거나 빠르게 튕겼으면 띠가 옆 칸까지 미끄러지는 동안 곡을 넘긴다. 둘 다 끝나면 같은 프레임에 띠를 제자리로 돌리고
// 화면이 가운데 칸을 새 곡으로 그린다(옆 칸에 떠 있던 그림이라 다시 불러오지 않고 바로 그려진다). 넘기지 못했으면 띠가 돌아온다.
// 드래그를 시작한 때부터 띠가 제자리로 돌아올 때까지는 holding 이다. 화면은 그동안 세 칸의 그림을 붙잡아 둔다(중간에 곡이 바뀌어도 미끄러지는 그림이 바뀌지 않게).
// 가로로 움직이기 전에 세로로 먼저 움직이면 화면 스크롤에 넘긴다. 밀었으면 손을 떼며 오는 누름(크게 보기)은 받지 않는다(swiped).
// 이전 · 다음 버튼도 go 로 같은 미끄러짐을 거쳐 넘긴다.

import { computed, ref, type Ref } from "vue";

const SLOP = 8; // 이만큼(px) 움직여야 방향을 정한다
const PASS = 0.3; // 폭의 이 비율을 넘기면 넘긴다
const FLING = 0.5; // px/ms 이상으로 놓으면 거리와 상관없이
const RESIST = 0.25; // 넘길 수 없는 쪽으로는 손가락 이동의 이 비율만 따라온다
const SLIDE_MS = 250; // 띠가 옆 칸까지 · 제자리로 미끄러지는 시간(화면의 transition 과 같다)
const ANSWER_MS = 1000; // 넘기기 답을 이만큼까지 기다린다(늦으면 넘기지 못한 것으로)

/** next · previous: 넘겼으면 true */
type Actions = { canNext: () => boolean; canPrevious: () => boolean; next: () => Promise<boolean>; previous: () => Promise<boolean> };

/** el: 지금 칸. 옆 칸까지의 거리는 다음 칸(data-art-next)의 위치로 잰다 */
export function useArtSwipe(el: Ref<HTMLElement | null>, act: Actions) {
  const dx = ref(0);
  const animating = ref(false);
  const holding = ref(false);
  const swiped = ref(false);
  let start: { id: number; x: number; y: number } | null = null;
  let engaged = false;
  let last = { x: 0, t: 0, v: 0 };

  const width = () => el.value?.offsetWidth || 300;
  // 지금 칸에서 옆 칸까지(칸 폭 + 간격, 화면이 넓으면 옆 칸이 화면 밖에 있게 더 멀다)
  const step = () => {
    const next = el.value?.parentElement?.querySelector<HTMLElement>("[data-art-next]");
    return next && el.value ? Math.abs(next.getBoundingClientRect().left - el.value.getBoundingClientRect().left) || width() : width();
  };
  const style = computed(() => (dx.value === 0 && !animating.value ? undefined : { translate: `${dx.value}px 0` }));
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  function down(e: PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (holding.value && animating.value) return; // 미끄러지는 중에는 새로 잡지 않는다
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
      holding.value = true;
      animating.value = false;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    const allowed = mx < 0 ? act.canNext() : act.canPrevious();
    dx.value = allowed ? mx : mx * RESIST;
    const dt = e.timeStamp - last.t;
    if (dt > 0) last = { x: e.clientX, t: e.timeStamp, v: (e.clientX - last.x) / dt };
  }

  // 띠를 제자리로 미끄러뜨린 뒤 붙잡은 그림을 놓는다
  async function back() {
    animating.value = true;
    dx.value = 0;
    await wait(SLIDE_MS);
    animating.value = false;
    holding.value = false;
  }

  async function up(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    if (!engaged) return;
    const toNext = dx.value < 0;
    const allowed = toNext ? act.canNext() : act.canPrevious();
    const far = Math.abs(dx.value) > width() * PASS || (toNext ? last.v < -FLING : last.v > FLING);
    if (!allowed || !far) return back();
    return slide(toNext);
  }

  /** 버튼으로 넘기기: 미는 것과 같은 미끄러짐으로. 미는 중 · 미끄러지는 중이면 받지 않는다 */
  async function go(toNext: boolean) {
    if (holding.value || start) return;
    if (!(toNext ? act.canNext() : act.canPrevious())) return;
    holding.value = true;
    animating.value = true;
    await new Promise((r) => requestAnimationFrame(r)); // 붙잡은 그림이 그려진 뒤 움직인다
    return slide(toNext);
  }

  // 옆 칸까지 미끄러지는 동안 곡을 넘긴다
  async function slide(toNext: boolean) {
    animating.value = true;
    dx.value = toNext ? -step() : step();
    const answer = Promise.race([(toNext ? act.next() : act.previous()).catch(() => false), wait(ANSWER_MS).then(() => false)]);
    const [moved] = await Promise.all([answer, wait(SLIDE_MS)]);
    if (!moved) return back();
    // 같은 프레임에: 띠는 움직임 없이 제자리로, 가운데 칸은 새 곡(화면이 붙잡은 그림을 놓아서)
    animating.value = false;
    dx.value = 0;
    holding.value = false;
  }

  return { down, move, up, go, style, animating, holding, swiped };
}
