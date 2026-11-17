<template>
  <!-- 알림 서랍: 바탕화면 오른쪽 위, 위 막대에서 그대로 내려오는 틀 색 면(Hyprland Caelestia 셸의 패널처럼).
       안에 세션 띠(SessionNotice), 그 아래 떠 있는 알림(ToastStack). 종을 누르면 같은 서랍이 알림함(NoticeInbox)으로 늘어난다(그동안 떠 있는 알림은 숨긴다).
       높이는 내용을 따라 공간 스프링으로 움직인다(M3 Expressive). 비면 위 막대 속으로 접혀 들어가며 그 기세로 위 막대 아랫선까지 한 번 쏙 들어갔다가 튕겨 나온다(홈).
       서랍 모양은 style.css의 notice-film(재생 바의 dock-film과 같은 방식), 홈 모양은 아래 dentMask. 휴대폰은 위 막대 아래 폭 전체 -->
  <div v-if="inboxOpen" class="fixed inset-0 z-290" @click="closeInbox" @contextmenu.prevent="closeInbox"></div>
  <!-- 홈: 위 막대 아랫선이 서랍 자리에서 위로 파인 곳. 바탕화면처럼 배경화면만 보인다(틀 막 없이). 위 막대 글자, 버튼보다 밑(z-5 < 위 막대 z-10).
       상자는 가장 깊은 홈 + 아래로 바탕화면 모서리 자리만큼 늘 그 자리에 두고(안에 깐 배경화면 사본이 따라 움직이지 않게) 모양(마스크)만 깊이를 따른다 -->
  <div ref="dentEl" class="absolute right-0 z-5 top-[calc(var(--topbar)-0.5rem)] h-[calc(0.5rem+var(--r-desk))] w-full md:w-[calc(min(26rem,100%)+2*var(--r-desk))] overflow-hidden pointer-events-none" :class="!dentMask && 'invisible'" :style="dentMask && { maskImage: dentMask, maskSize: '100% 100%', maskRepeat: 'no-repeat' }" aria-hidden="true">
    <div class="absolute w-screen h-dvh" :style="{ left: `${-dentLeft}px`, top: `${-dentTop}px` }"><AppWallpaper /></div>
  </div>
  <div ref="drawerEl" class="absolute top-(--topbar) right-0 z-300 w-full md:w-[min(26rem,100%)] pointer-events-none">
    <!-- 크기 컨테이너: 막의 모서리가 지금 높이(cqh)를 따라 줄어든다 -->
    <div class="relative [container-type:size]" :class="shown && 'pointer-events-auto'" :style="{ height: `${height}px` }">
      <!-- 막: 위 막대(틀)와 같은 색이 되게, 바탕화면 대신 배경화면을 화면 좌표에 맞춰 한 장 더 깔고 틀과 같은 막을 얹는다(밑의 카드가 비치지 않는다) -->
      <div ref="filmEl" class="notice-film overflow-hidden" :data-phase="phase" aria-hidden="true">
        <div class="absolute w-screen h-dvh" :style="{ left: `${-filmLeft}px`, top: `${-filmTop}px` }"><AppWallpaper /></div>
        <div class="absolute inset-0 bg-(--frame-color)"></div>
      </div>
      <div class="absolute inset-0 overflow-hidden">
        <div ref="contentEl" class="flex flex-col gap-2 px-(--gap-out) pt-1 pb-(--gap-out) max-h-[min(34rem,calc(var(--desk-h)*0.7))]">
          <SessionNotice />
          <!-- 떠 있는 알림과 알림함은 겹쳐 흐려지며 바뀐다. 나가는 쪽은 흐름에서 빼서(absolute) 서랍 높이가 처음부터 새 내용으로 한 번에 스프링한다
               (차례로 바꾸면 줄었다가 다시 는다) -->
          <div class="relative flex flex-col min-h-0">
            <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity effects" leave-active-class="transition-opacity effects-fast absolute! inset-x-0 top-0">
              <NoticeInbox v-if="inboxOpen" class="min-h-0" />
              <div v-else class="relative flex flex-col gap-2">
                <ToastStack />
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useElementBounding, useMediaQuery, useResizeObserver } from "@vueuse/core";
import { PHONE_QUERY } from "../utils/breakpoints.ts";
import AppWallpaper from "../components/AppWallpaper.vue";
import SessionNotice from "../components/SessionNotice.vue";
import ToastStack from "../components/ToastStack.vue";
import NoticeInbox from "./NoticeInbox.vue";
import { toasts, inboxOpen, closeInbox } from "../composables/toasts.ts";
import { useCloseLayer } from "../composables/close-layer.ts";
import { session } from "../composables/session.ts";

// 서랍을 내리는 때: 알림함을 열었거나, 떠 있는 알림, 세션 띠가 있을 때
const banded = computed(() => session.switched || session.ended || session.offline || session.streamDown);
const shown = computed(() => inboxOpen.value || toasts.length > 0 || banded.value);

// 내용의 높이를 재서 서랍 높이의 목표로
const contentEl = ref<HTMLElement | null>(null);
const contentHeight = ref(0);
useResizeObserver(contentEl, () => (contentHeight.value = contentEl.value?.offsetHeight ?? 0));

// 막 모서리의 단계(style.css의 notice-film): 열림, 닫히는 중, 닫힘(다음에 열 때 0에서 자라게 넓이를 0으로). 닫힘은 스프링이 멎을 때
const phase = ref<"open" | "closing" | "closed">(shown.value ? "open" : "closed");
watch(shown, (on) => (phase.value = on ? "open" : "closing"));

