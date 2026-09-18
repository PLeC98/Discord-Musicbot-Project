<!--
  장르 하나의 곡 출처 목록 편집기.

  무슨 종류가 있고 어떤 칸을 받는지는 서버가 준다(GET /api/admin/source-types → autoplaySources.catalog).
  화면이 목록을 따로 들고 있으면 소스를 더할 때 한쪽만 고치게 된다.

  .env 에 키가 없는 종류는 **고르는 칸에서 숨긴다.** 다만 이미 설정에 적혀 있으면 그대로 보인다 —
  안 그러면 저장하는 순간 조용히 지워진다.
-->
<template>
  <div>
    <div v-for="(source, i) in list" :key="source._key" class="border border-white/8 rounded-lg p-2.5 mb-2 bg-black/15">
      <div class="flex items-center gap-2">
        <select :value="source.type" :class="selectCls" @change="changeType(i, $event.target.value)">
          <option v-for="t in choosable(source.type)" :key="t.type" :value="t.type" :class="optionCls">{{ t.label }}{{ t.usable ? "" : " (키 없음)" }}</option>
        </select>

        <label class="flex items-center gap-1.5 shrink-0" v-tooltip="'고를 확률. 비우면 1'">
          <span class="text-[0.72rem] text-muted">비중</span>
          <input :value="source.weight ?? ''" type="number" min="1" placeholder="1" :class="[inputCls, 'w-16 text-center']" @input="setField(i, 'weight', numberOrNull($event.target.value))" />
        </label>

        <button :class="iconBtn" v-tooltip="'이 출처 삭제'" @click="remove(i)"><Icon name="trash" :size="14" /></button>
      </div>

      <p v-if="spec(source.type)?.hint" class="text-muted text-[0.75rem] mt-1.5">{{ spec(source.type).hint }}</p>
      <p v-if="!spec(source.type)" class="text-[0.75rem] mt-1.5 text-[#f87171]">모르는 종류입니다 — 이 봇이 지원하지 않습니다.</p>
      <p v-else-if="!spec(source.type).usable" class="text-[0.75rem] mt-1.5 text-[#fbbf24]">{{ spec(source.type).needs }} 가 .env 에 없어 지금은 쓰이지 않습니다.</p>
      <p v-if="eitherNote(source.type)" class="text-muted text-[0.75rem] mt-1">{{ eitherNote(source.type) }}</p>

      <div v-for="field in shown(source)" :key="field.key" class="mt-2.5">
        <span :class="fieldLabelCls">
          {{ field.label }}
          <span v-if="field.required" class="text-[#f87171]">*</span>
          <span v-if="field.hint" class="text-muted font-normal"> — {{ field.hint }}</span>
        </span>

        <ChipInput v-if="field.kind === 'list'" :model-value="asList(source[field.key])" :placeholder="`${field.label}를 적고 Enter`" @update:model-value="setField(i, field.key, $event.length ? $event : null)" />

        <div v-else-if="field.kind === 'enumList'" class="flex flex-wrap gap-1.5">
          <button v-for="opt in field.options" :key="opt" type="button" :class="[pillCls, asList(source[field.key]).includes(opt) ? pillOn : pillOff]" @click="toggle(i, field.key, opt)">{{ opt }}</button>
        </div>

        <select v-else-if="field.kind === 'enum'" :value="source[field.key] ?? ''" :class="selectCls" @change="setField(i, field.key, $event.target.value || null)">
          <option value="" :class="optionCls">(비움)</option>
          <option v-for="opt in field.options" :key="opt" :value="opt" :class="optionCls">{{ opt }}</option>
        </select>

        <input v-else :value="source[field.key] ?? ''" :type="field.kind === 'number' ? 'number' : 'text'" :min="field.min" :placeholder="field.kind === 'url' ? 'https://…' : ''" :class="inputCls" @input="setField(i, field.key, field.kind === 'number' ? numberOrNull($event.target.value) : $event.target.value || null)" />
      </div>

      <button v-if="deepCount(source.type)" :class="deepBtn" @click="toggleDeep(source._key)">
        {{ open.has(source._key) ? "자세한 설정 접기" : `자세한 설정 ${deepCount(source.type)}개 펼치기` }}
      </button>
    </div>

    <div class="flex items-center gap-2">
      <select v-model="adding" :class="[selectCls, 'flex-1']">
        <option value="" :class="optionCls">출처 추가…</option>
        <option v-for="t in addable" :key="t.type" :value="t.type" :class="optionCls">{{ t.label }}</option>
      </select>
      <button :class="iconBtn" :disabled="!adding" v-tooltip="'추가'" @click="add"><Icon name="add" :size="15" /></button>
    </div>
    <p v-if="!list.length" class="text-[0.78rem] mt-2 text-[#f87171]">출처가 하나는 있어야 합니다.</p>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import Icon from "./BaseIcon.vue";
