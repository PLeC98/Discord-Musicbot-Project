<!--
  상태 문구 줄 목록 — 평소 문구와 기간·시간대 문구가 같은 모양이라 함께 쓴다.

  활동 종류는 대부분 건드릴 일이 없어 기본값("듣는 중")을 골라 두면 파일에도 적히지 않는다.
  파일에서는 그런 줄이 `- 🎵 /play` 한 줄로 남는다.
-->
<template>
  <div>
    <div v-for="(message, i) in list" :key="message.key" class="flex items-center gap-2 mb-1.5">
      <input v-model="message.text" :placeholder="placeholder" :class="[inputCls, 'flex-1']" :maxlength="MAX_TEXT" />
      <!-- appearance-none: 그냥 두면 Windows가 네이티브 컨트롤로 그리면서 밝은 배경을 써
           밝은 글자가 안 보인다. CSS로 그리게 하고 화살표는 따로 얹는다. -->
      <div class="relative shrink-0">
        <select v-model="message.type" :class="[inputCls, selectCls]" v-tooltip="'활동 종류'">
          <!-- option은 네이티브로 그려져 부모 색을 물려받지 않는다 — 색을 직접 준다 -->
          <option v-for="type in TYPES" :key="type.value" :value="type.value" class="bg-[#141833] text-[#e7e9f3]">{{ type.label }}</option>
        </select>
        <svg width="9" height="6" viewBox="0 0 9 6" fill="currentColor" class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted">
          <path d="M0 0h9L4.5 6z" />
        </svg>
      </div>
      <button :class="removeBtn" v-tooltip="'이 문구 삭제'" @click="list.splice(i, 1)"><Icon name="trash" :size="15" /></button>
    </div>

    <button :class="addLine" @click="$emit('add')">
      <Icon name="add" :size="14" />
      <span>문구 추가</span>
    </button>
  </div>
</template>

<script setup>
import Icon from "./BaseIcon.vue";

// 배열을 그대로 고친다 — 줄마다 갈아끼우면 입력 중에 초점이 튄다
const list = defineModel({ type: Array, required: true });
defineEmits(["add"]);

const MAX_TEXT = 128;
const placeholder = "🎵 /play";

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
const selectCls = "w-28 appearance-none cursor-pointer pl-3! pr-7!";
const removeBtn = "h-[38px] w-[38px] rounded-xl border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color,border-color] duration-150 hover:bg-danger/15 hover:text-danger hover:border-danger/30";
const addLine = "flex items-center gap-1.5 text-muted text-[0.82rem] px-2 py-1.5 rounded-lg cursor-pointer transition-colors duration-150 hover:text-fg-soft hover:bg-white/6";
</script>
