<!--
  문자열 목록을 칩으로 다룬다. 검색어와 차단어가 같은 성질이라 한 곳에 모은다.
  Enter로 추가, 지우기 버튼 또는 빈 입력란에서 Backspace로 제거, 칩을 누르면 고친다.

  suggest 를 주면 입력하는 동안 후보를 표시한다(VocaDB 태그 · 가수). 후보는 돕는 것일 뿐이라
  목록에 없는 말도 Enter 로 추가할 수 있다. 저쪽이 느리거나 죽어 있어도 입력할 수 있어야 한다.
-->
<template>
  <div ref="root">
    <div ref="box" :class="CHIP_FIELD">
      <!-- max-w-full: 긴 값이 들어와도 칩이 상자를 뚫고 나가지 않게 한다(뚫으면 페이지에 가로 스크롤이 생긴다) -->
      <span v-for="(item, i) in modelValue" :key="`${i}-${item}`" :class="INPUT_CHIP">
        <!-- 고치는 중에는 그 자리에서 바로 입력한다. 삭제하고 다시 입력하게 하면 긴 검색어가 성가시다.
             size 속성은 "0" 글자 너비로 세는 것이라 실제 글자 폭과 어긋나고 상한도 없다.
             field-sizing으로 내용에 맞추되 max-w-full로 묶는다(안 되는 브라우저는 기본 폭으로 남는다). -->
        <input v-if="editing === i" ref="editBox" :value="draft" @input="draft = valueOf($event)" class="bg-transparent border-0 text-on-surface text-xs outline-none font-[inherit] p-0 min-w-16 max-w-full field-sizing-content" @keydown.enter="composing($event) || ($event.preventDefault(), commitEdit())" @keydown.esc="editing = null" @blur="commitEdit" />
        <template v-else>
          <!-- 긴 값은 줄여 보이므로, 툴팁으로는 전문을 보여준다 -->
          <button class="cursor-text text-left truncate min-w-0" v-tooltip="item" @click="startEdit(i)">{{ item }}</button>
          <button :class="INPUT_CHIP_CLOSE" :aria-label="text.common.remove" v-tooltip="text.common.remove" @click="removeAt(i)"><Icon name="close" :size="18" /></button>
        </template>
      </span>

      <input
        :value="entry"
        @input="entry = valueOf($event)"
        :placeholder="modelValue.length ? '' : placeholder"
        class="flex-1 min-w-32 h-8 px-2 bg-transparent border-0 text-on-surface text-sm outline-none font-[inherit] placeholder:text-on-surface-variant"
        @focus="open = true"
        @keydown.down="composing($event) || ($event.preventDefault(), move(1))"
        @keydown.up="composing($event) || ($event.preventDefault(), move(-1))"
        @keydown.enter="composing($event) || ($event.preventDefault(), onEnter())"
        @keydown.esc="open = false"
        @keydown.backspace="composing($event) || onBackspace()"
        @blur="commit"
      />
    </div>

    <Teleport to="body">
      <!-- mousedown.prevent: 누르는 순간 입력란이 blur 되면 입력하던 말이 먼저 칩이 된다 -->
      <div v-if="suggest && open && hits.length && state === 'done'" ref="panel" :class="CHIP_PANEL" :style="style">
        <button v-for="(one, i) in hits" :key="one.value" type="button" :class="[CHIP_PANEL_ROW, i === at ? 'bg-on-surface/8' : '']" @mouseenter="at = i" @mousedown.prevent @click="take(one)">
          <span class="truncate">{{ one.value }}</span>
          <span v-if="one.hint" class="ml-auto pl-2 text-xs text-on-surface-variant shrink-0">{{ one.hint }}</span>
        </button>
      </div>
      <!-- 저쪽이 느릴 때가 있다. 요청 중인지 알 수 있어야 기다린다 -->
      <p v-else-if="suggest && open && state === 'loading'" ref="panel" :class="[CHIP_PANEL_NOTE, 'flex items-center gap-2']" :style="style"><Icon name="progress_activity" :size="14" class="animate-spin" />{{ text.fields.suggestLoading }}</p>
      <p v-else-if="suggest && open && state === 'failed'" ref="panel" :class="[CHIP_PANEL_NOTE, 'whitespace-pre-line']" :style="style">{{ text.fields.suggestFailed }}{{ failReason ? `\n${failReason}` : "" }}</p>
      <p v-else-if="suggest && open && state === 'done'" ref="panel" :class="CHIP_PANEL_NOTE" :style="style">{{ text.fields.suggestNone }}</p>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { composing, valueOf } from "../utils/dom.ts";
