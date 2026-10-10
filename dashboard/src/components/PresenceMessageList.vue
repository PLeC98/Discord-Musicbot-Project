<!--
  상태 문구 줄 목록. 기본 문구와 기간·시간대 문구가 같은 모양이라 함께 쓴다.

  활동 종류는 대부분 건드릴 일이 없어 "기본"을 두면 파일에도 적히지 않는다.
  파일에서는 그런 줄이 `- 🎵 /play` 한 줄로 남는다.
-->
<template>
  <!-- 줄: 문구 칸(오른쪽 안에 이모지, 디스코드 입력창처럼) · 활동 종류 · 지우기. 아래에 문구 추가 -->
  <div class="flex flex-col gap-2">
    <div v-for="(message, i) in list" :key="message.key" class="flex items-center gap-2">
      <div class="relative flex-1 min-w-0">
        <input :ref="(el) => keep(message.key, el)" :value="message.text" :placeholder="placeholder" :class="[FIELD, 'w-full pr-11']" :maxlength="MAX_TEXT" @input="message.text = valueOf($event)" @blur="remember(message)" @click="remember(message)" @keyup="remember(message)" @select="remember(message)" />
        <!-- 고른 이모지는 커서 자리에 끼워 넣는다 -->
        <EmojiPicker class="absolute! right-1 top-1" @pick="insert(message, $event)">
          <template #default="{ toggle }">
            <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="T.insertEmoji" v-tooltip="T.insertEmoji" @click="toggle"><Twemoji char="🙂" :size="20" /></button>
          </template>
        </EmojiPicker>
      </div>

      <SingleSelect :model-value="message.type" class="w-32 shrink-0" :options="TYPES" :empty-label="T.activityTypes['']" v-tooltip="T.activity" @update:model-value="message.type = $event as ActivityType" />

      <button type="button" :class="[ICON_BTN, 'size-8', 'hover:text-error']" :aria-label="T.removeMessage" v-tooltip="text.common.remove" @click="remove(i, message)"><Icon name="delete" :size="20" /></button>
    </div>

    <div>
      <BaseButton variant="ghost" size="sm" @click="$emit('add')"><Icon name="add" :size="18" />{{ text.common.add }}</BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import { valueOf } from "../utils/dom.ts";
import { nextTick, reactive } from "vue";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import SingleSelect from "./SingleSelect.vue";
import Twemoji from "./TwemojiImage.vue";
import EmojiPicker from "./EmojiPicker.vue";
import { FIELD } from "../utils/field.ts";
import { insertAt, caretOf, type Caret } from "../utils/caret.ts";
import { MAX_TEXT, type ActivityType } from "../../../src/config/schema/status.ts";
import type { MessageRow } from "../utils/presence-rows.ts";
import { text } from "../text/index.ts";
const T = text.presence;

// 배열을 그대로 고친다. 줄마다 갈아끼우면 입력 중에 초점이 튄다
const list = defineModel<MessageRow[]>({ required: true });
defineEmits<{ add: [] }>();

const placeholder = "🎵 /play";

const inputs = reactive<Record<number, HTMLInputElement | null>>({});
const carets = reactive<Record<number, Caret | null>>({});
// 줄마다의 입력칸. v-for 안의 함수 ref 가 넣는다
const keep = (key: number, el: unknown) => (inputs[key] = el instanceof HTMLInputElement ? el : null);

// 판을 열면 칸에서 초점이 떠나므로, 떠나기 전 커서 자리를 적어 둔다.
// 한 번도 만지지 않은 칸은 적어 둔 것이 없어, 넣을 때 글 끝으로 간다.
function remember(message: MessageRow) {
  carets[message.key] = caretOf(inputs[message.key]);
}

function insert(message: MessageRow, char: string) {
  const result = insertAt(message.text, char, carets[message.key], MAX_TEXT);
  if (!result) return;
  message.text = result.text;

  carets[message.key] = { start: result.caret, end: result.caret };
  void nextTick(() => {
    const el = inputs[message.key];
    el?.focus();
    el?.setSelectionRange(result.caret, result.caret);
  });
}

function remove(i: number, message: MessageRow) {
  delete inputs[message.key];
  delete carets[message.key];
  list.value.splice(i, 1);
}

// "기본"은 파일에 type을 적지 않는다는 뜻이고, 결과는 "듣는 중"과 같다.
// 그래도 둘을 따로 두는 것은 손으로 `type: Listening`이라 적어 둔 파일을 그대로 돌려놓기 위해서다.
// 종류는 서버의 것(schema/status 의 ACTIVITY_TYPES). 빠뜨리면 타입 검사가 잡는다
const TYPE_LABEL: Record<ActivityType | "", string> = T.activityTypes;
// "기본"(빈 값)은 고르기 칸의 빈 줄(empty-label)이 맡는다
const TYPES = Object.entries(TYPE_LABEL)
  .filter(([value]) => value)
  .map(([value, label]) => ({ value, label }));
</script>
