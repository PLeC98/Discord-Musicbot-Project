<template>
  <!-- 반복 전환 효과: 효과 선택(목록) · 길이(버튼 그룹, 없음이면 꺼짐) 한 줄. 로그인 배경 카드의 옵션 영역과 편집 창이 같이 쓴다 -->
  <div class="flex flex-col gap-2 text-sm">
    <span>{{ C.seam }}</span>
    <div class="flex items-center gap-2">
      <SingleSelect class="flex-1 min-w-0" :model-value="seam.kind" :options="SEAM_OPTIONS" @update:model-value="pickKind" />
      <!-- 이어 붙은 버튼 그룹(M3E connected button group, 계정 메뉴의 밝기와 같은 형태). 선택한 버튼은 모서리가 둥글게 바뀐다. 없음이면 꺼진다 -->
      <div class="flex shrink-0 gap-0.5" role="group" :aria-label="C.seamLength" :class="seam.kind === 'cut' && 'opacity-38'">
        <button
          v-for="(sec, i) in SEAM_SECONDS"
          :key="sec"
          type="button"
          class="state-layer h-10 px-3 flex items-center justify-center text-label font-semibold nums cursor-pointer disabled:cursor-default transition-[border-radius,background-color,color] spring-fast"
          :class="[seam.seconds === sec && seam.kind !== 'cut' ? 'bg-secondary text-on-secondary rounded-xl' : 'bg-surface-highest text-on-surface-variant ' + (i === 0 ? 'rounded-l-xl rounded-r-sm active:rounded-r-xs' : i === SEAM_SECONDS.length - 1 ? 'rounded-r-xl rounded-l-sm active:rounded-l-xs' : 'rounded-sm active:rounded-xs')]"
          :aria-pressed="seam.seconds === sec"
          :disabled="seam.kind === 'cut'"
          @click="seam = { ...seam, seconds: sec }"
        >
          {{ C.seamSeconds(sec) }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SingleSelect from "./SingleSelect.vue";
import { SEAM_KINDS, SEAM_SECONDS, type LoginBackgroundOptions, type SeamKind } from "../../../src/dashboard/contract/login-background.ts";
import { text } from "../text/index.ts";
const C = text.loginBackground.card;

const seam = defineModel<LoginBackgroundOptions["seam"]>({ required: true });
const SEAM_OPTIONS = SEAM_KINDS.map((kind) => ({ value: kind, label: C.seamKinds[kind] }));

function pickKind(value: string | number) {
  const kind = SEAM_KINDS.find((one): one is SeamKind => one === value);
  if (kind) seam.value = { ...seam.value, kind };
}
</script>
