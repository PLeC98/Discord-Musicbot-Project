<!--
  저장/되돌리기. 화면 오른쪽 아래에 떠 있다.

  설정 화면은 세로로 길어서, 카드 맨 밑에 버튼을 두면 고친 자리에서 한참 스크롤해야 저장할 수 있다.
  아래 재생바가 떠 있을 때를 고려해 --player 만큼 띄운다(재생바가 없으면 0이라 저절로 내려앉는다).

  고친 것이 없으면 나타나지 않는다. 누를 일이 없는 버튼이 늘 떠 있으면 화면만 가린다.
-->
<template>
  <Transition name="dock">
    <div v-if="dirty" class="fixed right-5 z-120 flex items-center gap-2" :style="{ bottom: 'calc(var(--player, 0px) + 1.25rem)' }">
      <span v-if="hint" class="hidden sm:block bg-[rgba(12,16,36,0.92)] backdrop-blur-sm border border-white/12 rounded-full px-3.5 py-1.5 text-[0.78rem] text-warning shadow-card">{{ hint }}</span>

      <button :class="[circle, ghost]" :disabled="saving" v-tooltip="'되돌리기'" @click="$emit('revert')"><Icon name="undo" :size="18" /></button>

      <button :class="[circle, primary]" :disabled="saving || blocked" v-tooltip="blocked ? '고칠 것이 남아 있습니다' : '저장'" @click="$emit('save')">
        <Icon :name="saving ? 'spinner' : 'check'" :size="20" :class="saving ? 'animate-spin' : ''" />
      </button>
    </div>
  </Transition>
</template>

<script setup>
import Icon from "./BaseIcon.vue";

defineProps({
  dirty: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  // 저장을 막아야 할 때(검사에 걸린 값이 있음). 버튼은 두되 누르지 못하게 한다
  blocked: { type: Boolean, default: false },
  hint: { type: String, default: "저장되지 않은 변경이 있습니다" },
});
defineEmits(["save", "revert"]);

const circle = "size-12 rounded-full flex items-center justify-center cursor-pointer shadow-card transition-[background-color,color,opacity,transform] duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:not-disabled:scale-95";
const ghost = "bg-[rgba(12,16,36,0.92)] backdrop-blur-sm border border-white/12 text-fg-soft hover:not-disabled:bg-white/10";
const primary = "bg-accent text-white hover:not-disabled:brightness-110";
</script>

<style scoped>
.dock-enter-active,
.dock-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.dock-enter-from,
.dock-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}
</style>
