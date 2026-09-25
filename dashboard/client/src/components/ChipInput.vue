<!--
  문자열 목록을 칩으로 다룬다. 검색어와 차단어가 같은 성질이라 한 곳에 모은다.
  Enter로 추가, 지우기 버튼 또는 빈 칸에서 Backspace로 제거, 칩을 누르면 고친다.

  suggest 를 주면 치는 동안 후보를 띄운다(VocaDB 태그 · 가수). 후보는 돕는 것일 뿐이라
  목록에 없는 말도 Enter 로 넣을 수 있다. 저쪽이 느리거나 죽어 있어도 적을 수 있어야 한다.
-->
<template>
  <div ref="root">
    <div ref="box" class="flex flex-wrap items-center gap-1.5 bg-white/5 border border-white/9 rounded-xl px-2.5 py-2 transition-[border-color,background-color] duration-200 focus-within:border-accent/55 focus-within:bg-white/7">
      <!-- max-w-full: 긴 값이 들어와도 칩이 상자를 뚫고 나가지 않게 한다(뚫으면 페이지에 가로 스크롤이 생긴다) -->
      <span v-for="(item, i) in modelValue" :key="`${i}-${item}`" class="inline-flex items-center gap-1 max-w-full min-w-0 bg-white/8 rounded-lg pl-2 pr-1 py-0.5 text-[0.8rem]">
        <!-- 고치는 중에는 그 자리에서 바로 친다. 지우고 다시 넣게 하면 긴 검색어가 성가시다.
             size 속성은 "0" 글자 너비로 세는 것이라 실제 글자 폭과 어긋나고 상한도 없다.
             field-sizing으로 내용에 맞추되 max-w-full로 묶는다(안 되는 브라우저는 기본 폭으로 남는다). -->
        <input v-if="editing === i" ref="editBox" v-model="draft" class="bg-transparent border-0 text-fg text-[0.8rem] outline-none font-[inherit] p-0 min-w-16 max-w-full field-sizing-content" @keydown.enter.prevent="commitEdit" @keydown.esc="editing = null" @blur="commitEdit" />
        <template v-else>
          <!-- 긴 값은 줄여 보이므로, 툴팁으로는 전문을 보여준다 -->
          <button class="cursor-text text-left truncate min-w-0" v-tooltip="item" @click="startEdit(i)">{{ item }}</button>
          <button class="size-4 rounded text-muted cursor-pointer flex items-center justify-center shrink-0 hover:text-danger" v-tooltip="'제거'" @click="removeAt(i)"><Icon name="close" :size="11" /></button>
        </template>
      </span>

      <input v-model="entry" :placeholder="modelValue.length ? '' : placeholder" class="flex-1 min-w-32 bg-transparent border-0 text-fg text-[0.85rem] outline-none font-[inherit] py-0.5" @focus="open = true" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.enter.prevent="onEnter" @keydown.esc="open = false" @keydown.backspace="onBackspace" @blur="commit" />
    </div>

    <Teleport to="body">
      <!-- mousedown.prevent: 누르는 순간 입력칸이 blur 되면 치던 말이 먼저 칩이 된다 -->
      <div v-if="suggest && open && hits.length && state === 'done'" ref="panel" :class="panelCls" :style="style">
        <button v-for="(one, i) in hits" :key="one.value" type="button" :class="[rowCls, i === at ? 'bg-white/10' : '']" @mouseenter="at = i" @mousedown.prevent @click="take(one)">
          <span class="truncate">{{ one.value }}</span>
          <span v-if="one.hint" class="ml-auto pl-2 text-muted text-[0.72rem] shrink-0">{{ one.hint }}</span>
        </button>
      </div>
      <!-- 저쪽이 느릴 때가 있다. 묻는 중인지 알 수 있어야 기다린다 -->
      <p v-else-if="suggest && open && state === 'loading'" ref="panel" :class="[noteCls, 'flex items-center gap-2']" :style="style"><Icon name="spinner" :size="14" class="animate-spin" />후보를 찾는 중입니다</p>
      <p v-else-if="suggest && open && state === 'failed'" ref="panel" :class="noteCls" :style="style">후보를 받지 못했습니다. Enter 로 그대로 넣을 수 있습니다</p>
      <p v-else-if="suggest && open && state === 'done'" ref="panel" :class="noteCls" :style="style">후보가 없습니다. Enter 로 그대로 넣을 수 있습니다</p>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, useTemplateRef } from "vue";
import Icon from "./BaseIcon.vue";
import { useAnchoredPanel } from "../composables/anchoredPanel";

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  placeholder: { type: String, default: "" },
  // 차단어처럼 대소문자를 가리지 않고 견주는 자리. 적히는 값 자체를 낮춰 둔다
  lowercase: { type: Boolean, default: false },
  // (검색어) => Promise<{ value, hint? }[]>. 없으면 후보를 띄우지 않는다
  suggest: { type: Function, default: null },
});
const emit = defineEmits(["update:modelValue"]);

