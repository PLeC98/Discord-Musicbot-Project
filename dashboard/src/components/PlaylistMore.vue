<template>
  <div class="mt-3 rounded-3xl bg-primary-container/45 text-on-primary-container px-4 py-4">
    <div class="flex items-start gap-3">
      <div class="size-9 rounded-[30%] bg-primary text-on-primary flex items-center justify-center shrink-0">
        <Icon name="playlist_play" :size="20" />
      </div>
      <div class="flex-1 min-w-0">
        <!-- 첫 배치를 막 넣었으면 그 결과 문장(디스코드 추가 안내와 같다)이 제목 자리에 선다. 넣은 곡 수가 문장에 있어 진행 수는 뺀다 -->
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-body font-semibold">{{ added || T.moreLeft(label) }}</span>
          <span v-if="!added" class="text-label nums whitespace-nowrap opacity-80">{{ T.progress(more.offset, more.total) }}</span>
        </div>
        <div class="mt-2 h-1 rounded-full bg-on-primary-container/15 overflow-hidden">
          <div class="h-full rounded-full bg-primary transition-[width] duration-500 ease-smooth" :class="busy && 'animate-pulse'" :style="{ width: `${progress}%` }"></div>
        </div>
      </div>
      <!-- 가만두면 사라지고(디스코드 메뉴처럼), 이어 넣으면 다시 센다. 넣는 동안은 멈춘다 -->
      <TimerClose :ms="more.lifetimeMs" :round="more" :paused="busy" :paused-tip="T.adding" @close="$emit('close')" />
    </div>

    <div v-if="cap === 0" class="mt-3 text-body">{{ moreText.roomFull() }} {{ T.roomFullHint }}</div>

    <div v-else class="mt-3 flex flex-col">
      <div class="flex flex-wrap gap-2">
        <button v-for="n in steps" :key="n" type="button" :class="chip" :disabled="busy" @click="$emit('add', n)">{{ moreText.step(n) }}</button>
        <button type="button" :class="chip" :disabled="busy" @click="$emit('add', cap)">{{ capLabel }}</button>
      </div>

      <div class="flex items-center gap-3 pt-2">
        <input v-model.number="amount" type="range" min="1" :max="cap" class="m3-slider m3-slider-compact flex-1" :style="{ '--v': cap > 1 ? (Math.min(Math.max(Number(amount) || 1, 1), cap) - 1) / (cap - 1) : 1 }" :disabled="busy" :aria-label="T.amount" />
        <input v-model.number="amount" type="text" inputmode="numeric" :maxlength="String(MAX_COUNT).length" :class="[FIELD, 'w-16 px-3! text-right nums', !valid && 'border-error! focus:border-error!']" :disabled="busy" :aria-label="T.amountInput" @keydown.enter="valid && !busy && $emit('add', amount)" />
        <BaseButton type="button" :disabled="busy || !valid" @click="$emit('add', amount)">{{ busy ? T.addingLong : T.add }}</BaseButton>
      </div>

      <div class="mt-1 text-label opacity-80">
        {{ T.remaining(more.remaining) }}<template v-if="Number.isFinite(room)"> · {{ T.room(room) }}</template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import BaseButton from "./BaseButton.vue";
import { FIELD } from "../utils/field.ts";
import TimerClose from "./TimerClose.vue";
import type { MoreView } from "../../../src/dashboard/contract/player.ts";
import { MAX_COUNT, moreChoices } from "../../../src/rules/more-choices.ts";
import { roomWith } from "../../../src/rules/queue-room.ts";
import { collection } from "../../../src/ui/text/ko/labels.ts";
import * as moreText from "../../../src/ui/text/ko/more.ts";
import { text } from "../text/index.ts";
const T = text.more;

// 재생목록 이어 넣기. 디스코드 메뉴와 기능은 같지만 모양은 웹에 맞춘다:
// 자주 쓰는 양은 한 번 누르면 끝나고, 그 밖의 양은 슬라이더나 숫자로 선택한다.
// 남은 공간은 대기열이 바뀌는 대로 다시 센다(대시보드 이벤트가 queueTotal을 갱신한다).
const props = withDefaults(
  defineProps<{
    /** 서버가 준 이어 넣기 상태 */
    more: MoreView;
    queueTotal?: number;
    /** 지금 곡이 있는지. 없으면 첫 곡은 대기열을 거치지 않고 바로 튼다(공간이 하나 더 있다) */
    hasCurrent?: boolean;
    /** 대기열 상한. 0이면 상한 없음 */
    queueMax?: number;
    busy?: boolean;
    /** 첫 배치를 넣은 결과 문장(added-parts). 있으면 제목 자리에 */
    added?: string;
  }>(),
  { queueTotal: 0, hasCurrent: true, queueMax: 0, busy: false },
);
defineEmits<{ add: [count: number]; close: [] }>();

// 선택지, 남은 공간, 라벨은 디스코드 더 넣기 메뉴와 같은 규칙, 문장(rules/more-choices, rules/queue-room, ui/text/ko/more)
const chip = "tap state-layer h-10 px-4 rounded-xl text-body font-semibold nums cursor-pointer bg-surface-highest/80 text-on-surface motion-button active:not-disabled:rounded-md active:not-disabled:scale-97 disabled:opacity-38 disabled:cursor-not-allowed";

const batch = computed(() => props.more.batch);
const label = computed(() => collection(props.more.collection));
const room = computed(() => roomWith(props.queueTotal, props.hasCurrent, props.queueMax));
// 출처가 한 번에 넣게 하는 상한(사운드클라우드 세트 10). 없으면 없다
const perClick = computed(() => props.more.perClick ?? Infinity);
const choices = computed(() => moreChoices({ remaining: props.more.remaining, room: room.value, batch: batch.value, perClick: perClick.value }));
const cap = computed(() => choices.value.cap);
const steps = computed(() => choices.value.steps);
const capLabel = computed(() => moreText.capLabel(cap.value, { all: cap.value >= props.more.remaining, perClick: cap.value === perClick.value }));
const progress = computed(() => Math.min(100, (props.more.offset / Math.max(1, props.more.total)) * 100));

const amount = ref(Math.max(1, Math.min(cap.value, batch.value)));
watch(cap, (c) => {
  if (amount.value > c) amount.value = Math.max(1, c);
});
const valid = computed(() => Number.isInteger(amount.value) && amount.value >= 1 && amount.value <= cap.value);
</script>
