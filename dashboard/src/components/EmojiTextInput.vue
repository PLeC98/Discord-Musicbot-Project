<!--
  글 입력란. 오른쪽 안에 이모지 버튼(디스코드 입력창처럼)이 있고, 선택한 이모지는 커서 위치에 끼워 넣는다.
  상태 문구와 음성 상태 문구가 함께 쓴다.
-->
<template>
  <div class="relative min-w-0">
    <input ref="box" :value="model" :placeholder="placeholder" :maxlength="maxlength" :spellcheck="spellcheck" :aria-label="label" :class="[FIELD, 'w-full pr-11']" @input="model = valueOf($event)" @blur="remember" @click="remember" @keyup="remember" @select="remember" />
    <EmojiPicker class="absolute! right-1 top-1" @pick="insert">
      <template #default="{ toggle }">
        <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="text.fields.emojiInsert" v-tooltip="text.fields.emojiInsert" @click="toggle"><EmojiGlyph char="🙂" :size="20" /></button>
      </template>
    </EmojiPicker>
  </div>
</template>

<script setup lang="ts">
import { nextTick, useTemplateRef } from "vue";
import EmojiGlyph from "./EmojiGlyph.vue";
import EmojiPicker from "./EmojiPicker.vue";
import { FIELD } from "../utils/field.ts";
import { ICON_BTN } from "../utils/icon-button.ts";
import { valueOf } from "../utils/dom.ts";
import { insertAt, caretOf, type Caret } from "../utils/caret.ts";
import { text } from "../text/index.ts";

/** maxlength: 글자 수 상한(넘기게 되는 이모지는 넣지 않는다), label: 감싼 label 이 없을 때의 이름 */
const props = withDefaults(defineProps<{ placeholder?: string; maxlength?: number; spellcheck?: boolean; label?: string }>(), { spellcheck: true });
const model = defineModel<string>({ default: "" });

const box = useTemplateRef<HTMLInputElement>("box");
// 이모지 선택을 열면 입력란에서 포커스가 떠나므로, 떠나기 전 커서 위치를 적어 둔다.
// 한 번도 만지지 않은 입력란은 적어 둔 것이 없어, 넣을 때 글 끝으로 간다.
let caret: Caret | null = null;
const remember = () => (caret = caretOf(box.value));

function insert(char: string) {
  const result = insertAt(model.value, char, caret, props.maxlength);
  if (!result) return;
  model.value = result.text;

  caret = { start: result.caret, end: result.caret };
  void nextTick(() => {
    box.value?.focus();
    box.value?.setSelectionRange(result.caret, result.caret);
  });
}
</script>
