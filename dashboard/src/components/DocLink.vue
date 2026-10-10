<template>
  <!-- 저장소 설명서로 가는 작은 단추(카드 머리 오른쪽). 저장소 주소를 모르면 그리지 않는다 -->
  <BaseButton v-if="url" variant="secondary" size="sm" :href="url" target="_blank" rel="noopener" v-tooltip="text.common.docsTip"><Icon name="open_in_new" :size="16" />{{ text.common.docs }}</BaseButton>
</template>

<script setup lang="ts">
import { computed } from "vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import { docUrl } from "../composables/docs.ts";
import { text } from "../text/index.ts";

/** file: 저장소 안의 설명서(예: docs/favicon.md) */
const props = defineProps<{ file: string }>();
const url = computed(() => docUrl(props.file));
</script>
