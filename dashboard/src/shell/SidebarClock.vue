<template>
  <!-- 세로 막대의 시계. 접으면 시 위에 분(세로), 펼치면 "시:분" 한 줄이 두 배로 커져 같은 높이(36)를 채우고 남는 폭에 날짜.
       시는 아이콘 칸 가운데를 중심으로 제자리에서 커지고, 분은 아래에서 오른쪽으로 미끄러진다.
       글자 크기는 그대로 두고 배율(scale)만 바꾼다: 위치를 숫자 폭 단위로 고정해 두어 크기가 변해도 자리가 흔들리지 않는다 -->
  <div class="relative h-9 w-full shrink-0 @container font-round font-semibold nums text-[1.0625rem] leading-4.5" :aria-label="`${hh}시 ${mm}분`">
    <span :class="cell" :style="hourAt">{{ hh }}</span>
    <span :class="[cell, open ? 'opacity-100' : 'opacity-0']" :style="colonAt">:</span>
    <span :class="[cell, 'text-on-surface-variant']" :style="minuteAt">{{ mm }}</span>
    <!-- 날짜: 두 줄(월 · 일 / 요일). 폭이 넓어질수록 "10/05" → "10월 5일" → "2026/10/05" → "2026년 10월 5일" -->
    <span class="absolute top-[0.1rem] flex flex-col font-sans font-medium text-xs leading-4 text-on-surface-variant whitespace-nowrap [font-variation-settings:normal] transition-opacity duration-300" :class="open ? 'opacity-100 delay-100' : 'opacity-0'" :style="dateAt">
      <span class="@min-[11.5rem]:hidden">{{ shortDate }}</span>
      <span class="hidden @min-[11.5rem]:inline @min-[12.75rem]:hidden">{{ month }} {{ day }}</span>
      <span class="hidden @min-[12.75rem]:inline @min-[14.5rem]:hidden">{{ year.slice(0, -1) }}/{{ shortDate }}</span>
      <span class="hidden @min-[14.5rem]:inline">{{ year }} {{ month }} {{ day }}</span>
      <span>{{ weekday }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useIntervalFn, useNow } from "@vueuse/core";
import { shell } from "./shell-state.ts";

// 펼쳤을 때의 배율. 한 줄(18)이 두 줄 높이(36)를 채운다
const BIG = 2;
// 숫자 하나의 폭(17px 글꼴에서 0.647em = 0.6875rem). 날짜처럼 글자 크기가 다른 칸에서도 같은 값이 되게 rem 으로(ch 는 그 칸의 글자 크기를 따른다)
const DIGIT = "0.6875rem";
// 쌍점의 폭(숫자 폭에 대한 비)
const COLON = 0.55;

const open = computed(() => shell.sidebarOpen);
const now = useNow({ scheduler: (cb) => useIntervalFn(cb, 15_000) });
const hh = computed(() => String(now.value.getHours()).padStart(2, "0"));
const mm = computed(() => String(now.value.getMinutes()).padStart(2, "0"));
const year = computed(() => `${now.value.getFullYear()}년`);
const month = computed(() => `${now.value.getMonth() + 1}월`);
const day = computed(() => `${now.value.getDate()}일`);
const shortDate = computed(() => `${String(now.value.getMonth() + 1).padStart(2, "0")}/${String(now.value.getDate()).padStart(2, "0")}`);
const weekday = computed(() => now.value.toLocaleDateString("ko-KR", { weekday: "long" }));

const cell = "absolute top-0 whitespace-nowrap origin-top-left transition-[left,top,scale,opacity] spring";

// 칸 가운데(막대 폭의 절반)를 기준으로 숫자 폭 n 개만큼 옮긴 자리
const at = (n: number) => `calc(var(--bar) / 2 + ${n} * ${DIGIT})`;
// 시: 가운데가 늘 칸 가운데. 폭이 숫자 둘 × 배율이라 왼쪽 끝은 -1 × 배율
// 펼친 한 줄은 숫자의 보이는 위아래 가운데가 칸(36) 가운데에 오게 조금 내린다(줄 상자 가운데보다 숫자가 위에 앉는다. 화면에서 잰 값)
const BIG_TOP = "0.140625rem";
const hourAt = computed(() => ({ left: at(-1 * (open.value ? BIG : 1)), top: open.value ? BIG_TOP : "0", scale: open.value ? BIG : 1 }));
const colonAt = computed(() => ({ left: at(open.value ? BIG : 1), top: open.value ? BIG_TOP : "0", scale: open.value ? BIG : 1 }));
const minuteAt = computed(() => (open.value ? { left: at(BIG * (1 + COLON)), top: BIG_TOP, scale: BIG } : { left: at(-1), top: "1.125rem", scale: 1 }));
const dateAt = computed(() => ({ left: at(BIG * (3 + COLON) + 0.8) }));
</script>
