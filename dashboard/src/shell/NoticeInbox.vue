<template>
  <!-- 알림함 목록(알림 서랍 안). 헤더에 "알림 N", 아래로 지금까지 뜬 알림(새 것이 위, 카드는 떠 있는 알림과 같은 NoticeCard), 오른쪽 아래에 모두 지우기 버튼.
       지우면(카드의 닫기, 모두 지우기) 항목이 제자리에서 오른쪽으로 빠진 뒤 그 공간을 접는다(아래 항목이 올라온다). 모두 지우기는 보이는 항목을 아래부터 차례로.
       다 지우면 목록이 "알림 없음" 높이(h-32)에서 멈추고 그 자리에 "알림 없음"이 나타난다(목록이 접혔다가 다시 늘어나지 않게) -->
  <div role="dialog" :aria-label="T.inbox" class="relative flex flex-col min-h-0">
    <div class="flex items-center gap-2 px-1 pb-2">
      <span class="text-title font-semibold text-on-surface">{{ T.inbox }}</span>
      <span class="text-label text-on-surface-variant nums">{{ inbox.length }}</span>
    </div>
    <TransitionGroup v-if="inbox.length || leaving > 0" ref="listRef" tag="ul" class="overflow-y-auto overflow-x-hidden flex flex-col gap-2 pb-18 -mr-2 pr-2 transition-[min-height] duration-200 ease-smooth" :class="[inbox.length ? 'min-h-0' : 'min-h-32', leaving > 0 && !scrolled && 'overflow-y-hidden!']" :style="listFade" :css="false" @leave="onLeave" @after-leave="swipe.onLeft">
      <!-- 오른쪽으로 밀어 지운다(떠 있는 알림과 같이, composables/swipe-dismiss) -->
      <li v-for="one in inbox" :key="one.id" :data-id="one.id" class="touch-pan-y select-none cursor-grab active:cursor-grabbing transition-[translate,opacity] spring" :style="swipe.styleOf(one.id)" @pointerdown="swipe.onDown($event, one.id)" @pointermove="swipe.onMove" @pointerup="swipe.onUp" @pointercancel="swipe.onUp" @click.capture="swipe.onClickCapture">
        <NoticeCard :item="one" :close-label="T.inboxRemoveOne" @close="removeFromInbox(one.id)" />
      </li>
    </TransitionGroup>
    <Transition enter-from-class="opacity-0" enter-active-class="transition-opacity effects">
      <div v-if="!inbox.length && !leaving" class="h-32 flex flex-col items-center justify-center gap-2 text-on-surface-variant">
        <Icon name="notifications_off" :size="32" />
        <span class="text-body">{{ T.inboxEmpty }}</span>
      </div>
    </Transition>
    <!-- 모두 지우기: 오른쪽 아래에 떠 있는 버튼(목록 끝은 이 버튼만큼 비워 둔다) -->
    <Transition enter-from-class="opacity-0 scale-50" leave-to-class="opacity-0 scale-50" enter-active-class="transition-[opacity,scale] effects" leave-active-class="transition-[opacity,scale] effects-fast">
      <button v-if="inbox.length" type="button" class="tap state-layer absolute right-0 bottom-0 size-14 rounded-2xl flex items-center justify-center bg-primary-container text-on-primary-container shadow-lg cursor-pointer disabled:opacity-38" :disabled="clearing" :aria-label="T.inboxClear" v-tooltip="T.inboxClear" @click="clearAll"><Icon name="delete_sweep" :size="24" /></button>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Icon from "../components/BaseIcon.vue";
import NoticeCard from "../components/NoticeCard.vue";
import { inbox, removeFromInbox } from "../composables/toasts.ts";
import { useScrollFade } from "../composables/scroll-fade.ts";
import { useSwipeDismiss } from "../composables/swipe-dismiss.ts";
import { text } from "../text/index.ts";
const T = text.shell;

const listRef = ref<{ $el: HTMLElement } | null>(null);
const listEl = computed(() => listRef.value?.$el ?? null);
const listFade = useScrollFade(listEl, () => true, 24);

