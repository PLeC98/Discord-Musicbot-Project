<!--
  장르 하나의 곡 출처 목록 편집기.

  무슨 종류가 있고 어떤 칸을 받는지는 서버가 준다(GET /api/admin/source-types → autoplaySources.catalog).
  화면이 목록을 따로 들고 있으면 소스를 더할 때 한쪽만 고치게 된다.

  .env 에 키가 없는 종류는 **고르는 칸에서 숨긴다.** 다만 이미 설정에 적혀 있으면 그대로 보인다. 
  안 그러면 저장하는 순간 조용히 지워진다.
-->
<template>
  <div>
    <div v-for="(source, i) in list" :key="source._key" class="border border-white/8 rounded-lg mb-2 bg-black/15">
      <div class="flex items-center gap-2 p-2.5">
        <button :class="foldBtn" v-tooltip="isFolded(sourceFoldId(genreIndex, i)) ? '펼치기' : '접기'" @click="toggleFold(sourceFoldId(genreIndex, i))">
          <svg width="9" height="6" viewBox="0 0 9 6" fill="currentColor" class="transition-transform duration-150" :class="{ '-rotate-90': isFolded(sourceFoldId(genreIndex, i)) }"><path d="M0 0h9L4.5 6z" /></svg>
        </button>

        <div class="flex-1 min-w-0">
          <SingleSelect :model-value="source.type" :options="typeOptions(source.type)" @update:model-value="changeType(i, $event)" />
        </div>

        <label class="flex items-center gap-1.5 shrink-0" v-tooltip="'고를 확률. 비우면 1'">
          <span class="text-[0.72rem] text-muted">가중치</span>
          <NumberInput :model-value="source.weight ?? null" placeholder="1" :class="[inputCls, 'w-16! text-center']" @update:model-value="setField(i, 'weight', $event)" />
        </label>

        <button :class="iconBtn" v-tooltip="'이 출처 삭제'" @click="remove(i)"><Icon name="trash" :size="14" /></button>
      </div>

      <div v-show="!isFolded(sourceFoldId(genreIndex, i))" class="px-2.5 pb-2.5">
        <p v-if="spec(source.type)?.hint" class="text-muted text-[0.75rem]">{{ spec(source.type).hint }}</p>
        <p v-if="typesState === 'loading'" class="text-muted text-[0.75rem]">출처 종류를 불러오는 중입니다.</p>
        <p v-else-if="typesState === 'failed'" class="text-[0.75rem] text-[#fbbf24]">출처 종류 목록을 받지 못했습니다. 새로 고치면 다시 받습니다.</p>
        <p v-else-if="!spec(source.type)" class="text-[0.75rem] text-[#f87171]">모르는 종류입니다. 이 봇이 지원하지 않습니다.</p>
        <p v-else-if="!spec(source.type).usable" class="text-[0.75rem] text-[#fbbf24]">{{ spec(source.type).needs }} 가 .env 에 없어 지금은 쓰이지 않습니다.</p>

        <!-- 칸 너비는 서버가 정한다(width). 짧은 칸이 한 줄을 다 먹을 이유가 없다 -->
        <div class="grid grid-cols-2 md:grid-cols-6 gap-x-2.5 gap-y-3 mt-2.5">
          <div v-for="field in shown(source)" :key="field.key" class="min-w-0" :class="widthCls(field)">
            <!-- 1/6 너비 칸은 설명을 붙이면 줄이 터진다. 툴팁으로 돌린다 -->
            <span :class="fieldLabelCls" v-tooltip="field.width === 'narrow' ? field.hint : ''">
              {{ field.label }}<span v-if="field.required" class="text-[#f87171]">*</span><span v-if="field.hint && field.width !== 'narrow'" class="text-muted font-normal ml-1">{{ field.hint }}</span>
            </span>

            <ChipInput v-if="field.kind === 'list'" :model-value="asList(source[field.key])" placeholder="하나씩 적고 Enter" @update:model-value="setField(i, field.key, $event.length ? $event : null)" />

            <MultiSelect v-else-if="field.kind === 'enumDrop'" :model-value="asList(source[field.key])" :options="field.options" @update:model-value="setField(i, field.key, $event.length ? $event : null)" />

            <TagPicker v-else-if="field.kind === 'enumSearch'" :model-value="asList(source[field.key])" :options="field.options" @update:model-value="setField(i, field.key, $event.length ? $event : null)" />

            <div v-else-if="field.kind === 'enumList'" class="flex flex-wrap gap-1.5">
              <button v-for="opt in field.options" :key="opt.value" type="button" :class="[pillCls, asList(source[field.key]).includes(opt.value) ? pillOn : pillOff]" @click="toggle(i, field.key, opt.value)">{{ opt.label }}</button>
            </div>

            <SingleSelect v-else-if="field.kind === 'enum'" :model-value="source[field.key] ?? ''" :options="field.options" :empty-label="field.emptyLabel || '비우기'" @update:model-value="setField(i, field.key, $event || null)" />

            <RangeSlider v-else-if="field.kind === 'range'" :min="field.min" :max="field.max" :from="source[field.key] ?? null" :to="source[field.to] ?? null" :label="field.label" :histogram="field.histogram || []" @update="setRange(i, field, $event)" />

            <NumberInput v-else-if="field.kind === 'number'" :model-value="source[field.key] ?? null" :class="inputCls" @update:model-value="setField(i, field.key, $event)" />

            <input v-else :value="source[field.key] ?? ''" type="text" :placeholder="field.kind === 'url' ? 'https://…' : ''" :class="inputCls" @input="setField(i, field.key, $event.target.value || null)" />
          </div>
        </div>

        <button v-if="deepCount(source.type)" :class="deepBtn" @click="toggleDeep(source._key)">
          {{ open.has(source._key) ? "접기" : `상세 설정 ${deepCount(source.type)}개 펼치기` }}
        </button>
        <p v-if="spec(source.type)?.window" class="text-muted text-[0.75rem] mt-1.5">곡이 너무 많으면 상위 {{ depthOf(source).toLocaleString("ko-KR") }}곡 중에서 고릅니다.</p>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <div class="flex-1">
        <SingleSelect v-model="adding" :options="addable.map((t) => ({ value: t.type, label: t.label }))" empty-label="출처 추가…" />
      </div>
      <button :class="iconBtn" :disabled="!adding" v-tooltip="'추가'" @click="add"><Icon name="add" :size="15" /></button>
    </div>
    <p v-if="!list.length" class="text-[0.78rem] mt-2 text-[#f87171]">출처가 하나는 있어야 합니다.</p>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import Icon from "./BaseIcon.vue";
