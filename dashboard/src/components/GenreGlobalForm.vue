<template>
  <!-- 자동재생 전역 값(genres.yaml 의 defaults). 장르 편집기 목록의 "전역 설정"을 고르면 상세 자리에 그린다 -->
  <div class="flex flex-col gap-3">
    <p class="text-sm text-on-surface-variant">곡 수 설정 외에는 장르별로 오버라이드가 가능해요.</p>
    <div class="grid grid-cols-1 @lg/card:grid-cols-3 gap-3">
      <label class="block">
        <span :class="[FIELD_LABEL, 'flex! items-center gap-1']">대기열에 미리 넣을 곡 수<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="'전역 설정 전용\n설정한 만큼 자동재생 곡을 준비하여 미리 대기열에 넣어요.'" /></span>
        <NumberInput v-model="defaults.prefetchCount" :placeholder="`비우면 ${GENRE_DEFAULTS.prefetchCount}`" :class="[FIELD, 'w-full']" />
      </label>
      <label class="block">
        <span :class="FIELD_LABEL">최소 길이(초)</span>
        <NumberInput v-model="defaults.minDurationSec" :placeholder="`비우면 ${GENRE_DEFAULTS.minDurationSec}`" :class="[FIELD, 'w-full']" />
      </label>
      <label class="block">
        <span :class="[FIELD_LABEL, 'flex! items-center gap-1']">최대 길이(초)<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="'비우면 제한 없음'" /></span>
        <NumberInput v-model="defaults.maxDurationSec" placeholder="제한 없음" :class="[FIELD, 'w-full']" />
      </label>
    </div>
    <div>
      <!-- 차단어는 키워드 출처(유튜브 검색 결과)에만 건다. 다른 출처는 곡 이름이 확실해 오탐만 낸다 -->
      <span :class="[FIELD_LABEL, 'flex! items-center gap-1']">키워드 검색 차단어<Icon name="info" :size="16" class="cursor-help" v-tooltip="'키워드에만 적용되고, 유튜브에서 찾아낸 곡 제목에 키워드가 있으면 그 곡을 제외해요.\n(대소문자 무관, 영문은 단어 단위 · 한글 · 일본어는 포함 여부로 매칭)'" /></span>
      <ChipInput v-model="defaults.blockedKeywords" lowercase placeholder="차단할 말을 적고 Enter" />
    </div>
  </div>
</template>

<script setup lang="ts">
import ChipInput from "./ChipInput.vue";
import Icon from "./BaseIcon.vue";
import NumberInput from "./NumberInput.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { GENRE_DEFAULTS } from "../../../src/config/schema/genres.ts";

/** 전역 값. 칸을 바로 고친다(부모의 draft.defaults) */
type Defaults = { prefetchCount: number | null; minDurationSec: number | null; maxDurationSec: number | null; blockedKeywords: string[] };
const defaults = defineModel<Defaults>({ required: true });
</script>