// 열 때 카드가 위에서부터 차례로 내려온다(카드마다 35ms씩 늦게, 공간 스프링). 보이는 카드만
onMounted(() => {
  const list = listEl.value;
  if (!list || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const spring = getComputedStyle(document.documentElement).getPropertyValue("--ease-spring").trim();
  [...list.querySelectorAll<HTMLElement>("li[data-id]")].slice(0, 8).forEach((row, i) =>
    row.animate(
      [
        { opacity: 0, translate: "0 -12px" },
        { opacity: 1, translate: "0 0" },
      ],
      { duration: 460, delay: i * 35, easing: spring, fill: "backwards" },
    ),
  );
});

// 밀어 지운 항목은 민 자리를 쥐고 있다가(움직임 없이) 거기서부터 아래 onLeave로 오른쪽으로 빠진다
const swipe = useSwipeDismiss(removeFromInbox, (dx, fade) => ({ translate: `${dx}px 0`, opacity: fade, transition: "none" }));

// 지우는 항목: 위치를 지킨 채 오른쪽으로 빠지고(250ms, 앞 40%는 흐려지지 않는다), 다 빠지면 그 공간을 접는다(200ms).
// 흐름에서 빼면(absolute) 목록 높이가 먼저 줄어 빠지는 항목이 잘려 안 보이고, 줄어든 목록 밖으로 삐져나와 스크롤바가 생긴다
const EASE = "cubic-bezier(0.2, 0, 0, 1)"; // --ease-smooth와 같은 값(Web Animations는 var()를 읽지 못한다)
const GAP = 8; // 항목 사이(px, gap-2). 접힌 항목 양쪽 틈이 겹치지 않게 한쪽을 당긴다
// 빠지는 항목 수. 마지막 항목을 지워도 다 빠질 때까지 목록을 남겨 둔다("알림 없음"은 그 뒤에)
const leaving = ref(0);
// 지우기 시작할 때 목록이 스크롤되고 있었는지. 아니었으면 지우는 동안 세로 스크롤을 막는다(접히는 끝에 높이가 0 근처면 반 픽셀로 스크롤바가 반짝인다)
const scrolled = ref(false);
function onLeave(el: Element, done: () => void) {
  const row = el as HTMLElement;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return done();
  if (!leaving.value) scrolled.value = !!listEl.value && listEl.value.scrollHeight > listEl.value.clientHeight;
  leaving.value++;
  const finish = () => {
    leaving.value--;
    done();
  };
  const pull = row.nextElementSibling ? { marginBottom: `-${GAP}px` } : row.previousElementSibling ? { marginTop: `-${GAP}px` } : {};
  // 밀어 지웠으면 민 자리에서부터
  const from = row.style.translate || "0 0";
  const fade = row.style.opacity || "1";
  row
    .animate(
      [
        { translate: from, opacity: fade },
        { opacity: fade, offset: 0.4 },
        { translate: "100% 0", opacity: 0 },
      ],
      { duration: 250, easing: EASE, fill: "forwards" },
    )
    .finished.then(() => {
      const { height } = getComputedStyle(row);
      row.style.overflow = "hidden";
      return row.animate([{ height }, { height: "0px", ...pull }], { duration: 200, easing: EASE, fill: "forwards" }).finished;
    })
    .then(finish, finish);
}

// 모두 지우기(안드로이드처럼): 보이는 항목은 아래부터 차례로 오른쪽으로 빠지고, 스크롤 밖의 항목은 바로 지운다.
// 항목 사이 간격은 50ms, 항목이 많으면 다 합쳐 0.5초 안에 끝나게 줄인다
const clearing = ref(false);
function clearAll() {
  const list = listEl.value;
  if (!list || clearing.value) return;
  const box = list.getBoundingClientRect();
  const rows = [...list.querySelectorAll<HTMLElement>("li[data-id]")];
  const inView = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.bottom > box.top && r.top < box.bottom;
  };
  for (const el of rows.filter((el) => !inView(el))) removeFromInbox(Number(el.dataset.id));
  const shown = rows.filter(inView).reverse();
  const step = Math.min(50, 500 / Math.max(shown.length, 1));
  clearing.value = true;
  shown.forEach((el, i) => setTimeout(() => removeFromInbox(Number(el.dataset.id)), i * step));
  setTimeout(() => (clearing.value = false), shown.length * step + 500);
}
</script>
