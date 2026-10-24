<template>
  <!-- 로그 한 줄(실시간 로그 · 로그 파일 보기). 넓으면 한 줄(시각 · 레벨 · 카테고리 · 태그 · 글), 좁으면(로그 영역 42rem 아래) 글을 아랫줄로. 글은 낱말 단위로 끊는다.
       찾기가 맞은 부분은 칠한다(MatchText) -->
  <div class="flex flex-col @2xl/log:flex-row @2xl/log:items-baseline gap-x-3 py-0.5 text-xs leading-5">
    <span class="flex items-baseline gap-3 shrink-0">
      <span class="font-mono nums text-on-surface-variant">{{ time }}</span>
      <span class="w-[5ch] font-mono font-semibold" :class="LEVEL_TONE[entry.level]">{{ entry.level.toUpperCase() }}</span>
      <span v-if="entry.category || entry.sub" class="flex items-center gap-1 text-on-surface-variant"><span class="size-2 rounded-full" :style="{ backgroundColor: catColor(entry.category || entry.sub || '') }"></span><MatchText :text="[entry.category, entry.sub].filter(Boolean).join('/')" :query="query" /></span>
      <span v-for="t in entry.tags" :key="t" class="text-on-surface-variant">#<MatchText :text="t" :query="query" /></span>
    </span>
    <span class="min-w-0 wrap-break-word whitespace-pre-wrap" :class="TEXT_TONE[entry.level]"><MatchText :text="entry.text" :query="query" /></span>
  </div>
</template>

<script setup lang="ts">
import MatchText from "./MatchText.vue";
import { LEVEL_TONE, TEXT_TONE, catColor } from "../utils/log-style.ts";
import type { WireFields } from "../../../src/infra/log/levels.ts";

/** time: 적을 시각(화면마다 형식이 다르다). query: 칠할 찾기 */
defineProps<{ entry: WireFields; time: string; query: string }>();
</script>
