<template>
  <!-- 글에서 검색어와 일치한 부분을 칠한다. 맞추는 규칙은 검색과 같다(rules/ko-search 의 koRanges: 조합 중인 글자, 초성도). 검색어가 비었거나 일치한 곳이 없으면 글 그대로.
       span 하나로 내보낸다: flex 줄 안에서 조각마다 간격이 끼지 않게 -->
  <span
    ><template v-for="(part, i) in parts" :key="i"
      ><mark v-if="part.hit" class="rounded-xs bg-tertiary-container text-on-tertiary-container">{{ part.text }}</mark
      ><template v-else>{{ part.text }}</template></template
    ></span
  >
</template>

<script setup lang="ts">
import { computed } from "vue";
import { koRanges } from "../../../src/rules/ko-search.ts";

const props = defineProps<{ text: string; query: string }>();

const parts = computed(() => {
  const out: Array<{ text: string; hit: boolean }> = [];
  let at = 0;
  for (const [from, to] of koRanges(props.text, props.query)) {
    if (from > at) out.push({ text: props.text.slice(at, from), hit: false });
    out.push({ text: props.text.slice(from, to), hit: true });
    at = to;
  }
  if (at < props.text.length || !out.length) out.push({ text: props.text.slice(at), hit: false });
  return out;
});
</script>
