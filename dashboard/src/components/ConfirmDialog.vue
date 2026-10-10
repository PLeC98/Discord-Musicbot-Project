<template>
  <!-- 되돌리기 어려운 일을 하기 전에 묻는 M3 대화상자: 가운데 아이콘 · 제목 · 설명, 오른쪽 아래 취소 · 하기. 바깥을 누르면 취소 -->
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="open" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="open = false">
        <div role="alertdialog" aria-modal="true" class="rounded-2xl bg-surface-container-high p-6 w-full max-w-sm animate-[art-in_350ms_var(--ease-spring-fast)]">
          <span class="size-12 rounded-full flex items-center justify-center mx-auto mb-4" :class="tone === 'danger' ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container'"><Icon :name="icon" :size="24" /></span>
          <h3 class="text-xl font-round font-semibold text-center mb-4">{{ title }}</h3>
          <p class="text-sm text-on-surface-variant text-center mb-6 whitespace-pre-line">{{ body }}</p>
          <div class="flex gap-2 justify-end">
            <BaseButton variant="ghost" :disabled="busy" @click="open = false">취소</BaseButton>
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

/** tone: danger(되돌릴 수 없는 일, 오류 색) · primary(크게 퍼지는 일). busy: 하는 중이라 버튼을 막는다 */
withDefaults(defineProps<{ icon: string; title: string; body: string; confirmLabel: string; tone?: "danger" | "primary"; busy?: boolean }>(), { tone: "danger", busy: false });
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ confirm: [] }>();
</script>
