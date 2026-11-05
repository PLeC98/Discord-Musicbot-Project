<template>
  <!-- 대화상자의 넘김(style.css 의 dialog). 겉 하나를 감싸고, 판에는 dialog-panel 을 붙인다 -->
  <Transition name="dialog" :duration="DIALOG_MS">
    <slot />
  </Transition>
</template>

<script setup lang="ts">
import { DIALOG_MS } from "../utils/motion.ts";
</script>
