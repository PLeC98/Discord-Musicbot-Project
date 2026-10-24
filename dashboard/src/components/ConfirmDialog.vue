<template>
  <!-- 되돌리기 어려운 일을 하기 전에 묻는 M3 대화상자: 가운데 아이콘 · 제목 · 설명, 오른쪽 아래 취소 · 하기. 바깥을 누르면 취소.
       설명은 body 글, 문단 · 굵은 글이 섞이면 기본 슬롯(같은 글자 모양 안에 그린다) -->
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="open" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="actions && (open = false)">
        <div role="alertdialog" aria-modal="true" class="rounded-2xl bg-surface-container-high p-6 w-full max-w-sm animate-[art-in_350ms_var(--ease-spring-fast)]">
          <span class="size-12 rounded-full flex items-center justify-center mx-auto mb-4" :class="tone === 'danger' ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container'"><Icon :name="icon" :size="24" /></span>
          <h3 class="text-xl font-round font-semibold text-center mb-4">{{ title }}</h3>
          <p class="text-sm text-on-surface-variant text-center whitespace-pre-line" :class="actions && 'mb-6'">
            <slot>{{ body }}</slot>
          </p>
          <div v-if="actions" class="flex gap-2 justify-end">
            <BaseButton variant="ghost" :disabled="busy" @click="open = false">{{ text.common.cancel }}</BaseButton>
            <BaseButton :variant="tone" :disabled="busy" @click="emit('confirm')">{{ confirmLabel }}</BaseButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import type { IconName } from "../icons.ts";
import { text } from "../text/index.ts";
import { useCloseLayer } from "../composables/close-layer.ts";

/** tone: danger(되돌릴 수 없는 일, 오류 색) · primary(크게 퍼지는 일). busy: 하는 중이라 버튼을 막는다. actions: false 면 버튼 없이 알리기만(바깥을 눌러도 닫지 않는다) */
const props = withDefaults(defineProps<{ icon: IconName; title: string; body?: string; confirmLabel: string; tone?: "danger" | "primary"; busy?: boolean; actions?: boolean }>(), { body: "", tone: "danger", busy: false, actions: true });
const open = defineModel<boolean>({ required: true });
// Esc · 기기의 뒤로는 취소와 같다. 버튼이 없거나(기다리는 중) 요청 중이면 닫지 않는다
useCloseLayer(open, () => {
  if (props.actions && !props.busy) open.value = false;
});
const emit = defineEmits<{ confirm: [] }>();
</script>
