<template>
  <!-- 자리는 App.vue 가 잡는다(화면 위 가운데, 라우터 화면 밖이라 페이지를 옮겨도 남는다) -->
  <div class="contents" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" role="status" class="pointer-events-auto flex gap-2.5 items-start rounded-xl px-3.5 py-2.5 text-[0.85rem] bg-[rgba(12,16,36,0.92)] backdrop-blur-xl border shadow-[0_8px_28px_rgba(0,0,0,0.5)]" :class="t.severity === 'warning' ? 'border-warning/35' : 'border-danger/40'">
      <Icon :name="t.severity === 'warning' ? 'warning' : 'error'" :size="16" class="shrink-0 mt-0.5" :class="t.severity === 'warning' ? 'text-warning' : 'text-danger'" />
      <div class="flex-1 min-w-0 whitespace-pre-line">
        <div class="font-semibold text-fg">{{ t.title }}</div>
        <div v-if="t.body" class="text-fg-soft">{{ t.body }}</div>
        <div v-if="t.detail" class="text-muted">{{ t.detail }}</div>
        <a v-if="t.reportUrl" :href="t.reportUrl" target="_blank" rel="noopener" class="text-accent text-[0.78rem] hover:underline">봇 개발자에게 보고하기</a>
        <div v-if="t.codeLine" class="text-muted text-[0.75rem]">{{ t.codeLine }}</div>
      </div>
      <button class="shrink-0 text-muted hover:text-fg cursor-pointer" aria-label="닫기" @click="dismiss(t.id)"><Icon name="close" :size="14" /></button>
    </div>
  </div>
</template>

<script setup>
import Icon from "./BaseIcon.vue";
import { toasts, dismiss } from "../composables/toasts.ts";
</script>
