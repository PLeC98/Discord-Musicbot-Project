<!--
  장르 하나의 곡 출처 목록 편집기.

  무슨 종류가 있고 어떤 칸을 받는지는 서버가 준다(GET /api/admin/source-types → autoplaySources.catalog).
  화면이 목록을 따로 들고 있으면 소스를 더할 때 한쪽만 고치게 된다.

  .env 에 키가 없는 종류는 **고르는 칸에서 숨긴다.** 다만 이미 설정에 적혀 있으면 그대로 보인다. 
  안 그러면 저장하는 순간 조용히 지워진다.
-->
<template>
  <div class="flex flex-col gap-2">
    <div v-for="(source, i) in list" :key="source._key" class="rounded-(--r-inner) bg-surface-container-high">
      <div class="flex items-center gap-2 p-2">
        <button :class="[ICON_BTN, 'size-8']" v-tooltip="isFolded(sourceFoldId(genreIndex, i)) ? text.common.expand : text.common.collapse" @click="toggleFold(sourceFoldId(genreIndex, i))">
          <Icon name="expand_more" :size="20" class="transition-transform duration-150" :class="{ '-rotate-90': isFolded(sourceFoldId(genreIndex, i)) }" />
        </button>

        <div class="flex-1 min-w-0">
          <SingleSelect :model-value="source.type" :options="typeOptions(source.type)" @update:model-value="changeType(i, $event)" />
        </div>

        <label class="flex items-center gap-2 shrink-0" v-tooltip="T.weightTip">
          <span class="text-xs text-on-surface-variant">{{ T.weight }}</span>
          <NumberInput :model-value="numberAt(source, 'weight')" placeholder="1" :class="[FIELD, 'w-16 px-2 text-center']" @update:model-value="setField(i, 'weight', $event)" />
        </label>

        <button :class="[ICON_BTN, 'size-8 hover:text-error']" :aria-label="T.remove" v-tooltip="text.common.remove" @click="remove(i)"><Icon name="delete" :size="20" /></button>
      </div>

      <div v-show="!isFolded(sourceFoldId(genreIndex, i))" class="flex flex-col gap-3 px-3 pb-3">
        <p v-if="spec(source.type)?.hint" class="text-xs text-on-surface-variant">{{ spec(source.type)?.hint }}</p>
        <p v-if="typesState === 'loading'" class="text-xs text-on-surface-variant">{{ T.typesLoading }}</p>
        <p v-else-if="typesState === 'failed'" class="text-xs text-(--warn-ink) whitespace-pre-line">{{ T.typesFailed }}{{ typesError ? `\n${typesError}` : "" }}</p>
        <p v-else-if="!spec(source.type)" class="text-xs text-error">{{ T.unknownType }}</p>
        <p v-else-if="!spec(source.type)?.usable" class="text-xs text-(--warn-ink)">{{ T.unusable(String(spec(source.type)?.needs)) }}</p>

        <!-- 칸 너비는 서버가 정한다(width). 짧은 칸이 한 줄을 다 먹을 이유가 없다 -->
        <div class="grid grid-cols-2 @xl/card:grid-cols-6 gap-3">
          <div v-for="field in shown(source, i)" :key="field.key" class="min-w-0" :class="widthCls(field)">
            <!-- 1/6 너비 칸은 설명을 붙이면 줄이 터진다. 툴팁으로 돌린다 -->
            <span :class="fieldLabelCls" v-tooltip="field.width === 'narrow' ? field.hint : ''">
              {{ field.label }}<span v-if="field.required" class="text-error">*</span><span v-if="field.hint && field.width !== 'narrow'" class="ml-1 font-normal text-on-surface-variant">{{ field.hint }}</span>
            </span>

            <ChipInput v-if="field.kind === 'list'" :model-value="asList(source[field.key]).map(String)" :placeholder="field.suggest ? T.listSuggest : T.listPlain" :suggest="suggestOf(source, field)" @update:model-value="setField(i, field.key, $event.length ? $event : null)" />

            <MultiSelect v-else-if="field.kind === 'enumDrop'" :model-value="asList(source[field.key])" :options="field.options" @update:model-value="setField(i, field.key, $event.length ? $event : null)" />

            <TagPicker v-else-if="field.kind === 'enumSearch'" :model-value="asList(source[field.key])" :options="field.options" @update:model-value="setField(i, field.key, $event.length ? $event : null)" />

            <div v-else-if="field.kind === 'enumList'" class="flex flex-wrap gap-2">
              <button v-for="opt in field.options" :key="opt.value" type="button" :aria-pressed="asList(source[field.key]).includes(opt.value)" :class="[FILTER_CHIP, asList(source[field.key]).includes(opt.value) ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="toggle(i, field.key, opt.value)">{{ opt.label }}</button>
            </div>

            <SingleSelect v-else-if="field.kind === 'enum'" :model-value="valueAt(source, field.key) ?? ''" :options="field.options" :empty-label="field.emptyLabel || text.common.clearValue" @update:model-value="setField(i, field.key, $event || null)" />

            <RangeSlider v-else-if="field.kind === 'range'" :min="field.min" :max="field.max" :from="rangeAt(source, field.key)" :to="rangeAt(source, field.to)" :label="field.label" :histogram="field.histogram || []" @update="setRange(i, field, $event)" />

            <NumberInput v-else-if="field.kind === 'number'" :model-value="numberAt(source, field.key)" :class="[FIELD, 'w-full']" @update:model-value="setField(i, field.key, $event)" />

            <input v-else :value="valueAt(source, field.key) ?? ''" type="text" :placeholder="field.kind === 'url' ? 'https://…' : ''" :class="[FIELD, 'w-full']" @input="setField(i, field.key, valueOf($event) || null)" />
          </div>
        </div>

        <div v-if="deepCount(source.type)">
          <BaseButton variant="ghost" size="sm" @click="toggleDeepOpen(sourceFoldId(genreIndex, i))"><Icon name="expand_more" :size="18" class="transition-transform duration-150" :class="isDeepOpen(sourceFoldId(genreIndex, i)) && 'rotate-180'" />{{ isDeepOpen(sourceFoldId(genreIndex, i)) ? T.deepClose : T.deepOpen(deepCount(source.type)) }}</BaseButton>
        </div>
        <p v-if="spec(source.type)?.window" class="text-xs text-on-surface-variant">{{ T.window(depthOf(source)) }}</p>
      </div>
    </div>

    <!-- 출처 더하기: 종류를 고르고 + (아이콘 버튼 S, 색조 면) -->
    <div class="flex items-center gap-2">
      <div class="flex-1 min-w-0">
        <SingleSelect v-model="adding" :options="addable.map((t) => ({ value: t.type, label: t.label }))" :empty-label="T.addPlaceholder" />
      </div>
      <button type="button" class="tap state-layer size-10 shrink-0 rounded-full flex items-center justify-center cursor-pointer bg-secondary-container text-on-secondary-container disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:cursor-not-allowed" :disabled="!adding" :aria-label="T.add" v-tooltip="text.common.add" @click="add"><Icon name="add" :size="24" /></button>
    </div>
    <p v-if="!list.length" class="text-xs text-error">{{ T.none }}</p>
  </div>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import { ref, computed, watch } from "vue";
