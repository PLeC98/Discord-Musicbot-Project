<template>
  <!-- 알림함: 위 막대 오른쪽 끝의 종. 안 읽은 알림이 있으면 수를 단 배지(M3 큰 배지), 누르면 지금까지 뜬 알림(새 것이 위).
       열면 그때까지 온 것을 읽음으로 친다(열어 둔 동안은 새로 온 항목을 칠해 두었다가, 닫을 때 읽음).
       지우면(항목마다 x · 지우기) 항목이 제자리에서 오른쪽으로 빠진 뒤 그 공간을 접는다(아래 항목이 올라온다). 모두 지우기는 보이는 항목을 아래부터 차례로.
       다 지우면 목록이 "알림 없음" 높이(h-32)에서 멈추고 그 자리에 "알림 없음"이 나타난다(목록이 접혔다가 다시 늘어나지 않게) -->
  <button ref="triggerEl" type="button" aria-haspopup="dialog" :aria-expanded="open" :aria-label="unread ? T.inboxUnread(unread) : T.inbox" v-tooltip="open ? null : T.inbox" :class="[TOPBAR_BTN, open && 'bg-on-surface/8']" class="relative" @click="toggle">
    <Icon name="notifications" :fill="unread > 0" />
    <span v-if="unread" class="absolute -top-0.5 left-[calc(50%+2px)] h-4 min-w-4 px-1 rounded-full bg-error text-on-error text-2xs leading-4 font-semibold nums text-center">{{ unread > 99 ? "99+" : unread }}</span>
  </button>

  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-200" @click="close" @contextmenu="close"></div>
    <Transition enter-from-class="opacity-0 scale-90" leave-to-class="opacity-0 scale-95" enter-active-class="transition-[opacity,scale] spring-fast" leave-active-class="transition-[opacity,scale] duration-150">
      <div v-if="open" role="dialog" :aria-label="T.inbox" :style="pos" class="fixed z-210 w-[min(24rem,calc(100vw-1rem))] flex flex-col max-h-[min(36rem,calc(100dvh-5rem))] p-2 rounded-3xl pane-menu origin-top-right">
        <div class="flex items-center gap-2 pl-3 pr-1 pt-1 pb-2">
          <span class="flex-1 text-title font-semibold">{{ T.inbox }}</span>
          <button type="button" class="tap state-layer h-8 px-3 rounded-full text-label font-semibold cursor-pointer text-primary disabled:text-on-surface/38 disabled:cursor-not-allowed" :disabled="!inbox.length || clearing" @click="clearAll">{{ T.inboxClear }}</button>
        </div>
        <TransitionGroup v-if="inbox.length || leaving > 0" ref="listRef" tag="ul" class="overflow-y-auto overflow-x-hidden flex flex-col gap-1 transition-[min-height] duration-200 ease-smooth" :class="[inbox.length ? 'min-h-0' : 'min-h-32', leaving > 0 && !scrolled && 'overflow-y-hidden!']" :style="listFade" :css="false" @leave="onLeave">
          <li v-for="one in inbox" :key="one.id" :data-id="one.id" class="flex gap-3 items-start pl-3 pr-1 py-2.5 rounded-2xl" :class="seen.has(one.id) ? 'bg-surface-container-highest' : 'bg-secondary-container'">
            <Icon :name="TOAST_LOOK[one.severity].icon" :size="20" fill class="shrink-0 mt-0.5" :class="TOAST_LOOK[one.severity].ink" />
            <div class="flex-1 min-w-0 whitespace-pre-line text-body">
              <div class="flex items-baseline gap-2">
                <span class="flex-1 min-w-0 font-semibold text-on-surface">{{ one.title }}</span>
                <time class="shrink-0 text-label text-on-surface-variant nums" :datetime="new Date(one.at).toISOString()" v-tooltip="toastFull(one.at)">{{ toastWhen(one.at) }}</time>
              </div>
              <div v-if="one.body" class="text-on-surface-variant">{{ one.body }}</div>
              <div v-if="one.detail" class="text-on-surface-variant">{{ one.detail }}</div>
              <a v-if="one.reportUrl" :href="one.reportUrl" target="_blank" rel="noopener" class="text-primary text-label font-semibold hover:underline">{{ text.common.reportToDeveloper }}</a>
              <div v-if="one.codeLine" class="text-on-surface-variant text-label mt-0.5">{{ one.codeLine }}</div>
            </div>
            <button type="button" class="tap state-layer size-8 -my-1 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-on-surface-variant" :aria-label="T.inboxRemoveOne" v-tooltip="T.inboxClear" @click="removeFromInbox(one.id)"><Icon name="close" :size="20" /></button>
          </li>
        </TransitionGroup>
        <Transition enter-from-class="opacity-0" enter-active-class="transition-opacity duration-200">
          <div v-if="!inbox.length && !leaving" class="h-32 flex flex-col items-center justify-center gap-2 text-on-surface-variant">
            <Icon name="notifications_off" :size="32" />
            <span class="text-body">{{ T.inboxEmpty }}</span>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onKeyStroke } from "@vueuse/core";
