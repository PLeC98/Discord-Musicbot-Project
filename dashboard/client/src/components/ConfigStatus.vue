<!--
  상태 문구 편집기 (운영자 패널).

  이 설정은 파일(config/status.yaml)로도 고칠 수 있다 — 대시보드는 선택 기능이다.
  그래서 저장은 파일을 통째로 덮지 않고 바뀐 자리만 고치며, 손으로 적은 주석은 그대로 남는다.
-->
<template>
  <div>
    <BaseCard icon="robot" title="상태 문구 전역 설정" class="mb-3">
      <p class="text-muted text-[0.82rem] mt-1 mb-3">디스코드 프로필에 뜨는 문구입니다. 아래 기간·시간대 문구 중 적용할 것이 없을 때 이 문구들을 번갈아 씁니다.</p>

      <label class="block mb-4 w-full">
        <span :class="labelCls">문구 변경 주기(초)</span>
        <NumberInput v-model="draft.interval" :class="inputCls" />
      </label>

      <MessageList v-model="messages" @add="messages.push(newMessage())" />
    </BaseCard>

    <BaseCard>
      <div class="flex items-start gap-3 mb-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] mb-2">
            <Icon name="gear" :size="15" />
            <span>기간 · 시간대 문구 ({{ special.length }})</span>
          </div>
          <p class="text-muted text-[0.82rem]">위에서부터 우선적으로 적용되며, 조건을 둘 이상 적으면 전부 일치해야 출력됩니다.</p>
        </div>
        <button :class="addBtn" v-tooltip="'항목 추가'" @click="addSpecial"><Icon name="add" :size="18" /></button>
      </div>

      <div
        v-for="(entry, i) in special"
        :key="entry.key"
        class="border border-white/8 rounded-xl p-3 mb-2.5 bg-white/3 transition-[border-color,opacity] duration-150"
        :class="{
          'opacity-35': draggedIndex === i,
          'border-t-2 border-t-accent': dragOverIndex === i && draggedIndex !== i,
          'border-b-2 border-b-accent': dragOverIndex === special.length && i === special.length - 1,
        }"
        :draggable="dragReady"
        @dragstart="onDragStart($event, i)"
        @dragover="onDragOver($event, i)"
        @drop="onDrop"
        @dragend="onDragEnd"
      >
        <div class="flex items-center gap-2 mb-2">
          <span class="text-muted cursor-grab active:cursor-grabbing opacity-35 hover:opacity-75 shrink-0 flex items-center px-0.5 transition-opacity duration-150 select-none" v-tooltip="'드래그하여 순서 변경'" @mousedown="armDrag">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
              <circle cx="2" cy="3" r="1.5" />
              <circle cx="2" cy="8" r="1.5" />
              <circle cx="2" cy="13" r="1.5" />
              <circle cx="8" cy="3" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="8" cy="13" r="1.5" />
            </svg>
          </span>
          <input v-model="entry.name" placeholder="항목 이름 (크리스마스)" :class="[inputCls, 'flex-1']" />
          <button :class="removeBtn" v-tooltip="'이 항목 삭제'" @click="special.splice(i, 1)"><Icon name="trash" :size="15" /></button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
          <label v-for="cond in CONDITIONS" :key="cond.key" class="block">
            <span :class="labelCls">{{ cond.label }}</span>
            <input v-model="entry[cond.key]" :placeholder="cond.placeholder" :class="[inputCls, 'font-mono text-[0.82rem]']" />
          </label>
        </div>

        <MessageList v-model="entry.messages" @add="entry.messages.push(newMessage())" />
      </div>

      <div v-if="problems.length" class="mt-3 text-[0.82rem] text-[#f87171]">
        <div v-for="p in problems" :key="p">· {{ p }}</div>
      </div>

      <p v-if="savedAt" class="mt-3 text-muted text-[0.8rem]">저장됨. 다음 회전부터 반영됩니다</p>
      <p v-if="loadError" class="mt-3 text-[0.82rem] text-[#f87171]">{{ loadError }}</p>
    </BaseCard>

    <SaveDock :dirty="dirty" :saving="saving" :blocked="problems.length > 0" @save="save" @revert="revert" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import SaveDock from "./SaveDock.vue";
