<!--
  상태 문구 줄 목록 — 평소 문구와 기간·시간대 문구가 같은 모양이라 함께 쓴다.

  활동 종류는 대부분 건드릴 일이 없어 "기본"을 두면 파일에도 적히지 않는다.
  파일에서는 그런 줄이 `- 🎵 /play` 한 줄로 남는다.
-->
<template>
  <div>
    <div v-for="(message, i) in list" :key="message.key" class="flex items-center gap-2 mb-1.5">
      <div class="relative flex-1">
        <input :ref="(el) => (inputs[message.key] = el)" v-model="message.text" :placeholder="placeholder" :class="[inputCls, 'w-full pr-10!']" :maxlength="MAX_TEXT" @blur="remember(message)" @click="remember(message)" @keyup="remember(message)" @select="remember(message)" />
        <!-- 디스코드 입력창처럼 칸 오른쪽 끝에. 고른 이모지는 커서 자리에 끼워 넣는다. -->
        <EmojiPicker class="absolute! right-1.5 top-1/2 -translate-y-1/2" @pick="insert(message, $event)">
          <template #default="{ toggle }">
            <button type="button" :class="emojiBtn" v-tooltip="'이모지'" @click="toggle">
              <Twemoji char="🙂" :size="17" />
            </button>
          </template>
        </EmojiPicker>
      </div>

      <!-- appearance-none: 그냥 두면 Windows가 네이티브 컨트롤로 그리면서 밝은 배경을 써
           밝은 글자가 안 보인다. CSS로 그리게 하고 화살표는 따로 얹는다. -->
      <div class="relative shrink-0">
        <select v-model="message.type" :class="[inputCls, selectCls]" v-tooltip="'활동 종류'">
          <!-- option은 네이티브로 그려져 부모 색을 물려받지 않는다 — 색을 직접 준다 -->
          <option v-for="type in TYPES" :key="type.value" :value="type.value" class="bg-[#141833] text-[#e7e9f3]">{{ type.label }}</option>
        </select>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </div>

      <button :class="removeBtn" v-tooltip="'이 문구 삭제'" @click="remove(i, message)"><Icon name="trash" :size="15" /></button>
    </div>

    <button :class="addLine" @click="$emit('add')">
      <Icon name="add" :size="14" />
      <span>문구 추가</span>
    </button>
  </div>
</template>

<script setup>
import { nextTick, reactive } from "vue";
import Icon from "./BaseIcon.vue";
import Twemoji from "./TwemojiImage.vue";
import EmojiPicker from "./EmojiPicker.vue";
import { insertAt, caretOf } from "../utils/caret.js";

// 배열을 그대로 고친다 — 줄마다 갈아끼우면 입력 중에 초점이 튄다
const list = defineModel({ type: Array, required: true });
defineEmits(["add"]);

const MAX_TEXT = 128;
const placeholder = "🎵 /play";

const inputs = reactive({});
const carets = reactive({});

// 판을 열면 칸에서 초점이 떠나므로, 떠나기 전 커서 자리를 적어 둔다.
// 한 번도 만지지 않은 칸은 적어 둔 것이 없어, 넣을 때 글 끝으로 간다.
function remember(message) {
  carets[message.key] = caretOf(inputs[message.key]);
}

function insert(message, char) {
  const result = insertAt(message.text, char, carets[message.key], MAX_TEXT);
  if (!result) return;
  message.text = result.text;

  carets[message.key] = { start: result.caret, end: result.caret };
  nextTick(() => {
    const el = inputs[message.key];
    el?.focus();
    el?.setSelectionRange(result.caret, result.caret);
  });
}

function remove(i, message) {
  delete inputs[message.key];
  delete carets[message.key];
  list.value.splice(i, 1);
}

// "기본"은 파일에 type을 적지 않는다는 뜻이고, 결과는 "듣는 중"과 같다.
// 그래도 둘을 따로 두는 것은 손으로 `type: Listening`이라 적어 둔 파일을 그대로 돌려놓기 위해서다.
const TYPES = [
  { value: "", label: "기본" },
  { value: "Listening", label: "듣는 중" },
  { value: "Playing", label: "게임 중" },
  { value: "Watching", label: "시청 중" },
  { value: "Competing", label: "경쟁 중" },
  { value: "Custom", label: "말머리 없음" },
];

// color-scheme: 네이티브 목록이 밝게 뜨는 것을 막는다(option은 CSS로 못 꾸민다)
const inputCls = "bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2 text-[0.9rem] outline-none font-[inherit] [color-scheme:dark] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7";
const selectCls = "w-30 appearance-none cursor-pointer pl-3! pr-9!";
const emojiBtn = "size-7 rounded-lg flex items-center justify-center cursor-pointer opacity-55 transition-[opacity,background-color] duration-150 hover:opacity-100 hover:bg-white/10";
const removeBtn = "h-[38px] w-[38px] rounded-xl border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color,border-color] duration-150 hover:bg-danger/15 hover:text-danger hover:border-danger/30";
const addLine = "flex items-center gap-1.5 text-muted text-[0.82rem] px-2 py-1.5 rounded-lg cursor-pointer transition-colors duration-150 hover:text-fg-soft hover:bg-white/6";
</script>
