<template>
  <!-- 알림 카드 하나. 떠 있는 알림(ToastStack)과 알림함(NoticeInbox)이 같이 쓴다(폭, 모양이 같다). Hyprland Caelestia 셸의 알림 카드를 본떴다.
       접힘(기본): 종류 색의 동그란 아이콘, 제목(한 줄), 때, 본문 한 줄, 펼침 버튼.
       펼침: 제목, 본문 전체, 세부, 코드 줄, 넓은 알약 버튼 줄(닫기, 복사, 알림마다의 동작. 봇 개발자에게 보고 포함). 늘고 줄어드는 것은 스프링.
       닫기, 복사는 동작 버튼이 있으면 아이콘 폭으로 줄고, 없으면 둘이 줄을 나눠 쓴다. 카드를 누르면(버튼 말고 아무 데나) 펼치고 접는다. 가운데 버튼으로 누르면 바로 닫는다 -->
  <article class="relative overflow-hidden rounded-2xl p-3 text-body bg-surface-container/80 cursor-pointer" @pointerenter="emit('hold', true)" @pointerleave="emit('hold', false)" @auxclick.middle="emit('close')" @click="onCardClick">
    <div class="flex gap-3 items-start">
      <span class="size-10 shrink-0 rounded-full flex items-center justify-center" :class="look.badge"><Icon :name="look.icon" :size="20" /></span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 min-h-6">
          <!-- 제목은 펼쳐도 한 줄(펼 때 줄이 바뀌면 높이가 한 번에 뛴다) -->
          <span class="flex-1 min-w-0 truncate font-semibold text-on-surface">{{ item.title }}</span>
          <time class="shrink-0 text-label text-on-surface-variant nums" :datetime="new Date(item.at).toISOString()" v-tooltip="toastFull(item.at)">{{ when }}</time>
          <button v-if="expandable" type="button" :class="[iconButton(32), '-my-1.5 -mr-1.5']" :aria-expanded="open" :aria-label="open ? text.common.collapse : text.common.expand" @click="open = !open">
            <Icon name="expand_more" :size="20" class="transition-[rotate] spring-fast" :class="open && 'rotate-180'" />
          </button>
        </div>
        <!-- 본문은 하나: 접히면 첫 줄만 보이게 높이를 한 줄까지 줄이고, 펴면 전체로 늘린다(잰 높이 사이를 스프링으로).
             grid 0fr ↔ 1fr은 한 줄을 남길 수 없고, minmax(1lh, …)는 한 줄보다 커질 때까지 멈춰 있어 펼 때 늦게 시작한다.
             다 접힌 뒤에만 말줄임(…)을 붙이고 펴기 시작할 때 뗀다(접히는 동안 붙이면 줄이 한 번에 바뀐다) -->
        <div v-if="item.body" class="overflow-hidden transition-[height] spring" :style="bodyHeight" @transitionend.self="clamped = !open">
          <div ref="bodyEl" class="whitespace-pre-line text-on-surface-variant" :class="clamped && 'line-clamp-1'">{{ item.body }}</div>
        </div>
        <!-- 펼침: 세부, 코드 줄, 버튼 줄. grid 행을 0fr ↔ 1fr로(높이가 auto여도 스프링으로 늘고 준다) -->
        <div class="grid transition-[grid-template-rows] spring" :class="open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'">
          <div class="min-h-0 overflow-hidden">
            <div class="whitespace-pre-line transition-opacity effects" :class="open ? 'opacity-100' : 'opacity-0'">
              <div v-if="item.detail" class="mt-1 text-label text-on-surface-variant break-all">{{ item.detail }}</div>
              <div v-if="item.codeLine" class="mt-0.5 text-label text-outline">{{ item.codeLine }}</div>
              <div class="flex gap-1 mt-3">
                <button type="button" :class="[PILL, actions.length ? 'w-12' : 'flex-1']" :aria-label="closeLabel" v-tooltip="closeLabel" @click="emit('close')"><Icon name="close" :size="18" /></button>
                <button type="button" :class="[PILL, actions.length ? 'w-12' : 'flex-1']" :aria-label="T.noticeCopy" v-tooltip="copied ? T.noticeCopied : T.noticeCopy" @click="copy"><Icon :name="copied ? 'check' : 'content_copy'" :size="18" /></button>
                <component :is="one.to ? RouterLink : one.href ? 'a' : 'button'" v-for="one in actions" :key="one.label" v-bind="attrsOf(one)" :class="[PILL, 'flex-1 min-w-0 px-3']" @click="act(one)"
                  ><Icon v-if="one.icon" :name="one.icon" :size="18" class="shrink-0" /><span class="truncate">{{ one.label }}</span></component
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- 떠 있는 알림만: 아래 띠가 왼쪽부터 차서 다 차면 사라진다(같은 알림이 다시 오면 처음부터. 마우스를 올려 둔 동안은 멈췄다가 떼면 이어 찬다).
         남은 시간이라 움직임 줄이기에도 찬다(data-keep-motion) -->
    <span v-if="ms" :key="round" class="notice-time absolute left-0 bottom-0 h-1 w-full origin-left" data-keep-motion :class="look.bar" :style="{ animationDuration: `${ms}ms`, animationPlayState: held ? 'paused' : 'running' }"></span>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { useIntervalFn, useResizeObserver } from "@vueuse/core";
