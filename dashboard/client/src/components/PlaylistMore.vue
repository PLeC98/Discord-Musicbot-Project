<template>
  <div class="mt-3 rounded-2xl border border-accent/25 bg-linear-135 from-accent/10 to-accent-2/5 px-4 py-3.5">
    <div class="flex items-start gap-3">
      <div class="size-9 rounded-xl bg-linear-135 from-accent to-accent-2 flex items-center justify-center shrink-0 text-white shadow-[0_4px_14px_var(--accent-glow)]">
        <Icon name="list" :size="18" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-sm font-semibold text-fg">{{ label }}에 곡이 더 남아 있어요</span>
          <span class="text-muted text-[0.78rem] tabular-nums whitespace-nowrap">{{ fmt(more.offset) }} / {{ fmt(more.total) }}곡</span>
        </div>
        <div class="mt-2 h-1.5 rounded-full bg-white/8 overflow-hidden">
          <div class="h-full rounded-full bg-linear-90 from-accent to-accent-2 transition-[width] duration-500 ease-smooth" :class="busy && 'animate-pulse'" :style="{ width: `${progress}%` }"></div>
        </div>
      </div>
      <!-- 닫기 — 둘레의 고리가 남은 시간만큼 줄어들고, 다 줄면 디스코드 메뉴처럼 사라진다 -->
      <button type="button" class="relative size-8 -mr-1 -mt-1 rounded-full flex items-center justify-center shrink-0 text-muted cursor-pointer transition-[background-color,color] duration-150 hover:not-disabled:text-fg hover:not-disabled:bg-white/8 disabled:opacity-40 disabled:cursor-not-allowed" :disabled="busy" v-tooltip="busy ? '넣는 중' : `닫기 · ${secondsLeft}초 뒤 사라져요`" aria-label="닫기" @click="$emit('close')">
        <svg class="absolute inset-0 -rotate-90 pointer-events-none" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2" class="opacity-15" />
          <circle :key="timerKey" cx="16" cy="16" r="14" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" :stroke-dasharray="RING" stroke-dashoffset="0" class="ring-drain" :style="{ animationDuration: `${lifetime}ms`, animationPlayState: busy ? 'paused' : 'running' }" />
        </svg>
        <Icon name="close" :size="14" />
      </button>
    </div>

    <div v-if="cap === 0" class="mt-3 text-warning text-[0.82rem]">대기열이 가득 차 지금은 더 넣을 수 없어요. 곡이 빠지면 바로 이어서 넣을 수 있어요.</div>

    <div v-else class="mt-3.5 flex flex-col">
      <div class="flex flex-wrap gap-2 pt-1">
        <button v-for="n in steps" :key="n" type="button" :class="chip" :disabled="busy" @click="$emit('add', n)">+{{ fmt(n) }}곡</button>
        <button type="button" :class="chip" :disabled="busy" @click="$emit('add', cap)">{{ cap < more.remaining ? `넣을 수 있는 만큼 · ${fmt(cap)}곡` : `남은 곡 전부 · ${fmt(cap)}곡` }}</button>
      </div>

      <div class="flex items-center gap-3 pt-1">
        <input v-model.number="amount" type="range" min="1" :max="cap" class="flex-1 h-1 accent-accent cursor-pointer disabled:cursor-not-allowed" :disabled="busy" aria-label="넣을 곡 수" />
        <input v-model.number="amount" type="text" inputmode="numeric" maxlength="5" class="w-13 bg-white/6 border border-white/9 rounded-[10px] text-fg px-2 py-1.5 text-[0.85rem] text-right tabular-nums outline-none transition-[border-color] duration-200 focus:border-accent/55" :class="!valid && 'border-danger/60'" :disabled="busy" aria-label="넣을 곡 수 직접 입력" @keydown.enter="valid && !busy && $emit('add', amount)" />
        <BaseButton size="sm" type="button" class="px-3! py-2! whitespace-nowrap" :disabled="busy || !valid" @click="$emit('add', amount)">{{ busy ? "넣는 중..." : "추가" }}</BaseButton>
      </div>

      <div class="text-muted text-[0.76rem]">
        남은 {{ fmt(more.remaining) }}곡<template v-if="Number.isFinite(room)"> · 대기열에 넣을 수 있는 자리 {{ fmt(room) }}곡</template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from "vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";

