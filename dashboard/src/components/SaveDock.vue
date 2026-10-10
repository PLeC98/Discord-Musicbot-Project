<!--
  저장/되돌리기(운영자 패널 설정 편집기). 고친 것이 생기면 나타난다.

  태블릿 · PC: 위 막대 오른쪽(알림 옆)에 "저장하지 않은 변경 · 되돌리기 · 저장". 위 막대는 틀이라 내용을 가리지 않는다.
    저장을 누르면 서버 설정의 자동 저장과 같은 표시(SaveIndicator: 플로피가 돌다 동그라미 체크)로 바뀌었다 사라진다.
  휴대폰: 위 막대 오른쪽에 자리가 없어 디스코드처럼 아래(미니 재생 바 위)에 막대로 띄우고, 떠 있는 동안 그 높이만큼 페이지 아래를 비운다(끝 내용까지 막대 위로 올려 볼 수 있게).
  blocked(검사에 걸린 값): 저장을 막고 "고칠 것이 남아 있어요".

  운영자 패널은 탭 편집기가 함께 떠 있다(v-show). 이 편집기의 탭(tab)이 지금 탭일 때만 나타난다(주소 ?tab=)
-->
<template>
  <!-- 휴대폰: 막대 높이만큼 아래를 비운다 -->
  <div v-if="phone && dirty && shown" class="h-20" aria-hidden="true"></div>

  <Teleport to="#topbar-end" :disabled="phone" defer>
    <template v-if="!phone && shown">
      <Transition enter-from-class="opacity-0 translate-x-2" leave-to-class="opacity-0 translate-x-2" enter-active-class="transition-[opacity,translate] duration-200 ease-out" leave-active-class="transition-[opacity,translate] duration-150 ease-in">
        <div v-if="dirty && !saving" class="flex items-center gap-1.5">
          <span class="hidden lg:flex items-center gap-1.5 pr-1 text-xs font-medium" :class="blocked ? 'text-error' : 'text-tertiary'"><span class="size-1.5 rounded-full bg-current"></span>{{ blocked ? "고칠 것이 남아 있어요" : "저장하지 않은 변경" }}</span>
          <button type="button" :class="[pill, 'text-on-surface']" @click="$emit('revert')"><Icon name="undo" :size="16" />되돌리기</button>
          <button type="button" :class="[pill, 'bg-primary text-on-primary']" :disabled="blocked" v-tooltip="blocked ? '고칠 것이 남아 있어요' : null" @click="$emit('save')"><Icon name="save" :size="16" />저장</button>
        </div>
      </Transition>
      <SaveIndicator :state="indicator" />
    </template>
  </Teleport>

  <!-- 휴대폰: 미니 재생 바 위에 뜨는 막대 -->
  <Transition enter-from-class="opacity-0 translate-y-4" leave-to-class="opacity-0 translate-y-4" enter-active-class="transition-[opacity,translate] duration-300 ease-[cubic-bezier(0.2,0,0,1)]" leave-active-class="transition-[opacity,translate] duration-200 ease-in">
    <div v-if="phone && shown && (dirty || indicator !== 'idle')" class="fixed inset-x-3 z-120 h-14 pl-4 pr-2 rounded-full pane-float flex items-center gap-2" :style="{ bottom: 'calc(var(--player, 0px) + 0.75rem)' }">
      <span class="min-w-0 flex-1 truncate text-sm font-medium" :class="blocked ? 'text-error' : 'text-on-surface'">{{ indicator === "done" ? "저장했어요" : blocked ? "고칠 것이 남아 있어요" : "저장하지 않은 변경이 있어요" }}</span>
      <template v-if="dirty && !saving">
        <button type="button" :class="[pillPhone, 'text-on-surface']" @click="$emit('revert')">되돌리기</button>
        <button type="button" :class="[pillPhone, 'bg-primary text-on-primary']" :disabled="blocked" @click="$emit('save')">저장</button>
      </template>
      <SaveIndicator v-else :state="indicator" />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useMediaQuery } from "@vueuse/core";
import Icon from "./BaseIcon.vue";
import SaveIndicator, { type SaveState } from "./SaveIndicator.vue";
import { PHONE_QUERY } from "../utils/breakpoints.ts";

const props = withDefaults(
  defineProps<{
    dirty?: boolean;
    saving?: boolean;
    /** 저장을 막아야 할 때(검사에 걸린 값이 있음). 버튼은 두되 누르지 못하게 한다 */
    blocked?: boolean;
    /** 이 편집기의 운영자 패널 탭(주소 ?tab=) */
    tab: string;
  }>(),
  { dirty: false, saving: false, blocked: false },
);
defineEmits<{ save: []; revert: [] }>();

const phone = useMediaQuery(PHONE_QUERY);
// 이 편집기(탭)가 지금 보이는지
const route = useRoute();
const shown = computed(() => route.query.tab === props.tab);

// 저장 표시: 저장 중 → 끝나서 고친 것이 없으면 체크 → 잠시 뒤 사라짐
const indicator = ref<SaveState>("idle");
let timer = 0;
let began = 0;
// 너무 빨리 끝나도 링이 도는 모습을 0.6초는 보인다(서버 설정의 자동 저장과 같다)
watch(
  () => props.saving,
  (now, before) => {
    clearTimeout(timer);
    if (now) {
      began = Date.now();
      indicator.value = "saving";
    } else if (before) {
      const result: SaveState = props.dirty ? "error" : "done";
      timer = window.setTimeout(
        () => {
          indicator.value = result;
          timer = window.setTimeout(() => (indicator.value = "idle"), 1600);
        },
        Math.max(0, 600 - (Date.now() - began)),
      );
    }
  },
);

const pill = "tap state-layer h-7 pl-2 pr-3 shrink-0 rounded-full flex items-center gap-1 text-sm font-semibold cursor-pointer disabled:opacity-38 disabled:cursor-not-allowed";
const pillPhone = "tap state-layer h-10 px-4 shrink-0 rounded-full flex items-center text-sm font-semibold cursor-pointer disabled:opacity-38 disabled:cursor-not-allowed";
</script>