import Icon from "../components/BaseIcon.vue";
import { TOPBAR_BTN } from "../utils/topbar.ts";
import { inbox, unread, markAllRead, removeFromInbox } from "../composables/toasts.ts";
import { TOAST_LOOK, toastWhen, toastFull } from "../utils/toast-look.ts";
import { useScrollFade } from "../composables/scroll-fade.ts";
import { text } from "../text/index.ts";
const T = text.shell;

const triggerEl = ref<HTMLElement | null>(null);
const open = ref(false);
const pos = ref<Record<string, string>>({});
// 열 때 이미 읽은 항목. 열어 둔 동안 이것 밖의 항목(새로 온 것)을 칠한다
const seen = ref(new Set<number>());
const listRef = ref<{ $el: HTMLElement } | null>(null);
const listEl = computed(() => listRef.value?.$el ?? null);
const listFade = useScrollFade(listEl, () => open.value, 24);

function toggle() {
  if (open.value) return close();
  const r = triggerEl.value?.getBoundingClientRect();
  if (!r) return;
  // 종의 오른쪽 끝에 맞춰 아래로
  pos.value = { top: `${Math.round(r.bottom + 8)}px`, right: `${Math.max(8, Math.round(window.innerWidth - r.right))}px` };
  seen.value = new Set(inbox.filter((one) => one.read).map((one) => one.id));
  markAllRead();
  open.value = true;
}

// 열어 둔 동안 온 알림은 보고 있으니 바로 읽음으로(배지를 다시 달지 않는다. 칠은 seen 으로 남는다)
watch(unread, (n) => {
  if (open.value && n) markAllRead();
});

function close() {
  open.value = false;
  // 열어 둔 동안 온 것도 봤으니 읽음으로
  markAllRead();
}

// 지우는 항목: 위치를 지킨 채 오른쪽으로 빠지고(250ms, 앞 40% 는 흐려지지 않는다), 다 빠지면 그 공간을 접는다(200ms).
// 흐름에서 빼면(absolute) 목록 높이가 먼저 줄어 빠지는 항목이 잘려 안 보이고, 줄어든 목록 밖으로 삐져나와 스크롤바가 생긴다
const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const GAP = 4; // 항목 사이(gap-1). 접힌 항목 양쪽 틈이 겹치지 않게 한쪽을 당긴다
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
  row
    .animate(
      [
        { translate: "0 0", opacity: 1 },
        { opacity: 1, offset: 0.4 },
        { translate: "100% 0", opacity: 0 },
      ],
      { duration: 250, easing: EASE, fill: "forwards" },
    )
    .finished.then(() => {
      const { height, paddingTop, paddingBottom } = getComputedStyle(row);
      row.style.overflow = "hidden";
      return row.animate(
        [
          { height, paddingTop, paddingBottom },
          { height: "0px", paddingTop: "0px", paddingBottom: "0px", ...pull },
        ],
        { duration: 200, easing: EASE, fill: "forwards" },
      ).finished;
    })
    .then(finish, finish);
}

// 지우기(안드로이드처럼): 보이는 항목은 아래부터 차례로 오른쪽으로 빠지고, 스크롤 밖의 항목은 바로 지운다.
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

onKeyStroke("Escape", () => open.value && close());
</script>