import ChipInput from "./ChipInput.vue";

const props = defineProps({ modelValue: { type: Array, default: () => [] }, types: { type: Array, default: () => [] } });
const emit = defineEmits(["update:modelValue"]);

// color-scheme: 네이티브 목록이 밝게 뜨는 것을 막는다(option 은 CSS 로 못 꾸민다)
const inputCls = "bg-white/5 border border-white/9 rounded-lg text-fg px-2.5 py-1.5 text-[0.85rem] outline-none font-[inherit] w-full [color-scheme:dark] transition-[border-color] duration-150 focus:border-accent/55";
const selectCls = `${inputCls} appearance-none cursor-pointer pr-7`;
// option 은 네이티브로 그려져 부모 색을 물려받지 않는다 — 색을 직접 준다
const optionCls = "bg-[#141833] text-[#e7e9f3]";
const fieldLabelCls = "block text-[0.75rem] font-semibold text-fg-soft mb-1";
const iconBtn = "h-[32px] w-[32px] rounded-lg border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-colors duration-150 hover:bg-danger/15 hover:text-danger disabled:opacity-35 disabled:cursor-not-allowed";
const pillCls = "px-2 py-1 rounded-md text-[0.75rem] border cursor-pointer transition-colors duration-150";
const pillOn = "bg-accent/25 border-accent/55 text-fg";
const pillOff = "bg-white/4 border-white/10 text-muted hover:bg-white/8";
const deepBtn = "mt-2.5 text-[0.75rem] text-muted cursor-pointer hover:text-fg-soft transition-colors duration-150";

// 편집 중 목록이 흔들리지 않게 행마다 값을 붙인다 — 종류를 바꿔도 같은 행으로 남아야 한다.
//
// computed 로 두면 안 된다. get 이 매번 새 배열을 만드니 거기에 splice 해 봐야 set 이 안 불리고,
// _key 도 렌더마다 새로 붙어 입력칸이 포커스를 잃는다. 그래서 여기 두고 위에서 내려온 것만 맞춘다.
let serial = 0;
const list = ref([]);

// watch 가 immediate 로 바로 돌므로 **그 전에** 있어야 한다. 아래에 두면 TDZ 에 걸리는데,
// Vue 가 watcher 콜백의 예외를 잡아 콘솔에만 남기고 넘어가므로 **화면은 멀쩡히 그려지고
// 목록만 빈 채로** "출처가 하나는 있어야 합니다"가 뜬다 — 실제로 그렇게 한 번 당했다.
const clean = (one) => Object.fromEntries(Object.entries(one).filter(([k]) => k !== "_key"));
const push = () => emit("update:modelValue", list.value.map(clean));

watch(
  () => props.modelValue,
  (next) => {
    const incoming = next || [];
    // 우리가 방금 올려보낸 것이 그대로 내려온 것이면 건드리지 않는다 — 건드리면 _key 가 갈린다
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
const numberOrNull = (v) => (String(v).trim() === "" ? null : Number(v));

// 쓸 수 있는 것만 고르게 한다. 다만 이미 쓰고 있는 종류는 목록에 남겨야 한다 —
// 안 그러면 select 가 값을 잃고 저장할 때 조용히 바뀐다.
const addable = computed(() => props.types.filter((t) => t.usable));
const choosable = (current) => props.types.filter((t) => t.usable || t.type === current);

const eitherNote = (type) => {
  const groups = spec(type)?.either || [];
  if (!groups.length) return "";
  return groups.map((g) => `${g.join(" 또는 ")} 중 하나는 적어야 합니다`).join(" · ");
};

const deepCount = (type) => (spec(type)?.fields || []).filter((f) => f.deep).length;
const shown = (source) => (spec(source.type)?.fields || []).filter((f) => !f.deep || open.value.has(source._key));

function toggleDeep(key) {
  const next = new Set(open.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  open.value = next;
}

function write(i, patch) {
  const row = list.value[i];
  for (const [k, v] of Object.entries(patch)) {
    // 비운 칸은 아예 지운다 — YAML 에 `minScore: null` 같은 줄을 남기지 않는다
    if (v == null) delete row[k];
    else row[k] = v;
  }
  push();
}

const setField = (i, key, value) => write(i, { [key]: value });

function toggle(i, key, opt) {
  const now = asList(list.value[i][key]);
  const next = now.includes(opt) ? now.filter((x) => x !== opt) : [...now, opt];
  setField(i, key, next.length ? next : null);
}

// 종류를 바꾸면 그 종류가 안 받는 칸은 버린다 — 남겨 두면 저장할 때 검사에 걸린다
function changeType(i, type) {
  const keep = new Set((spec(type)?.fields || []).map((f) => f.key));
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