// 재생목록 이어 넣기 — 디스코드 메뉴와 기능은 같지만 모양은 웹에 맞춘다:
// 자주 쓰는 양은 한 번 누르면 끝나고, 그 밖의 양은 슬라이더나 숫자로 고른다.
// 남은 자리는 대기열이 바뀌는 대로 다시 센다(대시보드 이벤트가 queueTotal을 갱신한다).
const props = defineProps({
  more: { type: Object, required: true }, // 서버가 준 이어 넣기 상태 { kind, offset, total, remaining, batch, lifetimeMs, ... }
  queueTotal: { type: Number, default: 0 },
  queueMax: { type: Number, default: 0 }, // 0이면 상한 없음
  busy: { type: Boolean, default: false },
});
const emit = defineEmits(["add", "close"]);

const chip = "px-3 py-1.5 rounded-full text-[0.8rem] font-semibold text-fg bg-white/7 border border-white/10 cursor-pointer tabular-nums " + "transition-[background-color,border-color,scale] duration-150 hover:not-disabled:bg-accent/20 hover:not-disabled:border-accent/40 " + "active:not-disabled:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed";

const fmt = (n) => Number(n).toLocaleString("ko-KR");
const batch = computed(() => props.more.batch || 50);
const label = computed(() => (props.more.kind === "spa" ? "앨범" : "재생목록"));
const room = computed(() => (props.queueMax > 0 ? Math.max(0, props.queueMax - props.queueTotal) : Infinity));
const cap = computed(() => Math.max(0, Math.min(props.more.remaining, room.value)));
const steps = computed(() => [batch.value, batch.value * 2].filter((n) => n < cap.value));
const progress = computed(() => Math.min(100, (props.more.offset / Math.max(1, props.more.total)) * 100));

const amount = ref(Math.max(1, Math.min(cap.value, batch.value)));
watch(cap, (c) => {
  if (amount.value > c) amount.value = Math.max(1, c);
});
const valid = computed(() => Number.isInteger(amount.value) && amount.value >= 1 && amount.value <= cap.value);

// ── 수명 — 디스코드 메뉴와 같다: 가만두면 사라지고, 이어 넣으면 다시 센다. 넣는 동안은 멈춘다.
const RING = 2 * Math.PI * 14;
const lifetime = computed(() => props.more.lifetimeMs || 30000);
const timerKey = ref(0);
const secondsLeft = ref(Math.ceil(lifetime.value / 1000));
let deadline = 0;
let pausedLeft = 0;
let tick = null;

function stop() {
  clearInterval(tick);
  tick = null;
}

function run(ms) {
  stop();
  deadline = Date.now() + ms;
  const step = () => {
    const left = deadline - Date.now();
    secondsLeft.value = Math.max(0, Math.ceil(left / 1000));
    if (left <= 0) {
      stop();
      emit("close");
    }
  };
  step();
  tick = setInterval(step, 250);
}

function restart() {
  timerKey.value++; // 고리 애니메이션을 처음부터
  pausedLeft = 0;
  if (!props.busy) run(lifetime.value);
}

watch(() => props.more, restart, { immediate: true });
watch(
  () => props.busy,
  (busy) => {
    if (busy) {
      pausedLeft = Math.max(0, deadline - Date.now());
      stop();
    } else if (tick === null) {
      run(pausedLeft || lifetime.value); // 실패해서 상태가 그대로면 멈춘 자리부터 이어 센다
    }
  },
);
onBeforeUnmount(stop);
</script>

<style scoped>
.ring-drain {
  animation-name: ring-drain;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
@keyframes ring-drain {
  to {
    stroke-dashoffset: 87.965; /* 2π × 14 — RING과 같다 */
  }
}
</style>