import { windowDepth } from "../../../src/rules/window-depth.ts";
import Icon from "./BaseIcon.vue";
import BaseButton from "./BaseButton.vue";
import { FIELD } from "../utils/field.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF, FILTER_CHIP_ON } from "../utils/filter-chip.ts";
import ChipInput from "./ChipInput.vue";
import RangeSlider from "./RangeSlider.vue";
import MultiSelect from "./MultiSelect.vue";
import SingleSelect from "./SingleSelect.vue";
import TagPicker from "./TagPicker.vue";
import NumberInput from "./NumberInput.vue";
import { isFolded, toggleFold, sourceFoldId, isDeepOpen, toggleDeepOpen, reorderSources } from "../composables/config-folds.ts";
import { valueOf } from "../utils/dom.ts";
import type { OptionValue } from "../utils/options.ts";
import type { SourceData } from "../utils/genre-rows.ts";
import type { SourceTypeView } from "../../../src/config/schema/genre-sources.ts";
import { text } from "../text/index.ts";
const T = text.genres.source;

/** 편집기가 그리는 칸 하나(서버가 준 것) */
type Field = SourceTypeView["fields"][number];
/** 자동완성 후보 하나 */
type Suggestion = { value: string; hint?: string };

const props = withDefaults(
  defineProps<{
    modelValue?: SourceData[];
    types?: SourceTypeView[];
    /** 종류 목록을 받는 중(loading) · 받음(ready) · 못 받음(failed). 받기 전에는 모르는 종류라고 하지 않는다 */
    typesState?: "loading" | "ready" | "failed";
    /** 못 받았을 때의 까닭(문제 응답의 글) */
    typesError?: string;
    /** 자동완성 후보를 묻는다: (출처 종류, 칸, 친 말) */
    suggest: (type: string, field: string, term: string) => Promise<Suggestion[]>;
    genreIndex?: number;
  }>(),
  { modelValue: () => [], types: () => [], typesState: "ready", typesError: "", genreIndex: 0 },
);
const emit = defineEmits<{ "update:modelValue": [value: SourceData[]] }>();

