<!--
  글 입력란. 오른쪽 안에 이모지 버튼(디스코드 입력창처럼)이 있고, 선택한 이모지는 커서 위치에 끼워 넣는다.
  상태 문구와 음성 상태 문구가 함께 쓴다.
  device-emoji: 디스코드가 그 글의 이모지를 Twemoji 로 바꾸지 않고 기기 글꼴로 그리는 칸(봇 상태 문구). 입력란도 같게 기기 글꼴로 보인다.
  app-emoji: 봇의 앱 이모지도 넣는 칸(음성 상태 문구). 저장 값은 토큰(<:이름:id>), 입력란에는 이모지마다 정해진 문자로 보여 진짜 글자처럼
  선택, 지우기, 한글 입력이 된다(composables/app-emojis). 붙여넣은 토큰은 문자로, 복사하거나 잘라낸 문자는 토큰으로 바꾼다.
-->
<template>
  <div class="relative min-w-0">
    <input ref="box" :value="shown" :placeholder="placeholder" :maxlength="maxlength" :spellcheck="spellcheck" :aria-label="label" :class="[FIELD, 'w-full pr-11', deviceEmoji && 'font-plain!']" @input="onInput" @paste="onPaste" @copy="onCopy" @cut="onCopy" @blur="remember" @click="remember" @keyup="remember" @select="remember" />
    <EmojiPicker class="absolute! right-1 top-1" :app-emoji="appEmoji" @pick="insert">
      <template #default="{ toggle }">
        <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="text.fields.emojiInsert" v-tooltip="text.fields.emojiInsert" @click="toggle"><EmojiGlyph char="🙂" :size="20" /></button>
      </template>
    </EmojiPicker>
    <p v-if="appEmoji && hasMissing(model)" class="mt-1 text-xs text-error">{{ text.fields.appEmojiMissing }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, useTemplateRef } from "vue";
import EmojiGlyph from "./EmojiGlyph.vue";
import EmojiPicker from "./EmojiPicker.vue";
import { FIELD } from "../utils/field.ts";
import { ICON_BTN } from "../utils/icon-button.ts";
import { valueOf } from "../utils/dom.ts";
import { insertAt, caretOf, type Caret } from "../utils/caret.ts";
import { fromChars, hasAppEmojiChar, hasMissing, loadAppEmojis, toChars } from "../composables/app-emojis.ts";
import { text } from "../text/index.ts";

/** maxlength: 글자 수 상한(넘기게 되는 이모지는 넣지 않는다), label: 감싼 label 이 없을 때의 이름, deviceEmoji, appEmoji: 머리 주석 */
const props = withDefaults(defineProps<{ placeholder?: string; maxlength?: number; spellcheck?: boolean; label?: string; deviceEmoji?: boolean; appEmoji?: boolean }>(), { spellcheck: true });
const model = defineModel<string>({ default: "" });

onMounted(() => {
  if (props.appEmoji) void loadAppEmojis();
});

/** 입력란에 보이는 글(앱 이모지 칸이면 토큰을 문자로) */
const shown = computed(() => (props.appEmoji ? toChars(model.value) : model.value));
const store = (value: string) => (model.value = props.appEmoji ? fromChars(value) : value);
const onInput = (e: Event) => store(valueOf(e));

const box = useTemplateRef<HTMLInputElement>("box");
// 이모지 선택을 열면 입력란에서 포커스가 떠나므로, 떠나기 전 커서 위치를 적어 둔다.
// 한 번도 만지지 않은 입력란은 적어 둔 것이 없어, 넣을 때 글 끝으로 간다.
let caret: Caret | null = null;
const remember = () => (caret = caretOf(box.value));

function insert(picked: string) {
  // 위치는 보이는 글 기준이다. 앱 이모지(토큰)는 그 문자로 넣는다
  const piece = props.appEmoji ? toChars(picked) : picked;
  const result = insertAt(shown.value, piece, caret, props.maxlength);
  if (!result) return;
  store(result.text);

  caret = { start: result.caret, end: result.caret };
  void nextTick(() => {
    box.value?.focus();
    box.value?.setSelectionRange(result.caret, result.caret);
  });
}

// 붙여넣은 글의 토큰을 문자로. insertText 로 넣어 되돌리기에 남는다
function onPaste(e: ClipboardEvent) {
  if (!props.appEmoji) return;
  const pasted = e.clipboardData?.getData("text/plain") ?? "";
  const converted = toChars(pasted);
  if (converted === pasted) return;
  e.preventDefault();
  document.execCommand("insertText", false, converted);
}

// 복사, 잘라내기는 앱 이모지 문자를 토큰으로(다른 곳에 붙여도 깨지지 않게). 잘라내기는 선택한 것을 지운다
function onCopy(e: ClipboardEvent) {
  const el = box.value;
  if (!props.appEmoji || !el || !e.clipboardData) return;
  const picked = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  if (!hasAppEmojiChar(picked)) return;
  e.clipboardData.setData("text/plain", fromChars(picked));
  e.preventDefault();
  if (e.type === "cut") document.execCommand("delete");
}
</script>
