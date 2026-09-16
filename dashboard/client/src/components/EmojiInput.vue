<!--
  이모지 한 글자만 받는 입력칸.

  칸에 직접 쳐 넣거나 붙여넣을 수 있고(디스코드에서 복사해 오는 길), 칸을 누르면 고르는 판이 열린다
  — 환경에 따라 이모지를 직접 입력하기 어렵거나 불가능하기 때문이다.
  이모지가 아닌 글자는 애초에 남지 않는다. 선택 메뉴가 그런 값을 거부한다.
-->
<template>
  <div class="relative shrink-0">
    <input ref="anchor" :value="modelValue" placeholder="🎵" :class="[box, 'emoji']" v-tooltip="'이모지 — 직접 입력하거나 눌러서 고르기'" @input="onInput" @focus="open = true" @keydown.esc="open = false" />

    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-190" @mousedown="open = false"></div>
      <div v-if="open" class="fixed z-200 rounded-2xl overflow-hidden shadow-card border border-white/12 bg-[rgba(12,16,36,0.96)] backdrop-blur-sm" :style="popoverStyle">
        <!-- CSP(style-src 'self')가 인라인 style= 속성을 막는다 — 높이도 유틸리티로 준다.
             :style 바인딩은 CSSOM이라 대상이 아니지만, 정적 속성은 마크업에 그대로 남는다. -->
        <div class="h-[310px] overflow-y-auto overscroll-contain p-2">
          <section v-for="group in EMOJI_GROUPS" :key="group.name">
            <h4 class="sticky top-0 z-10 bg-[rgba(12,16,36,0.96)] text-[0.7rem] font-bold uppercase tracking-[0.08em] text-[rgba(196,181,253,0.65)] px-1 py-1.5">{{ group.name }}</h4>
            <div class="grid grid-cols-8 gap-0.5">
              <button v-for="e in group.emoji" :key="e" type="button" :class="[cell, 'emoji']" :title="e" @click="pick(e)">{{ e }}</button>
            </div>
          </section>
        </div>

        <button v-if="modelValue" type="button" class="w-full border-t border-white/10 text-muted text-[0.8rem] py-2 cursor-pointer hover:text-danger" @click="pick('')">비우기</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";
import { EMOJI_GROUPS } from "../emojiList.js";

defineProps({ modelValue: { type: String, default: "" } });
const emit = defineEmits(["update:modelValue"]);

const open = ref(false);
const anchor = ref(null);
const popoverStyle = ref({});

// 친 것·붙여넣은 것에서 이모지 한 글자만 남긴다. 국기·키캡처럼 코드포인트가 여럿인 것도 한 덩이로 잡힌다.
const RGI = /\p{RGI_Emoji}/gv;

function onInput(event) {
  const next = event.target.value.match(RGI)?.[0] || "";
  event.target.value = next; // 걸러낸 결과와 화면을 맞춘다 — 안 맞추면 거른 글자가 칸에 남는다
  emit("update:modelValue", next);
}

function pick(value) {
  emit("update:modelValue", value);
  open.value = false;
}

// 고르는 판을 띄울 자리 — 칸 아래가 화면을 넘치면 위로 올린다.
function place() {
  const rect = anchor.value?.getBoundingClientRect();
  if (!rect) return;
  const width = 316;
  const height = 350;
  const below = rect.bottom + 6;
  const top = below + height > window.innerHeight ? Math.max(8, rect.top - height - 6) : below;
  popoverStyle.value = { top: `${top}px`, left: `${Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)}px`, width: `${width}px` };
}

watch(open, (isOpen) => isOpen && place());

const box = "h-[38px] w-[38px] rounded-xl border border-white/9 bg-white/5 text-fg text-[1.05rem] leading-none text-center outline-none transition-[background-color,border-color] duration-150 focus:border-accent/55 focus:bg-white/7";
const cell = "size-[34px] rounded-lg text-[1.15rem] leading-none flex items-center justify-center cursor-pointer transition-colors duration-100 hover:bg-white/12";
</script>