const fieldLabelCls = "block mb-1 text-xs font-semibold text-on-surface";

// 모바일은 두 칸, 태블릿부터 여섯 칸짜리 격자다.
const WIDTHS: Record<NonNullable<Field["width"]>, string> = {
  narrow: "col-span-1", // 모바일 1/2, 그 위로 1/6
  half: "col-span-1 @xl/card:col-span-3", // 늘 반 줄
  halfWide: "col-span-2 @xl/card:col-span-3", // 모바일만 한 줄
};
const widthCls = (field: Field) => (field.width ? WIDTHS[field.width] : "col-span-2 @xl/card:col-span-6");

// 편집 중 목록이 흔들리지 않게 행마다 값을 붙인다. 종류를 바꿔도 같은 행으로 남아야 한다.
//
// computed 로 두면 안 된다. get 이 매번 새 배열을 만드니 거기에 splice 해 봐야 set 이 안 불리고,
// _key 도 렌더마다 새로 붙어 입력칸이 포커스를 잃는다. 그래서 여기 두고 위에서 내려온 것만 맞춘다.
let serial = 0;
const list = ref<SourceData[]>([]);

// watch 가 immediate 로 바로 돌므로 그 전에 있어야 한다. 아래에 두면 TDZ 에 걸리는데,
// Vue 가 watcher 콜백의 예외를 잡아 콘솔에만 남기고 넘어가므로 화면은 멀쩡히 그려지고
// 목록만 빈 채로 "출처가 하나는 있어야 합니다"가 뜬다.
const clean = (one: SourceData): SourceData => Object.fromEntries(Object.entries(one).filter(([k]) => k !== "_key"));
const push = () => emit("update:modelValue", list.value.map(clean));

watch(
  () => props.modelValue,
  (next) => {
    const incoming = next || [];
    // 우리가 방금 올려보낸 것이 그대로 내려온 것이면 건드리지 않는다. 건드리면 _key 가 갈린다
    if (JSON.stringify(incoming.map(clean)) === JSON.stringify(list.value.map(clean))) return;
    list.value = incoming.map((one) => ({ ...one, _key: ++serial }));
  },
  { immediate: true, deep: true },
);

function remove(i: number) {
  reorderSources(
    props.genreIndex,
    list.value.map((_, at) => at).filter((at) => at !== i),
  );
  list.value.splice(i, 1);
  push();
}

const adding = ref<OptionValue>("");

const spec = (type: string | undefined) => props.types.find((t) => t.type === type) || null;

// 칸의 값. 파일에 적힌 것이라 모양을 보고 읽는다
const asList = (v: unknown): OptionValue[] => (Array.isArray(v) ? v.filter((one): one is OptionValue => typeof one === "string" || typeof one === "number") : v == null || v === "" ? [] : typeof v === "string" || typeof v === "number" ? [v] : []);
const valueAt = (source: SourceData, key: string): OptionValue | null => {
  const v = source[key];
  return typeof v === "string" || typeof v === "number" ? v : null;
};
const numberAt = (source: SourceData, key: string): number | string | null => valueAt(source, key);
const rangeAt = (source: SourceData, key: string | undefined): number | null => {
  const v = key ? source[key] : null;
  return typeof v === "number" ? v : null;
};