const panelCls = "overflow-auto rounded-lg border border-white/12 bg-[#141833] shadow-[0_12px_32px_rgba(0,0,0,0.5)] py-1";
const noteCls = "rounded-lg border border-white/12 bg-[#141833] px-2.5 py-2 text-[0.8rem] text-muted";
const rowCls = "w-full flex items-center px-2.5 py-1.5 text-[0.82rem] text-fg-soft text-left cursor-pointer transition-colors duration-100 hover:bg-white/8";

const entry = ref("");
const editing = ref(null);
const draft = ref("");
const editBox = useTemplateRef("editBox");

const root = ref(null);
const box = ref(null);
const panel = ref(null);
const open = ref(false);
const hits = ref([]);
// 후보 받기: idle(칠 말이 없다) · loading · done · failed
const state = ref("idle");
// 방향키로 고른 후보. -1 이면 고른 것이 없어 Enter 가 친 말을 그대로 넣는다
const at = ref(-1);
const { style } = useAnchoredPanel({ root, anchor: box, panel, open, maxHeight: 240 });

const normalize = (text) => (props.lowercase ? text.trim().toLowerCase() : text.trim());

// 치는 동안 매 글자마다 묻지 않는다. 늦게 온 답이 지금 친 말과 다르면 버린다
const SUGGEST_WAIT_MS = 250;
let timer = null;
watch(entry, (text) => {
  clearTimeout(timer);
  at.value = -1;
  const term = text.trim();
  hits.value = [];
  if (!props.suggest || !term) {
    state.value = "idle";
    return;
  }
  // 기다리는 동안에도 묻는 중으로 보인다. 치자마자 반응이 있어야 한다
  state.value = "loading";
  timer = setTimeout(async () => {
    let found;
    let failed = false;
    try {
      found = await props.suggest(term);
    } catch {
      found = []; // 후보를 못 받아도 적는 것은 된다
      failed = true;
    }
    if (entry.value.trim() !== term) return;
    hits.value = found.filter((one) => !props.modelValue.includes(one.value));
    state.value = failed ? "failed" : "done";
  }, SUGGEST_WAIT_MS);
});

// 방향키로 내려간 줄이 잘려 있으면 고를 수가 없다. 눈에 들어오게 밀어 준다(TagPicker 와 같다)
watch(at, () => nextTick(() => panel.value?.children?.[at.value]?.scrollIntoView({ block: "nearest" })));

const move = (by) => {
  if (!hits.value.length) return;
  open.value = true;
  const n = hits.value.length;
  // 아직 고른 것이 없으면(-1) 위는 마지막 줄, 아래는 첫 줄이다. 그냥 더하면 위가 끝에서 두 번째가 된다
  at.value = at.value < 0 ? (by > 0 ? 0 : n - 1) : (at.value + by + n) % n;
};

function take(one) {
  entry.value = "";
  hits.value = [];
  if (!props.modelValue.includes(one.value)) emit("update:modelValue", [...props.modelValue, one.value]);
}

function onEnter() {
  if (open.value && at.value >= 0 && hits.value[at.value]) return take(hits.value[at.value]);
  commit();
}

function commit() {
  const value = normalize(entry.value);
  entry.value = "";
  if (!value || props.modelValue.includes(value)) return; // 같은 것을 두 번 넣을 이유가 없다
  emit("update:modelValue", [...props.modelValue, value]);
}

function removeAt(i) {
  emit(
    "update:modelValue",
    props.modelValue.filter((_, at) => at !== i),
  );
}

async function startEdit(i) {
  editing.value = i;
  draft.value = props.modelValue[i];
  await nextTick();
  // v-for 안의 ref는 배열로 모인다. 지금 열린 것은 하나뿐이다
  const el = Array.isArray(editBox.value) ? editBox.value[0] : editBox.value;
  el?.select();
}

function commitEdit() {
  const i = editing.value;
  if (i == null) return;
  editing.value = null;

  const value = normalize(draft.value);
  // 비우면 지운 것으로 본다. 다른 칩과 같아지면 합쳐질 뿐이므로 그것도 지운다.
  if (!value || props.modelValue.some((item, at) => at !== i && item === value)) return removeAt(i);
  if (value === props.modelValue[i]) return;

  emit(
    "update:modelValue",
    props.modelValue.map((item, at) => (at === i ? value : item)),
  );
}

// 빈 칸에서 Backspace면 마지막 칩을 지운다. 칩 UI의 관습이다.
function onBackspace() {
  if (entry.value !== "" || props.modelValue.length === 0) return;
  emit("update:modelValue", props.modelValue.slice(0, -1));
}
</script>