import { rem } from "../utils/rem.ts";
import { CHIP_FIELD, CHIP_PANEL, CHIP_PANEL_NOTE, CHIP_PANEL_ROW, INPUT_CHIP, INPUT_CHIP_CLOSE } from "../utils/field.ts";
import { ref, watch, nextTick, useTemplateRef, onUnmounted } from "vue";
import Icon from "./BaseIcon.vue";
import { useAnchoredPanel } from "../composables/anchored-panel.ts";
import { useListCursor } from "../composables/list-cursor.ts";
import { problemText } from "../utils/problem.ts";
import { text } from "../text/index.ts";

/** 후보 하나. hint 는 이름 옆에 흐리게 보인다 */
type Suggestion = { value: string; hint?: string };

const props = withDefaults(
  defineProps<{
    modelValue?: string[];
    placeholder?: string;
    /** 차단어처럼 대소문자를 가리지 않고 견주는 입력란. 입력되는 값 자체를 낮춰 둔다 */
    lowercase?: boolean;
    /** 검색어로 후보를 불러온다. 없으면 후보를 표시하지 않는다 */
    suggest?: ((term: string) => Promise<Suggestion[]>) | null;
  }>(),
  { modelValue: () => [], placeholder: "", lowercase: false, suggest: null },
);
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();

const entry = ref("");
const editing = ref<number | null>(null);
const draft = ref("");
const editBox = useTemplateRef("editBox");

const root = ref<HTMLElement | null>(null);
const box = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const open = ref(false);
const hits = ref<Suggestion[]>([]);
// 후보 불러오기: idle(입력한 말이 없다) · loading · done · failed
const state = ref("idle");
const failReason = ref("");
// 방향키로 선택한 후보. -1 이면 선택한 것이 없어 Enter 가 입력한 말을 그대로 추가한다
const { at, move: moveCursor, reset } = useListCursor(panel, () => hits.value.length, -1);
const { style } = useAnchoredPanel({ root, anchor: box, panel, open, maxHeight: rem(15) });

const normalize = (text: string) => (props.lowercase ? text.trim().toLowerCase() : text.trim());

// 입력하는 동안 매 글자마다 요청하지 않는다. 늦게 온 답이 지금 입력한 말과 다르면 버린다
const SUGGEST_WAIT_MS = 250;
let timer: ReturnType<typeof setTimeout> | undefined;
watch(entry, (text) => {
  clearTimeout(timer);
  reset();
  const term = text.trim();
  hits.value = [];
  if (!props.suggest || !term) {
    state.value = "idle";
    return;
  }
  // 기다리는 동안에도 요청 중으로 보인다. 입력하자마자 반응이 있어야 한다
  state.value = "loading";
  const suggest = props.suggest;
  timer = setTimeout(async () => {
    let found: Suggestion[];
    let failed = false;
    try {
      found = await suggest(term);
    } catch (error) {
      found = []; // 후보를 못 불러와도 입력하는 것은 된다
      failed = true;
      failReason.value = problemText(error, "");
    }
    if (entry.value.trim() !== term) return;
    hits.value = found.filter((one) => !props.modelValue.includes(one.value));
    state.value = failed ? "failed" : "done";
  }, SUGGEST_WAIT_MS);
});
// 입력란이 사라지면(장르 · 출처를 삭제) 기다리던 요청도 보내지 않는다
onUnmounted(() => clearTimeout(timer));

// 방향키로 오르내리면 닫혀 있던 목록도 연다
const move = (by: number) => {
  if (!hits.value.length) return;
  open.value = true;
  moveCursor(by);
};

function take(one: Suggestion) {
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
  if (!value || props.modelValue.includes(value)) return; // 같은 것을 두 번 추가할 이유가 없다
  emit("update:modelValue", [...props.modelValue, value]);
}

function removeAt(i: number) {
  emit(
    "update:modelValue",
    props.modelValue.filter((_, at) => at !== i),
  );
}

async function startEdit(i: number) {
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
  // 비우면 삭제한 것으로 본다. 다른 칩과 같아지면 합쳐질 뿐이므로 그것도 삭제한다.
  if (!value || props.modelValue.some((item, at) => at !== i && item === value)) return removeAt(i);
  if (value === props.modelValue[i]) return;

  emit(
    "update:modelValue",
    props.modelValue.map((item, at) => (at === i ? value : item)),
  );
}

// 빈 입력란에서 Backspace면 마지막 칩을 삭제한다. 칩 UI의 관습이다.
function onBackspace() {
  if (entry.value !== "" || props.modelValue.length === 0) return;
  emit("update:modelValue", props.modelValue.slice(0, -1));
}
</script>
