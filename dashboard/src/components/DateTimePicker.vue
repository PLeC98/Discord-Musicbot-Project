<template>
  <!-- 날짜 · 시각 고르기. 누르는 칸은 드롭다운과 같은 모양, 펼친 창(304)에 달력 · 시 · 분 · "초기화" · "적용". PC · 태블릿 · 휴대폰 모두 같은 부품.
       날짜: 헤더의 "2026년 10월 ▾" → 연도 목록 → 월 목록 → 달력(M3 날짜 고르기처럼). 달력은 좌우로 끌면 따라오고 충분히 밀면 이전 · 다음 달로. ‹ › 도 있다.
       시간: 위아래로 돌리는 휠(WheelPicker, 가운데를 누르면 직접 친다). 로그가 없는 날 · 월은 막고, 연도 목록과 달 넘기기에서는 뺀다 -->
  <div ref="root" class="relative">
    <button ref="anchor" type="button" :class="boxCls" :aria-expanded="open" @click="toggle">
      <span class="min-w-0 flex items-center gap-2" :class="modelValue == null ? 'text-on-surface-variant' : 'text-on-surface'">
        <Icon name="calendar_month" :size="18" class="shrink-0 text-on-surface-variant" />
        <span class="truncate">{{ modelValue == null ? placeholder : summary(modelValue) }}</span>
      </span>
      <svg class="shrink-0 text-on-surface-variant transition-transform duration-200" :class="open && 'rotate-180'" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
    </button>

    <Teleport to="body">
      <!-- 보통은 칸 아래에 붙인다. 창 폭은 칸이 아니라 달력이 정한다(칸 왼쪽에, 안 들어가면 칸 오른쪽 끝에 맞춘다).
           휴대폰이거나 세로가 좁거나(755 미만), 열 때 칸 위아래 어느 쪽에도 창이 다 들어가지 않으면(필터 창 안처럼) 가운데 팝업으로 띄운다(필터 창과 같은 전환, style.css 의 fdialog). 뒤 누르기 · 기기의 뒤로 · Esc 로 닫는다.
           휴대폰 가로처럼 낮은 화면(세로 512 이하)은 위아래로 쌓으면 시 · 분부터 잘리므로 왼쪽에 헤더 · 달력, 오른쪽에 시 · 분 · 버튼을 둔다.
           끌어서 넘기므로 글자는 선택되지 않게 -->
      <Transition name="fdialog" :duration="asDialog ? { enter: 250, leave: 150 } : 0">
        <div v-if="open" :class="asDialog ? 'fixed inset-0 z-300 flex items-center justify-center p-4' : 'contents'">
          <!-- 뒤를 누르면 바깥 누름(useAnchoredPanel)으로 닫힌다 -->
          <div v-if="asDialog" class="fdialog-scrim absolute inset-0 bg-black/50"></div>
          <div ref="panel" :role="asDialog ? 'dialog' : undefined" :aria-modal="asDialog || undefined" :class="asDialog ? (side ? SIDE_CLS : DIALOG_CLS) : MENU_CLS" :style="asDialog ? undefined : style">
            <!-- 왼쪽(낮은 화면만 묶는다. 그 밖은 묶지 않고 위아래로 잇는다) -->
            <div :class="side ? 'w-72 flex flex-col gap-2' : 'contents'">
              <!-- 헤더: 달 넘기기와 연 · 월 고르기 -->
              <div class="flex items-center justify-between h-9">
                <button v-if="view === 'days'" type="button" :class="NAV_BTN" :disabled="!prevMonth" :aria-label="T.prevMonth" @click="turn(-1)"><Icon name="chevron_right" :size="20" class="rotate-180" /></button>
                <span v-else class="size-8"></span>
                <button type="button" class="tap state-layer h-8 pl-3 pr-1.5 rounded-full flex items-center gap-0.5 text-sm font-semibold cursor-pointer" :aria-expanded="view !== 'days'" @click="toggleYears">{{ view === "days" ? T.month(shown.year, shown.month + 1) : view === "months" ? T.year(pickYear) : T.pickYear }}<Icon name="expand_more" :size="20" class="transition-transform duration-200" :class="view !== 'days' && 'rotate-180'" /></button>
                <button v-if="view === 'days'" type="button" :class="NAV_BTN" :disabled="!nextMonth" :aria-label="T.nextMonth" @click="turn(1)"><Icon name="chevron_right" :size="20" /></button>
                <span v-else class="size-8"></span>
              </div>

              <!-- 보기 바꾸기(달력 ↔ 연도 ↔ 월): 서서히 나타나며 조금 커진다(M3 날짜 고르기처럼). 높이는 세 보기가 같다 -->
              <div class="relative h-63 shrink-0">
                <Transition name="dview">
                  <!-- 연도 목록: 로그가 있는 연도만(해가 바뀌어 로그가 쌓이면 그 연도가 저절로 생긴다), 지금 연도가 가운데로 -->
                  <div v-if="view === 'years'" key="years" ref="yearsEl" class="absolute inset-0 overflow-y-auto scrollbar-none grid grid-cols-3 content-start gap-1">
                    <button v-for="y in years" :key="y" type="button" :data-year="y" class="tap h-10 rounded-full text-sm nums cursor-pointer" :class="y === cursor.year ? 'bg-primary text-on-primary font-semibold' : 'state-layer'" @click="chooseYear(y)">{{ y }}</button>
                  </div>

                  <!-- 월 목록(그 연도의). 로그가 없는 달은 막는다 -->
                  <div v-else-if="view === 'months'" key="months" class="absolute inset-0 grid grid-cols-3 content-center gap-y-3 gap-x-1">
                    <button v-for="m in 12" :key="m" type="button" class="tap h-10 rounded-full text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-30" :class="pickYear === cursor.year && m - 1 === cursor.month ? 'bg-primary text-on-primary font-semibold' : 'state-layer'" :disabled="!monthHasLogs(pickYear, m - 1)" @click="chooseMonth(m - 1)">{{ T.monthName(m) }}</button>
                  </div>

                  <!-- 달력: 요일 줄은 그대로, 날짜는 이전 · 지금 · 다음 달 세 장을 나란히 두고 함께 움직인다(끄는 동안 옆 달이 바로 붙어 보인다). 옆 달은 로그가 있는 가장 가까운 달 -->
                  <div v-else key="days" class="absolute inset-0 flex flex-col touch-pan-y" @pointerdown="swipeDown" @pointermove="swipeMove" @pointerup="swipeUp" @pointercancel="swipeUp">
                    <div class="grid grid-cols-7 text-center">
                      <span v-for="(w, i) in T.weekdays" :key="w" class="h-6 flex items-center justify-center text-2xs font-medium" :class="i === 0 ? 'text-(--log-error)' : 'text-on-surface-variant'">{{ w }}</span>
                    </div>
                    <div class="flex-1 overflow-hidden">
                      <div class="flex w-[300%] h-full" :style="trackStyle">
                        <div v-for="page in pages" :key="page.key" class="w-1/3 shrink-0 grid grid-cols-7 content-start text-center">
                          <button
                            v-for="d in page.days"
                            :key="d.key"
                            type="button"
                            class="tap mx-auto my-px size-9 rounded-full text-sm nums flex items-center justify-center cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                            :class="[d.selected ? 'bg-primary text-on-primary font-semibold' : 'state-layer', !d.inMonth && !d.selected && 'text-on-surface-variant/60', d.today && !d.selected && 'ring-1 ring-primary']"
                            :disabled="d.disabled"
                            :tabindex="page.key === 'now' ? 0 : -1"
                            @click="pickDay(d.date)"
                          >
                            {{ d.date.getDate() }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Transition>
              </div>
            </div>

            <!-- 오른쪽(낮은 화면만): 구분선 뒤에 시 · 분(큰 휠, 세로 가운데)과 버튼(맨 아래, 시 · 분 자리를 밀지 않는다) -->
            <div :class="side ? 'relative flex flex-col justify-center pl-4 border-l border-outline-variant/50' : 'contents'">
              <!-- 시 · 분: 돌리는 휠. 마우스 휠 한 번에 1. 콜론이 달력 가운데(수요일 열) 아래에 오게 시계 아이콘은 자리를 차지하지 않고 시 휠 왼쪽에 붙인다 -->
              <div class="flex justify-center" :class="side ? 'pl-6' : '-mt-1 pt-1 border-t border-outline-variant/50'">
                <div class="relative flex items-center gap-2">
                  <Icon name="schedule" :size="18" class="absolute right-full top-1/2 -translate-y-1/2 mr-2 text-on-surface-variant" />
                  <WheelPicker v-model="hour" :count="24" :label="T.hour" :big="side" :class="side ? 'w-16' : 'w-14'" />
                  <span class="font-semibold text-on-surface-variant" :class="side ? 'text-2xl' : 'text-lg'">:</span>
                  <WheelPicker v-model="minute" :count="60" :label="T.minute" :big="side" :class="side ? 'w-16' : 'w-14'" />
                </div>
              </div>

              <!-- 초기화(고른 시각을 지우고 파일 끝으로) · 적용 -->
              <div class="flex items-center justify-between gap-2" :class="side && 'absolute bottom-0 left-4 right-0'">
                <BaseButton variant="ghost" size="sm" @click="latest">{{ T.reset }}</BaseButton>
                <BaseButton variant="primary" size="sm" :disabled="!picked" @click="go">{{ confirmLabel }}</BaseButton>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import WheelPicker from "./WheelPicker.vue";
import { useMediaQuery } from "@vueuse/core";
import { PHONE_QUERY, SHORT_QUERY } from "../utils/breakpoints.ts";
import { coveredBottom, useAnchoredPanel } from "../composables/anchored-panel.ts";
import { rem } from "../utils/rem.ts";
import { text } from "../text/index.ts";

// 창 폭(rem). 날짜 한 셀 40 × 7 + 여백
const PANEL_REM = 19;
// 칸에 붙인 창의 높이(rem): 헤더 2.25 · 달력 15.75 · 시 · 분 6.25 · 버튼 2 · 사이 · 안쪽 여백 3(실제 465px)
const PANEL_H_REM = 29.25;
const GAP = 4;

/**
 * modelValue: 고른 시각(ms, 고르지 않았으면 null). ranges: 로그가 있는 기간들([처음, 끝], 파일마다). 그 밖의 날 · 월은 막고 연도는 빼며, 달 넘기기는 건너뛴다.
 * 없으면 막지 않는다. confirmLabel: 확인 버튼 글
 */
const props = withDefaults(defineProps<{ modelValue: number | null; ranges?: Array<[number, number]>; placeholder?: string; confirmLabel?: string }>(), { ranges: () => [], placeholder: text.fields.datePicker.placeholder, confirmLabel: text.fields.datePicker.apply });
const emit = defineEmits<{ "update:modelValue": [value: number | null]; go: [value: number | null] }>();

const T = text.fields.datePicker;

const boxCls = "w-full h-10 pl-4 pr-3 text-sm flex items-center justify-between gap-2 bg-surface-container-highest border border-transparent rounded-(--r-inner) text-on-surface text-left cursor-pointer outline-none transition-[border-color] duration-150 focus-visible:border-primary";
// 펼친 창: 칸 아래에 붙일 때(드롭다운 판) · 가운데 팝업일 때(M3 대화상자). 높이가 모자라면 줄이지 않고 스크롤한다
const MENU_CLS = "pane-menu bg-surface-container-low! rounded-lg p-3 flex flex-col gap-2 select-none";
const DIALOG_CLS = "fdialog-panel relative w-80 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-high p-4 flex flex-col gap-2 select-none";
// 낮은 화면의 팝업: 좌우로 나눈다
const SIDE_CLS = "fdialog-panel relative max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-high p-4 flex gap-4 select-none";
const NAV_BTN = "tap state-layer size-8 rounded-full flex items-center justify-center cursor-pointer text-on-surface disabled:opacity-30 disabled:cursor-not-allowed";

const summary = (ms: number) => T.summary(new Date(ms));

const root = ref<HTMLElement | null>(null);
const anchor = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const open = ref(false);
// 휴대폰이거나 세로 755px 미만이면 가운데 팝업. 그 밖에도 열 때 칸 위아래 어느 쪽에도 창이 다 들어가지 않으면(cramped) 팝업
const smallScreen = useMediaQuery(`${PHONE_QUERY}, (max-height: 47.18rem)`);
const cramped = ref(false);
const asDialog = computed(() => smallScreen.value || cramped.value);
const short = useMediaQuery(SHORT_QUERY);
const side = computed(() => asDialog.value && short.value);
function noRoom() {
  const el = anchor.value;
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const need = rem(PANEL_H_REM) + GAP;
  return window.innerHeight - coveredBottom(el) - rect.bottom < need && rect.top < need;
}
const { style } = useAnchoredPanel({ root, anchor, panel, open, maxHeight: 560, gap: GAP, width: rem(PANEL_REM) });

// 펼친 창의 상태: 보고 있는 달(cursor) · 고른 날 · 시 · 분 · 보기(달력 · 연도 · 월)
const view = ref<"days" | "years" | "months">("days");
const cursor = ref({ year: 0, month: 0 });
const pickYear = ref(0);
const day = ref<Date | null>(null);
const hour = ref(0);
const minute = ref(0);
// 기간 끝: 로그의 마지막 시각(없으면 지금)
const lastAt = () => (props.ranges.length ? Math.max(...props.ranges.map(([, to]) => to)) : Date.now());
function toggle() {
  if (!open.value) cramped.value = noRoom();
  open.value = !open.value;
  if (!open.value) return;
  // 고른 것이 없으면 로그의 끝(마지막 줄) 날 · 시각에서 시작한다. 시각만 고쳐 바로 갈 수 있게
  const d = new Date(props.modelValue ?? lastAt());
  cursor.value = { year: d.getFullYear(), month: d.getMonth() };
  day.value = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  hour.value = d.getHours();
  minute.value = d.getMinutes();
  view.value = "days";
  slide.value = 0;
}

// ── 로그가 있는 기간 ──
// [from, to) 와 겹치는 로그 기간이 있는가. 기간을 받지 않았으면 늘 참
const hasLogs = (from: number, to: number) => !props.ranges.length || props.ranges.some(([a, b]) => a < to && b >= from);
const dayHasLogs = (d: Date) => hasLogs(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime());
const monthHasLogs = (y: number, m: number) => hasLogs(new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime());
const yearHasLogs = (y: number) => hasLogs(new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime());
const firstYear = () => new Date(props.ranges.length ? Math.min(...props.ranges.map(([from]) => from)) : Date.now()).getFullYear();

/** dir 쪽으로 로그가 있는 가장 가까운 달(없으면 null). 기간을 받지 않았으면 바로 옆 달 */
function neighbor(y: number, m: number, dir: 1 | -1) {
  const limit = dir > 0 ? new Date(lastAt()).getFullYear() : firstYear();
  for (let d = new Date(y, m + dir, 1); dir > 0 ? d.getFullYear() <= limit : d.getFullYear() >= limit; d = new Date(d.getFullYear(), d.getMonth() + dir, 1)) {
    if (monthHasLogs(d.getFullYear(), d.getMonth())) return { year: d.getFullYear(), month: d.getMonth() };
  }
  return null;
}
const prevMonth = computed(() => neighbor(cursor.value.year, cursor.value.month, -1));
const nextMonth = computed(() => neighbor(cursor.value.year, cursor.value.month, 1));

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
// 한 달의 6주 셀: 그 달 1일이 든 주의 일요일부터. 로그가 없는 날은 막는다
function monthDays(y: number, m: number) {
  const first = new Date(y, m, 1);
  const from = new Date(first);
  from.setDate(1 - first.getDay());
  const today = new Date();
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(from);
    date.setDate(from.getDate() + i);
    return { key: date.toDateString(), date, inMonth: date.getMonth() === m, today: sameDay(date, today), selected: day.value != null && sameDay(date, day.value), disabled: !dayHasLogs(date) };
  });
}
// 세 장: 이전(로그가 있는 가장 가까운 달) · 지금 · 다음. 옆 달이 없으면 지금 달을 빈 자리로 둔다(끌어도 버틴다)
const pages = computed(() => {
  const now = cursor.value;
  const prev = prevMonth.value ?? now;
  const next = nextMonth.value ?? now;
  return [
    { key: "prev", days: monthDays(prev.year, prev.month) },
    { key: "now", days: monthDays(now.year, now.month) },
    { key: "next", days: monthDays(next.year, next.month) },
  ];
});
const pickDay = (d: Date) => (day.value = d);