import ChipInput from "./ChipInput.vue";
import RangeSlider from "./RangeSlider.vue";
import MultiSelect from "./MultiSelect.vue";
import SingleSelect from "./SingleSelect.vue";
import TagPicker from "./TagPicker.vue";
import NumberInput from "./NumberInput.vue";
import { isFolded, toggleFold, sourceFoldId } from "../composables/configFolds";

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  types: { type: Array, default: () => [] },
  // 종류 목록을 받는 중(loading) · 받음(ready) · 못 받음(failed). 받기 전에는 모르는 종류라고 하지 않는다
  typesState: { type: String, default: "ready" },
  genreIndex: { type: Number, default: 0 },
});
const emit = defineEmits(["update:modelValue"]);

// color-scheme: 날짜 같은 네이티브 위젯이 밝게 뜨는 것을 막는다
const inputCls = "bg-white/5 border border-white/9 rounded-lg text-fg px-2.5 py-2 text-[0.85rem] outline-none font-[inherit] w-full [color-scheme:dark] transition-[border-color] duration-150 focus:border-accent/55";
const fieldLabelCls = "block text-[0.75rem] font-semibold text-fg-soft mb-1";
// self-stretch: 옆 입력칸과 같은 높이로. 글자 크기를 건드려도 따라온다
const iconBtn = "self-stretch w-[38px] rounded-lg border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-colors duration-150 hover:bg-danger/15 hover:text-danger disabled:opacity-35 disabled:cursor-not-allowed";
const foldBtn = "size-6 rounded text-muted cursor-pointer flex items-center justify-center shrink-0 transition-colors duration-150 hover:text-fg hover:bg-white/8";
const pillCls = "px-2 py-1 rounded-md text-[0.75rem] border cursor-pointer transition-colors duration-150";
const pillOn = "bg-accent/25 border-accent/55 text-fg";
const pillOff = "bg-white/4 border-white/10 text-muted hover:bg-white/8";
const deepBtn = "mt-2.5 text-[0.75rem] text-muted cursor-pointer hover:text-fg-soft transition-colors duration-150";

// 모바일은 두 칸, 태블릿부터 여섯 칸짜리 격자다.
const WIDTHS = {
  narrow: "col-span-1", // 모바일 1/2, 그 위로 1/6
  half: "col-span-1 md:col-span-3", // 늘 반 줄
  halfWide: "col-span-2 md:col-span-3", // 모바일만 한 줄
};
const widthCls = (field) => WIDTHS[field.width] || "col-span-2 md:col-span-6";

