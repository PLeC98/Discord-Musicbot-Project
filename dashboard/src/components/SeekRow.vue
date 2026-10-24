<template>
  <!-- 서버 화면의 진행 줄. 옆으로(inline): [시간 · 막대 · 길이] 뒤에 slot(볼륨 등). 쌓아서(stacked, 휴대폰): 막대 아래 양 끝에 시간.
       끄는 위치 계산은 seek-bar 가 막대 요소로 한다: 누르면 그 요소를 grab 으로 넘긴다(부른 쪽이 그 요소를 잡는다) -->
  <div v-if="!stacked" class="flex items-center gap-3">
    <span :class="timeBox">{{ time }}</span>
    <div class="flex-1 min-w-0 py-2 touch-none" :class="grabbable && 'cursor-pointer'" @pointerdown.prevent="emit('grab', $event)">
      <SeekTrack v-bind="bar" :thick="4" :height="24" />
    </div>
    <span :class="[timeBox, 'text-right']">{{ length }}</span>
    <slot />
  </div>
  <div v-else>
    <div class="py-2 touch-none" :class="grabbable && 'cursor-pointer'" @pointerdown.prevent="emit('grab', $event)">
      <SeekTrack v-bind="bar" :thick="4" :height="24" />
    </div>
    <div class="flex justify-between text-xs font-medium nums text-on-surface-variant">
      <span>{{ time }}</span>
      <span>{{ length }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import SeekTrack from "./SeekTrack.vue";

type Bar = { value: number; rate: number; markers: { left: number; width: number; color: string; label: string }[]; highlight: number | null; handle: boolean; dragging: boolean };
/** time · length: 지난 시간 · 길이 글(모르면 --:--, 라이브는 "라이브"). bar: 막대(SeekTrack) 값. grabbable: 끌 수 있는지(손 모양) */
const props = defineProps<{ time: string; length: string; bar: Bar; grabbable: boolean; stacked?: boolean }>();
// 시간 칸은 한 줄로. 1시간이 넘는 글(1:02:59)이면 양쪽을 같이 넓힌다(막대가 흔들리지 않게, 막대는 남는 폭만큼 줄어든다)
const timeBox = computed(() => ["shrink-0 whitespace-nowrap text-xs font-medium nums text-on-surface-variant", Math.max(props.time.length, props.length.length) > 5 ? "min-w-14" : "min-w-11"]);
const emit = defineEmits<{ grab: [e: PointerEvent] }>();
</script>
