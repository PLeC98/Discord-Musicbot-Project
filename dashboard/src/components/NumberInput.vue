<!--
  숫자 칸. type="number" 를 쓰지 않는다. 칸 위에서 휠을 굴리면 값이 바뀌기 때문이다.
  평범한 입력칸으로 두고 숫자만 받는다. 소수·음수는 받을 칸에서만 켠다
  (온도 0.4 · top_p 0.9 · penalty -2 처럼 프로필이 그렇게 적어 둔 칸).
-->
<template>
  <input :inputmode="decimal ? 'decimal' : 'numeric'" :value="modelValue ?? ''" @input="onInput" />
</template>

<script setup>
const props = defineProps({
  modelValue: { type: Number, default: null },
  decimal: { type: Boolean, default: false },
  negative: { type: Boolean, default: false },
});
const emit = defineEmits(["update:modelValue"]);

function clean(text) {
  const sign = props.negative && text.startsWith("-") ? "-" : "";
  const body = text.slice(sign.length).replace(props.decimal ? /[^0-9.]/g : /[^0-9]/g, "");
  // 점은 하나만. 두 번째부터는 버린다
  const at = body.indexOf(".");
  const one = at < 0 ? body : body.slice(0, at + 1) + body.slice(at + 1).replace(/\./g, "");
  return sign + one;
}

function onInput(event) {
  const only = clean(event.target.value);
  // 값이 안 바뀌면(1 뒤에 "a" 를 친 경우) Vue 가 다시 그리지 않는다. 지운 글자를 직접 치운다
  if (event.target.value !== only) event.target.value = only;
  if (only === "") return emit("update:modelValue", null);
  // "0." 이나 "-" 는 아직 치는 중이다. 알리면 되돌아온 값이 점을 지워 더 못 친다
  if (only === "-" || only.endsWith(".")) return;
  emit("update:modelValue", Number(only));
}
</script>