// 쓸 수 있는 것만 고르게 한다. 다만 이미 쓰고 있는 종류는 목록에 남겨야 한다.
// 안 그러면 select 가 값을 잃고 저장할 때 조용히 바뀐다.
const addable = computed(() => props.types.filter((t) => t.usable));
const choosable = (current: string | undefined) => props.types.filter((t) => t.usable || t.type === current);
// 키가 없는 소스도 보이되 왜 못 쓰는지를 적어 둔다. 이미 고른 것이면 남아 있어야 한다
const typeOptions = (current: string | undefined) => choosable(current).map((t) => ({ value: t.type, label: `${t.label}${t.usable ? "" : T.noKey}` }));

const fieldsOf = (type: string | undefined) => spec(type)?.fields || [];
const deepCount = (type: string | undefined) => fieldsOf(type).filter((f) => f.deep).length;
// when 이 있는 칸은 그 칸이 채워졌을 때만 뜬다. 분기는 연도를 자른 뒤에나 뜻이 있다
const shown = (source: SourceData, i: number) => fieldsOf(source.type).filter((f) => (!f.deep || isDeepOpen(sourceFoldId(props.genreIndex, i))) && (!f.when || hasRange(source, f.when)));
// 구간은 두 칸으로 적히니 한쪽만 손으로 적어 둔 설정도 있다
function hasRange(source: SourceData, key: string) {
  const to = fieldsOf(source.type).find((f) => f.key === key)?.to;
  return source[key] != null || (to !== undefined && source[to] != null);
}

// 자동완성 후보는 부르는 쪽(ConfigGenres)이 서버에 묻는다. 이 컴포넌트는 그리기만 한다
function suggestOf(source: SourceData, field: Field) {
  const what = field.suggest;
  return what ? (term: string) => props.suggest(source.type ?? "", what, term) : null;
}

// 곡이 많을 때 몇 번째 곡까지 보는지. 봇과 같은 셈(rules/window-depth)
const depthOf = (source: SourceData) => {
  const window = spec(source.type)?.window;
  return window ? windowDepth(window, source) : 0;
};

function write(i: number, patch: Record<string, unknown>) {
  const row = list.value[i];
  for (const [k, v] of Object.entries(patch)) {
    // 비운 칸은 아예 지운다. YAML 에 `minScore: null` 같은 줄을 남기지 않는다
    if (v == null) delete row[k];
    else row[k] = v;
  }
  push();
}

const setField = (i: number, key: string, value: unknown) => write(i, { [key]: value });

// 구간은 두 칸을 한꺼번에 쓴다(yearFrom·yearTo).
// 전체로 되돌리면 그 구간에 딸린 칸도 비운다. 화면에서 사라진 값이 설정에 남으면 안 된다.
function setRange(i: number, field: Field, range: { from: number | null; to: number | null }) {
  const patch: Record<string, unknown> = { [field.key]: range.from };
  if (field.to) patch[field.to] = range.to;
  if (range.from == null && range.to == null) {
    for (const dep of fieldsOf(list.value[i].type).filter((one) => one.when === field.key)) patch[dep.key] = null;
  }
  write(i, patch);
}

function toggle(i: number, key: string, opt: OptionValue) {
  const now = asList(list.value[i][key]);
  const next = now.includes(opt) ? now.filter((x) => x !== opt) : [...now, opt];
  setField(i, key, next.length ? next : null);
}

// 종류를 바꾸면 그 종류가 안 받는 칸은 버린다. 남겨 두면 저장할 때 검사에 걸린다
function changeType(i: number, type: OptionValue) {
  const keep = new Set(fieldsOf(String(type)).flatMap((f) => (f.to ? [f.key, f.to] : [f.key])));
  const old = list.value[i];
  const kept = Object.fromEntries(Object.entries(old).filter(([k]) => keep.has(k) || k === "weight" || k === "_key"));
  list.value[i] = { ...kept, type: String(type) };
  push();
}

function add() {
  if (!adding.value) return;
  list.value.push({ type: String(adding.value), _key: ++serial });
  adding.value = "";
  push();
}
</script>
