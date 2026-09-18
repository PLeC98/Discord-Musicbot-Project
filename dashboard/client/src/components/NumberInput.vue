<!--
  숫자 칸. type="number" 를 쓰지 않는다 — 칸 위에서 휠을 굴리면 값이 바뀌기 때문이다.
  평범한 입력칸으로 두고 숫자만 받는다.
-->
<template>
  <input inputmode="numeric" :value="modelValue ?? ''" @input="onInput" />
</template>

<script setup>
defineProps({ modelValue: { type: Number, default: null } });
const emit = defineEmits(["update:modelValue"]);

function onInput(event) {
  const only = event.target.value.replace(/[^0-9]/g, "");
  // 값이 안 바뀌면(1 뒤에 "a" 를 친 경우) Vue 가 다시 그리지 않는다 — 지운 글자를 직접 치운다
  if (event.target.value !== only) event.target.value = only;
  emit("update:modelValue", only === "" ? null : Number(only));
}
</script>
