<template>
  <!-- 자동재생 전역 값(genres.yaml 의 defaults). 장르 편집기 목록의 "전역 설정"을 고르면 상세 자리에 그린다 -->
  <div class="flex flex-col gap-3">
    <p class="text-sm text-on-surface-variant">{{ T.desc }}</p>
    <div class="grid grid-cols-1 @lg/card:grid-cols-3 gap-3">
      <label class="block">
        <span :class="[FIELD_LABEL, 'flex! items-center gap-1']">{{ T.prefetch }}<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="T.prefetchTip" /></span>
        <NumberInput v-model="defaults.prefetchCount" :placeholder="T.ifEmpty(GENRE_DEFAULTS.prefetchCount)" :class="[FIELD, 'w-full']" />
      </label>
      <label class="block">
        <span :class="FIELD_LABEL">{{ text.genres.minDuration }}</span>
        <NumberInput v-model="defaults.minDurationSec" :placeholder="T.ifEmpty(GENRE_DEFAULTS.minDurationSec)" :class="[FIELD, 'w-full']" />
      </label>
      <label class="block">
        <span :class="[FIELD_LABEL, 'flex! items-center gap-1']">{{ text.genres.maxDuration }}<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="T.maxTip" /></span>
        <NumberInput v-model="defaults.maxDurationSec" :placeholder="T.noLimit" :class="[FIELD, 'w-full']" />
      </label>
    </div>
    <div>
      <!-- 차단어는 키워드 출처(유튜브 검색 결과)에만 건다. 다른 출처는 곡 이름이 확실해 오탐만 낸다 -->
      <span :class="[FIELD_LABEL, 'flex! items-center gap-1']">{{ T.blocked }}<Icon name="info" :size="16" class="cursor-help" v-tooltip="T.blockedTip" /></span>
      <ChipInput v-model="defaults.blockedKeywords" lowercase :placeholder="T.blockedPlaceholder" />
    </div>
  </div>
</template>

<script setup lang="ts">
import ChipInput from "./ChipInput.vue";
import Icon from "./BaseIcon.vue";
import NumberInput from "./NumberInput.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { GENRE_DEFAULTS } from "../../../src/config/schema/genres.ts";
import { text } from "../text/index.ts";
const T = text.genres.defaults;

/** 전역 값. 칸을 바로 고친다(부모의 draft.defaults) */
type Defaults = { prefetchCount: number | null; minDurationSec: number | null; maxDurationSec: number | null; blockedKeywords: string[] };
const defaults = defineModel<Defaults>({ required: true });
</script>