// 편집 중 목록이 흔들리지 않게 행마다 값을 붙인다. 종류를 바꿔도 같은 행으로 남아야 한다.
//
// computed 로 두면 안 된다. get 이 매번 새 배열을 만드니 거기에 splice 해 봐야 set 이 안 불리고,
// _key 도 렌더마다 새로 붙어 입력칸이 포커스를 잃는다. 그래서 여기 두고 위에서 내려온 것만 맞춘다.
let serial = 0;
const list = ref([]);

// watch 가 immediate 로 바로 돌므로 그 전에 있어야 한다. 아래에 두면 TDZ 에 걸리는데,
// Vue 가 watcher 콜백의 예외를 잡아 콘솔에만 남기고 넘어가므로 화면은 멀쩡히 그려지고
// 목록만 빈 채로 "출처가 하나는 있어야 합니다"가 뜬다. 실제로 그렇게 한 번 당했다.
const clean = (one) => Object.fromEntries(Object.entries(one).filter(([k]) => k !== "_key"));
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

function remove(i) {
  list.value.splice(i, 1);
  push();
}

const open = ref(new Set());
const adding = ref("");

const spec = (type) => props.types.find((t) => t.type === type) || null;
const asList = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

// 쓸 수 있는 것만 고르게 한다. 다만 이미 쓰고 있는 종류는 목록에 남겨야 한다.
// 안 그러면 select 가 값을 잃고 저장할 때 조용히 바뀐다.
const addable = computed(() => props.types.filter((t) => t.usable));
const choosable = (current) => props.types.filter((t) => t.usable || t.type === current);
// 키가 없는 소스도 보이되 왜 못 쓰는지를 적어 둔다. 이미 고른 것이면 남아 있어야 한다
const typeOptions = (current) => choosable(current).map((t) => ({ value: t.type, label: `${t.label}${t.usable ? "" : " (키 없음)"}` }));

const fieldsOf = (type) => spec(type)?.fields || [];
const deepCount = (type) => fieldsOf(type).filter((f) => f.deep).length;
// when 이 있는 칸은 그 칸이 채워졌을 때만 뜬다. 분기는 연도를 자른 뒤에나 뜻이 있다
const shown = (source) => fieldsOf(source.type).filter((f) => (!f.deep || open.value.has(source._key)) && (!f.when || hasRange(source, f.when)));
// 구간은 두 칸으로 적히니 한쪽만 손으로 적어 둔 설정도 있다
const hasRange = (source, key) => source[key] != null || source[fieldsOf(source.type).find((f) => f.key === key)?.to] != null;

// 곡이 많을 때 몇 번째 곡까지 보는지. 셈은 서버와 같다(genreSources 의 windowDepth)
const filled = (v) => asList(v).some((one) => one != null && String(one).trim() !== "");
const depthOf = (source) => {
  const win = spec(source.type).window;
  return win.narrow.some((key) => filled(source[key])) ? win.narrowDepth : win.depth;
};

function toggleDeep(key) {
  const next = new Set(open.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  open.value = next;
}

function write(i, patch) {
  const row = list.value[i];
  for (const [k, v] of Object.entries(patch)) {
    // 비운 칸은 아예 지운다. YAML 에 `minScore: null` 같은 줄을 남기지 않는다
    if (v == null) delete row[k];
    else row[k] = v;
  }
  push();
}

const setField = (i, key, value) => write(i, { [key]: value });

// 구간은 두 칸을 한꺼번에 쓴다(yearFrom·yearTo).
// 전체로 되돌리면 그 구간에 딸린 칸도 비운다. 화면에서 사라진 값이 설정에 남으면 안 된다.
function setRange(i, field, range) {
  const patch = { [field.key]: range.from, [field.to]: range.to };
  if (range.from == null && range.to == null) {
    for (const dep of fieldsOf(list.value[i].type).filter((one) => one.when === field.key)) patch[dep.key] = null;
  }
  write(i, patch);
}

function toggle(i, key, opt) {
  const now = asList(list.value[i][key]);
  const next = now.includes(opt) ? now.filter((x) => x !== opt) : [...now, opt];
  setField(i, key, next.length ? next : null);
}

// 종류를 바꾸면 그 종류가 안 받는 칸은 버린다. 남겨 두면 저장할 때 검사에 걸린다
function changeType(i, type) {
  const keep = new Set(
    fieldsOf(type)
      .flatMap((f) => [f.key, f.to])
      .filter(Boolean),
  );
  const old = list.value[i];
  const kept = Object.fromEntries(Object.entries(old).filter(([k]) => keep.has(k) || k === "weight" || k === "_key"));
  list.value[i] = { ...kept, type };
  push();
}

function add() {
  if (!adding.value) return;
  list.value.push({ type: adding.value, _key: ++serial });
  adding.value = "";
  push();
}
</script>