// ── 연 · 월 고르기 ──
const years = computed(() => {
  const from = firstYear();
  const to = new Date(lastAt()).getFullYear();
  return Array.from({ length: to - from + 1 }, (_, i) => from + i).filter(yearHasLogs);
});
const yearsEl = ref<HTMLElement | null>(null);
function toggleYears() {
  if (view.value !== "days") return void (view.value = "days");
  view.value = "years";
  // 지금 연도를 가운데로
  void nextTick(() => yearsEl.value?.querySelector(`[data-year="${cursor.value.year}"]`)?.scrollIntoView({ block: "center" }));
}
function chooseYear(y: number) {
  pickYear.value = y;
  view.value = "months";
}
function chooseMonth(m: number) {
  cursor.value = { year: pickYear.value, month: m };
  slide.value = 0;
  view.value = "days";
}

// ── 달 넘기기: 끌기 · ‹ › ──
// 세 장이 붙은 띠를 옮긴다. 끄는 동안 손을 따라오고(옆 달이 없으면 버티듯 덜), 놓을 때 4분의 1 넘게 밀었거나 빠르게 튕겼으면 옆 장으로 미끄러진 뒤
// 그 달을 지금 달로 삼고 띠를 가운데로 되돌린다(같은 그림이라 티가 나지 않는다). ‹ › 는 같은 미끄러짐
const TURN_MS = 220;
const slide = ref(0);
const sliding = ref(false);
const width = ref(0);
const trackStyle = computed(() => ({ translate: `calc(-100% / 3 + ${slide.value}px) 0`, transition: sliding.value ? `translate ${TURN_MS}ms cubic-bezier(0.2, 0, 0, 1)` : "none" }));
// 넘어가는 중인 달. 헤더 글은 미끄러지기 시작할 때 바로 바꾼다
const turning = ref<{ year: number; month: number } | null>(null);
const shown = computed(() => turning.value ?? cursor.value);
function turn(dir: 1 | -1) {
  const target = dir > 0 ? nextMonth.value : prevMonth.value;
  if (!target || turning.value) return;
  turning.value = target;
  const w = width.value || (panel.value?.querySelector<HTMLElement>(".touch-pan-y")?.offsetWidth ?? 280);
  sliding.value = true;
  slide.value = -dir * w;
  window.setTimeout(() => {
    sliding.value = false;
    cursor.value = target;
    slide.value = 0;
    turning.value = null;
  }, TURN_MS);
}
let swipe: { id: number; x: number; y: number; t: number; locked: "x" | "y" | null } | null = null;
function swipeDown(e: PointerEvent) {
  if ((e.pointerType === "mouse" && e.button !== 0) || turning.value) return;
  width.value = (e.currentTarget as HTMLElement).offsetWidth;
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, locked: null };
}
function swipeMove(e: PointerEvent) {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  if (!swipe.locked) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    swipe.locked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (swipe.locked === "x") (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  if (swipe.locked !== "x") return;
  const blocked = (dx > 0 && !prevMonth.value) || (dx < 0 && !nextMonth.value);
  sliding.value = false;
  slide.value = blocked ? dx / 4 : dx;
}
function swipeUp(e: PointerEvent) {
  if (!swipe || e.pointerId !== swipe.id) return;
  const s = swipe;
  swipe = null;
  if (s.locked !== "x") return;
  // 끈 뒤 손을 뗀 자리의 날짜가 눌리지 않게
  window.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true });
  const dx = e.clientX - s.x;
  const fast = Math.abs(dx) / Math.max(1, e.timeStamp - s.t) > 0.5;
  const dir: 1 | -1 = dx < 0 ? 1 : -1;
  if ((Math.abs(dx) > width.value / 4 || fast) && (dir > 0 ? nextMonth.value : prevMonth.value)) return turn(dir);
  sliding.value = true;
  slide.value = 0;
}

const picked = computed(() => day.value != null);
function go() {
  if (!day.value) return;
  const ms = new Date(day.value.getFullYear(), day.value.getMonth(), day.value.getDate(), hour.value, minute.value).getTime();
  emit("update:modelValue", ms);
  emit("go", ms);
  open.value = false;
}
function latest() {
  emit("update:modelValue", null);
  emit("go", null);
  open.value = false;
}
</script>

<style>
/* 보기 바꾸기: 새 보기는 조금 작았다가 커지며 나타나고, 옛 보기는 빠르게 흐려진다. 둘 다 같은 자리에 겹쳐 있다 */
.dview-enter-active {
  transition:
    opacity 200ms cubic-bezier(0.05, 0.7, 0.1, 1) 50ms,
    scale 200ms cubic-bezier(0.05, 0.7, 0.1, 1) 50ms;
}
.dview-leave-active {
  transition: opacity 100ms cubic-bezier(0.3, 0, 0.8, 0.15);
}
.dview-enter-from,
.dview-leave-to {
  opacity: 0;
}
.dview-enter-from {
  scale: 0.94;
}
</style>
