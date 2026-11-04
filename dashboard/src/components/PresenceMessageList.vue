<!--
  상태 문구 행 목록. 기본 문구와 기간, 시간대 문구가 같은 모양이라 함께 쓴다.

  활동 종류는 대부분 건드릴 일이 없어 "기본"을 두면 파일에도 적히지 않는다.
  파일에서는 그런 항목이 `- 🎵 /play` 한 줄로 남는다.
-->
<template>
  <!-- 행: 문구 입력란(오른쪽 안에 이모지, 디스코드 입력창처럼), 활동 종류, 삭제. 아래에 문구 추가 -->
  <div class="flex flex-col gap-2">
    <div v-for="(message, i) in list" :key="message.key" class="flex items-center gap-2">
      <EmojiTextInput v-model="message.text" class="flex-1" :placeholder="placeholder" :maxlength="MAX_TEXT" device-emoji />

      <SingleSelect :model-value="message.type" class="w-32 shrink-0" :options="TYPES" :empty-label="T.activityTypes['']" v-tooltip="T.activity" @update:model-value="message.type = $event as ActivityType" />

      <button type="button" :class="[ICON_BTN, 'size-8', 'hover:text-error']" :aria-label="T.removeMessage" v-tooltip="text.common.remove" @click="remove(i)"><Icon name="delete" :size="20" /></button>
    </div>

    <div>
      <BaseButton variant="ghost" size="sm" @click="$emit('add')"><Icon name="add" :size="18" />{{ text.common.add }}</BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import SingleSelect from "./SingleSelect.vue";
import EmojiTextInput from "./EmojiTextInput.vue";
import { MAX_TEXT, type ActivityType } from "../../../src/config/schema/status.ts";
import type { MessageRow } from "../utils/presence-rows.ts";
import { text } from "../text/index.ts";
const T = text.presence;

// 배열을 그대로 고친다. 행마다 교체하면 입력 중에 포커스가 튄다
const list = defineModel<MessageRow[]>({ required: true });
defineEmits<{ add: [] }>();

const placeholder = "🎵 /play";

function remove(i: number) {
  list.value.splice(i, 1);
}

// "기본"은 파일에 type을 적지 않는다는 뜻이고, 결과는 "듣는 중"과 같다.
// 그래도 둘을 따로 두는 것은 손으로 `type: Listening`이라 적어 둔 파일을 그대로 돌려놓기 위해서다.
// 종류는 서버의 것(schema/status 의 ACTIVITY_TYPES). 빠뜨리면 타입 검사가 잡는다
const TYPE_LABEL: Record<ActivityType | "", string> = T.activityTypes;
// "기본"(빈 값)은 드롭다운의 빈 항목(empty-label)이 맡는다
const TYPES = Object.entries(TYPE_LABEL)
  .filter(([value]) => value)
  .map(([value, label]) => ({ value, label }));
</script>
