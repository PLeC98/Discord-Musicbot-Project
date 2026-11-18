<template>
  <!-- bgutil 설치에 없는 것의 안내(업데이트 탭의 bgutil 카드, 다시 시작 창). 프로그램은 설치 주소를 함께, 폴더는 권한 안내 -->
  <span class="block">{{ T.missingTitle }}</span>
  <span v-for="need in needs" :key="need" class="block"
    >{{ T.needs[need].label
    }}<template v-if="T.needs[need].url"
      >: <a :href="T.needs[need].url" target="_blank" rel="noopener" class="underline underline-offset-2 break-all">{{ T.needs[need].url }}</a></template
    ></span
  >
  <span class="block">{{ T.missingAfter }}</span>
</template>

<script setup lang="ts">
import type { BgutilNeed } from "../../../src/sources/bgutil/status-types.ts";
import { text } from "../text/index.ts";
const T = text.bgutil;

defineProps<{ needs: BgutilNeed[] }>();
</script>