import MessageList from "./StatusMessageList.vue";
import NumberInput from "./NumberInput.vue";

const inputCls = "w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2 text-[0.9rem] outline-none font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7";
const labelCls = "block text-[0.8rem] text-muted mb-1.5";
const removeBtn = "h-[38px] w-[38px] rounded-xl border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color,border-color] duration-150 hover:bg-danger/15 hover:text-danger hover:border-danger/30";
const addBtn = "size-9 rounded-xl border border-white/9 bg-white/5 text-fg-soft cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color] duration-150 hover:bg-white/10";

const CONDITIONS = [
  { key: "date", label: "양력", placeholder: "12-24 ~ 12-26" },
  { key: "lunar", label: "음력", placeholder: "01-01 ~ 01-15" },
  { key: "time", label: "시간대", placeholder: "22:00 ~ 06:00" },
];
const MAX_TEXT = 128;

const draft = ref({ interval: 60 });
const messages = ref([]);
const special = ref([]);
const snapshot = ref("");
const saving = ref(false);
const savedAt = ref(null);
const loadError = ref("");
const serverProblems = ref([]);

// 편집 중에는 배열로 다룬다 — 맵으로 두면 이름을 고치는 순간 키가 바뀌어 입력이 튄다.
let serial = 0;
const newMessage = () => ({ key: ++serial, text: "", type: "" });

// 문구는 그냥 한 줄로 적은 것과 풀어 적은 것이 섞여 있을 수 있다
const toMessages = (list) => (list || []).map((m) => (typeof m === "string" ? { key: ++serial, text: m, type: "" } : { key: ++serial, text: m?.text || "", type: m?.type || "" }));
const fromMessages = (list) => list.map((m) => (m.type ? { text: m.text, type: m.type } : m.text));

const toSpecial = (map) =>
  Object.entries(map || {}).map(([name, e]) => ({
    key: ++serial,
    name,
    date: e?.date || "",
    lunar: e?.lunar || "",
    time: e?.time || "",
    messages: toMessages(e?.messages),
  }));

const fromSpecial = (list) =>
  Object.fromEntries(
    list.map((e) => {
      const entry = {};
      for (const cond of CONDITIONS) if (e[cond.key]?.trim()) entry[cond.key] = e[cond.key].trim();
      entry.messages = fromMessages(e.messages);
      return [e.name.trim(), entry];
    }),
  );

const payload = computed(() => ({ interval: draft.value.interval, messages: fromMessages(messages.value), special: fromSpecial(special.value) }));
const dirty = computed(() => JSON.stringify(payload.value) !== snapshot.value);

// 서버도 같은 것을 검사하지만, 저장 버튼을 누르기 전에 알려 주는 편이 낫다.
const RANGE = { date: /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, lunar: /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, time: /^([01][0-9]|2[0-3]):[0-5][0-9]$/ };

function messageProblems(list, where) {
  const found = [];
  if (!list.length) found.push(`${where}: 문구가 하나는 있어야 합니다.`);
  for (const m of list) {
    if (!m.text.trim()) found.push(`${where}: 빈 문구가 있습니다.`);
    else if (m.text.length > MAX_TEXT) found.push(`${where}: 문구가 ${MAX_TEXT}자를 넘습니다.`);
  }
  return found;
}

const problems = computed(() => {
  const found = [];
  if (!(Number(draft.value.interval) >= 10)) found.push("간격은 10초 이상이어야 합니다.");
  found.push(...messageProblems(messages.value, "평소 문구"));

  const names = special.value.map((e) => e.name.trim());
  if (names.some((n) => !n)) found.push("이름이 빈 항목이 있습니다.");
  if (new Set(names).size !== names.length) found.push("이름이 겹칩니다.");

  for (const entry of special.value) {
    const name = entry.name.trim() || "이름 없는 항목";
    if (["true", "false", "null"].includes(name)) found.push(`"${name}"는 이름으로 쓸 수 없습니다.`);
    if (/^(0|[1-9][0-9]*)$/.test(name)) found.push(`"${name}": 숫자만으로 된 이름은 차례가 어긋납니다.`);

    const filled = CONDITIONS.filter((c) => entry[c.key]?.trim());
    if (!filled.length) found.push(`${name}: 양력·음력·시간대 중 하나는 적어야 합니다.`);

    for (const cond of filled) {
      const parts = entry[cond.key].split("~").map((p) => p.trim());
      if (parts.length !== 2 || parts.some((p) => !RANGE[cond.key].test(p))) found.push(`${name}의 ${cond.label}: "${cond.placeholder}"처럼 두 자리로 적어야 합니다.`);
    }

    found.push(...messageProblems(entry.messages, name));
  }

  return [...found, ...serverProblems.value];
});

