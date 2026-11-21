<template>
  <!-- bgutil 설치에 없는 것의 안내(업데이트 탭의 bgutil 카드, 다시 시작 창). 프로그램은 설치 주소를 함께, 폴더는 권한 안내 -->
  <span class="block">{{ T.missingTitle }}</span>
  <span v-for="need in needs" :key="need" class="block"
    >{{ T.needs[need]
    }}<template v-if="DOWNLOAD[need]"
      >: <a :href="DOWNLOAD[need]" target="_blank" rel="noopener" class="underline underline-offset-2 break-all">{{ DOWNLOAD[need] }}</a></template
    ></span
  >
  <span class="block">{{ T.missingAfter }}</span>
</template>

<script setup lang="ts">
import type { BgutilNeed } from "../../../src/sources/bgutil/status-types.ts";
import { text } from "../text/index.ts";
const T = text.bgutil;

// 프로그램의 설치 주소
const DOWNLOAD: Partial<Record<BgutilNeed, string>> = {
  git: "https://git-scm.com/downloads",
  npm: "https://docs.npmjs.com/downloading-and-installing-node-js-and-npm",
};

defineProps<{ needs: BgutilNeed[] }>();
</script>