import Icon from "./BaseIcon.vue";
import type { InboxItem, ToastAction } from "../composables/toasts.ts";
import { closeInbox } from "../composables/toasts.ts";
import { iconButton } from "../utils/icon-button.ts";
import { TOAST_LOOK, toastAgo, toastFull } from "../utils/toast-look.ts";
import { text } from "../text/index.ts";
const T = text.shell;

/** ms, round: 떠 있는 알림의 남은 시간 띠. held: 마우스를 올려 시간을 멈춘 동안. expanded: 처음부터 펼쳐 둔다 */
const props = defineProps<{ item: Pick<InboxItem, "title" | "body" | "detail" | "codeLine" | "severity" | "reportUrl" | "actions" | "at">; ms?: number; round?: number; held?: boolean; expanded?: boolean; closeLabel: string }>();
const emit = defineEmits<{ close: []; hold: [held: boolean] }>();

// 알약 버튼: 누르는 동안 모서리가 줄고 조금 작아진다(M3 Expressive의 모양 바뀜. 모서리는 rounded-full이 아니라 높이의 절반, style.css의 spring 주석)
const PILL = "tap state-layer h-9 shrink-0 rounded-[1.125rem] flex items-center justify-center gap-1.5 text-label font-semibold bg-surface-container-highest text-on-surface-variant cursor-pointer motion-button active:rounded-lg active:scale-97";

const look = computed(() => TOAST_LOOK[props.item.severity]);
const open = ref(props.expanded ?? false);
// 동작 버튼: 알림이 준 것 뒤에, 문장이 봇 개발자를 불렀으면 보고하기
const actions = computed<ToastAction[]>(() => [...props.item.actions, ...(props.item.reportUrl ? [{ label: text.common.reportToDeveloper, icon: "open_in_new" as const, href: props.item.reportUrl }] : [])]);
// 펼칠 것이 늘 있다(닫기, 복사 버튼 줄)
const expandable = true;
// 본문 첫 줄 끝의 말줄임. 다 접힌 뒤에 붙인다
const clamped = ref(!open.value);
watch(open, (on) => on && (clamped.value = false));
// 본문 높이: 한 줄(줄 높이)과 전체(말줄임을 뗀 본문의 높이). 재기 전에는 정하지 않는다(auto)
const bodyEl = ref<HTMLElement | null>(null);
const line = ref(0);
const full = ref(0);
useResizeObserver(bodyEl, () => {
  const el = bodyEl.value;
  if (!el) return;
  line.value = parseFloat(getComputedStyle(el).lineHeight);
  if (!clamped.value) full.value = el.offsetHeight;
});
const bodyHeight = computed(() => (line.value ? { height: `${open.value ? Math.max(full.value, line.value) : line.value}px` } : undefined));

// 때는 30초마다 다시 센다(1분 단위로만 보인다)
const now = ref(Date.now());
useIntervalFn(() => (now.value = Date.now()), 30_000);
const when = computed(() => toastAgo(props.item.at, now.value, T.ago));

// 카드를 누르면 펼치고 접는다(버튼, 링크를 누른 것은 그 버튼의 일)
function onCardClick(event: MouseEvent) {
  if ((event.target as Element).closest("a, button")) return;
  open.value = !open.value;
}

const attrsOf = (one: ToastAction) => (one.to ? { to: one.to } : one.href ? { href: one.href, target: "_blank", rel: "noopener" } : { type: "button" });
function act(one: ToastAction) {
  one.run?.();
  // 다른 화면으로 가면 알림함은 닫는다(알림 카드는 그대로)
  if (one.to) closeInbox();
}

const copied = ref(false);
let copiedTimer = 0;
async function copy() {
  const { title, body, detail, codeLine } = props.item;
  try {
    await navigator.clipboard.writeText([title, body, detail, codeLine].filter(Boolean).join("\n"));
  } catch {
    return;
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => (copied.value = false), 2000);
}
</script>

<style scoped>
.notice-time {
  transform: scaleX(0);
  animation: notice-time linear forwards;
}
@keyframes notice-time {
  to {
    transform: scaleX(1);
  }
}
</style>