// ── 서랍 높이 스프링 ──
// CSS 전환은 0 밑으로 넘칠 수 없어 직접 푼다. 0 밑으로 넘친 만큼은 위 막대에 파인 홈의 깊이로 그린다(깊어도 DENT px 근처에서 멈춘다).
// 열 때와 내용이 바뀔 때는 M3 Expressive 기본 공간 스프링(감쇠비 0.8, 강성 380. style.css의 --ease-spring과 같은 것),
// 닫을 때는 조금 더 무른 스프링(감쇠비 0.65, 강성 300: 7%쯤 넘쳐 홈이 얕게 파였다가 천천히 돌아온다)
const SPRINGS = { open: { stiffness: 380, damping: 0.8 }, close: { stiffness: 300, damping: 0.65 } };
const DENT = 2.5;
const height = ref(0);
const dent = ref(0);
let pos = 0;
let speed = 0;
let frame = 0;
let last = 0;
const target = computed(() => (shown.value ? contentHeight.value : 0));

function draw() {
  height.value = Math.max(pos, 0);
  dent.value = pos < 0 ? DENT * Math.tanh(-pos / DENT) : 0;
}
function settle() {
  pos = target.value;
  speed = 0;
  frame = 0;
  draw();
  if (!shown.value) phase.value = "closed";
}
function step(now: number) {
  // 탭이 뒤에 있다 돌아오면 한 번에 크게 건너뛰지 않게 50ms까지만
  let left = Math.min((now - last) / 1000, 0.05);
  last = now;
  const { stiffness, damping } = shown.value ? SPRINGS.open : SPRINGS.close;
  const friction = 2 * damping * Math.sqrt(stiffness);
  while (left > 0) {
    const dt = Math.min(left, 0.004);
    speed += (-stiffness * (pos - target.value) - friction * speed) * dt;
    pos += speed * dt;
    left -= dt;
  }
  if (Math.abs(pos - target.value) < 0.25 && Math.abs(speed) < 2) return settle();
  draw();
  frame = requestAnimationFrame(step);
}
// 카드가 펴지고 접힐 때처럼 내용이 스스로 움직여 높이가 프레임마다 조금씩 바뀌면 그대로 따라간다(스프링을 한 번 더 걸면 한 박자 늦게 쫓아가 두둑거린다).
// 한 번에 크게 바뀔 때(열고 닫기, 알림이 들고 남)만 스프링
const FOLLOW = 24;
watch(target, (to) => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return settle();
  if (frame) return;
  if (shown.value && pos > 0 && Math.abs(to - pos) <= FOLLOW) return settle();
  last = performance.now();
  frame = requestAnimationFrame(step);
});
onBeforeUnmount(() => cancelAnimationFrame(frame));

// 막, 홈의 화면 위치(배경화면을 그만큼 거꾸로 옮겨 깐다)
const filmEl = ref<HTMLElement | null>(null);
const { left: filmLeft, top: filmTop } = useElementBounding(filmEl);
const dentEl = ref<HTMLElement | null>(null);
const { left: dentLeft, top: dentTop, width: dentWidth, height: dentHeight } = useElementBounding(dentEl);
const drawerEl = ref<HTMLElement | null>(null);
const { top: barBottom } = useElementBounding(drawerEl);
const phone = useMediaQuery(PHONE_QUERY);

// ── 홈 모양(SVG 마스크) ──
// 홈 = 솟은 바탕화면 윗선 안쪽에서 원래 바탕화면을 뺀 곳(evenodd). 그래서 바탕화면의 둥근 위 모서리는 원래 모서리와 솟은 모서리 사이의 초승달만 칠한다
// (깊이가 0에 가까우면 칠하는 곳도 0에 가깝다. 모서리 바깥 조각을 통째로 칠하면 홈이 생기고 사라질 때 모서리가 순간 각져 깜빡인다).
// PC는 서랍 왼쪽 바깥 2M 폭의 S자 어깨로 원래 윗선에 잇는다. 휴대폰은 폭 전체라 양쪽 위 모서리가 같이 솟는다.
// CSS 그라데이션의 납작한 타원은 윤곽이 계단처럼 깨져 SVG 곡선으로 그린다
const dentMask = computed(() => {
  const d = dent.value;
  const W = dentWidth.value;
  const H = dentHeight.value;
  const B = barBottom.value - dentTop.value; // 상자 안에서 위 막대 아랫선
  const M = H - B; // 바탕화면 모서리 반지름(상자는 그만큼 아래로 내려온다)
  if (d <= 0 || !W || M <= 0) return undefined;
  const top = B - d;
  const corner = (y: number) => `L${W - M},${y} A${M},${M} 0 0 1 ${W},${y + M} L${W},${H}`;
  const outline = phone.value ? (y: number) => `M0,${H} L0,${y + M} A${M},${M} 0 0 1 ${M},${y} ${corner(y)} Z` : null;
  const raised = outline ? outline(top) : `M0,${H} L0,${B} C${M},${B} ${M},${top} ${2 * M},${top} ${corner(top)} Z`;
  const original = outline ? outline(B) : `M0,${H} L0,${B} ${corner(B)} Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path fill-rule="evenodd" d="${raised} ${original}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
});

useCloseLayer(inboxOpen, closeInbox);
</script>