watch(payload, () => {
  savedAt.value = null;
  serverProblems.value = [];
});

// ── 순서 바꾸기 — 대기열 목록과 같은 방식 ─────────────────────────────────
const draggedIndex = ref(null);
const dragOverIndex = ref(null);

// 카드를 늘 draggable로 두면 입력칸의 글자를 끌어 고를 수 없다(브라우저가 카드 드래그로 가로챈다).
// 그렇다고 dragstart에서 가릴 수도 없다 — dragstart는 draggable인 요소에서 나므로 target이 언제나 카드다.
// 그래서 손잡이를 누르고 있는 동안에만 draggable을 켠다.
const dragReady = ref(false);

function armDrag() {
  dragReady.value = true;
  // 누르기만 하고 끌지 않은 경우까지 풀어 준다 — 안 풀면 다음에 입력칸을 끌 때 카드가 따라온다
  window.addEventListener("mouseup", disarmDrag, { once: true });
}

function disarmDrag() {
  dragReady.value = false;
}

function onDragStart(e, i) {
  // dragstart는 위로 퍼진다 — 칸 안의 글자를 끄는 것도 여기까지 올라온다.
  // 카드 자신이 끌리기 시작한 것만 받는다(글자 드래그는 target이 그 칸이다).
  if (e.target !== e.currentTarget) return;
  draggedIndex.value = i;
  e.dataTransfer.effectAllowed = "move";
}

// 카드가 draggable이 아니어도 dragover·drop은 지나가는 모든 드래그에 반응한다.
// 칸 안의 글자를 끌면 그것도 여기로 들어와 엉뚱한 자리에 삽입선이 떴다 — 우리 것만 받는다.
function ours() {
  return draggedIndex.value != null;
}

function onDragOver(e, i) {
  if (!ours()) return;
  e.preventDefault(); // 여기에 놓을 수 있다고 알린다
  const rect = e.currentTarget.getBoundingClientRect();
  dragOverIndex.value = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
}

function onDrop(e) {
  if (!ours()) return;
  e.preventDefault();
  const from = draggedIndex.value;
  const to = dragOverIndex.value;
  if (from == null || to == null) return;
  const [moved] = special.value.splice(from, 1);
  // 앞에서 빼면 뒤쪽 자리가 하나씩 당겨진다
  special.value.splice(to > from ? to - 1 : to, 0, moved);
  onDragEnd();
}

function onDragEnd() {
  disarmDrag();
  draggedIndex.value = null;
  dragOverIndex.value = null;
}

function addSpecial() {
  special.value.push({ key: ++serial, name: "", date: "", lunar: "", time: "", messages: [newMessage()] });
}

function apply(data) {
  draft.value = { interval: data.interval ?? 60 };
  messages.value = toMessages(data.messages);
  special.value = toSpecial(data.special);
  snapshot.value = JSON.stringify(payload.value);
}

async function fetchConfig() {
  loadError.value = "";
  try {
    const res = await axios.get("/api/admin/config/status");
    apply(res.data.data);
  } catch (error) {
    loadError.value = error.response?.data?.error || "설정을 읽지 못했습니다.";
  }
}

async function save() {
  saving.value = true;
  serverProblems.value = [];
  try {
    const res = await axios.put("/api/admin/config/status", { data: payload.value });
    apply(res.data.data);
    savedAt.value = Date.now();
  } catch (error) {
    serverProblems.value = error.response?.data?.problems || [error.response?.data?.error || "저장하지 못했습니다."];
  } finally {
    saving.value = false;
  }
}

function revert() {
  apply(JSON.parse(snapshot.value));
}

onMounted(fetchConfig);
</script>
