<!--
  자동재생 장르 편집기 (운영자 패널).

  이 설정은 파일(config/genres.yaml)로도 고칠 수 있다 — 대시보드는 선택 기능이다.
  그래서 저장은 파일을 통째로 덮지 않고 바뀐 자리만 고치며, 손으로 적은 주석은 그대로 남는다.
-->
<template>
  <div>
    <BaseCard icon="gear" title="자동재생 전역 설정" class="mb-3">
      <p class="text-muted text-[0.82rem] mt-1 mb-3">장르에 같은 항목을 적으면 그 장르에서만 덮어씁니다. 상한을 비우면 길이 제한이 없습니다.</p>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label class="block">
          <span :class="labelCls">대기열에 준비해 둘 곡 수</span>
          <input v-model.number="draft.defaults.prefetchCount" type="number" min="1" :class="inputCls" />
        </label>
        <label class="block">
          <span :class="labelCls">최소 길이(초)</span>
          <input v-model.number="draft.defaults.minDurationSec" type="number" min="0" :class="inputCls" />
        </label>
        <label class="block">
          <span :class="labelCls">최대 길이(초)</span>
          <input v-model="maxDurationText" inputmode="numeric" placeholder="제한 없음" :class="inputCls" />
        </label>
      </div>

      <div class="mt-4">
        <span :class="labelCls">차단어 - 제목에 해당 단어가 포함되면 선택하지 않습니다</span>
        <ChipInput v-model="draft.defaults.blockedKeywords" placeholder="차단할 말을 적고 Enter" />
      </div>
    </BaseCard>

    <BaseCard>
      <div class="flex items-start gap-3 mb-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] mb-2">
            <Icon name="music" :size="15" />
            <span>장르 ({{ rows.length }}/25)</span>
          </div>
          <p class="text-muted text-[0.82rem]">자동 재생은 지정한 키워드들 중 하나를 무작위로 선택해 검색에 사용합니다. 드래그해 순서를 바꿀 수 있습니다.</p>
        </div>
        <button :class="addBtn" :disabled="rows.length >= 25" v-tooltip="rows.length >= 25 ? '25개까지만 추가할 수 있습니다' : '장르 추가'" @click="addRow"><Icon name="add" :size="18" /></button>
      </div>

      <div
        v-for="(row, i) in rows"
        :key="row.key"
        class="border border-white/8 rounded-xl p-3 mb-2.5 bg-white/3 transition-[border-color,opacity] duration-150"
        :class="{
          'opacity-35': draggedIndex === i,
          'border-t-2 border-t-accent': dragOverIndex === i && draggedIndex !== i,
          'border-b-2 border-b-accent': dragOverIndex === rows.length && i === rows.length - 1,
        }"
        :draggable="dragReady"
        @dragstart="onDragStart($event, i)"
        @dragover.prevent="onDragOver($event, i)"
        @drop.prevent="onDrop"
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
          <EmojiInput v-model="row.emoji" />
          <input v-model="row.name" placeholder="장르 이름" :class="[inputCls, 'flex-1']" />
          <button :class="removeBtn" v-tooltip="'이 장르 삭제'" @click="rows.splice(i, 1)"><Icon name="trash" :size="15" /></button>
        </div>
        <ChipInput v-model="row.keywords" placeholder="검색어를 적고 Enter" />
      </div>

      <div v-if="problems.length" class="mt-3 text-[0.82rem] text-[#f87171]">
        <div v-for="p in problems" :key="p">· {{ p }}</div>
      </div>

      <p v-if="savedAt" class="mt-3 text-muted text-[0.8rem]">저장됨 — 다음 자동재생부터 반영됩니다</p>
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
import ChipInput from "./ChipInput.vue";
import EmojiInput from "./EmojiInput.vue";
import SaveDock from "./SaveDock.vue";

const inputCls = "w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2 text-[0.9rem] outline-none font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7";
const labelCls = "block text-[0.8rem] text-muted mb-1.5";
// 옆 입력칸과 같은 높이로 — py-2 + text-[0.9rem] 입력이 38px이다
const removeBtn = "h-[38px] w-[38px] rounded-xl border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color,border-color] duration-150 hover:bg-danger/15 hover:text-danger hover:border-danger/30";
const addBtn = "size-9 rounded-xl border border-white/9 bg-white/5 text-fg-soft cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color,opacity] duration-150 hover:not-disabled:bg-white/10 disabled:opacity-35 disabled:cursor-not-allowed";

const draft = ref({ defaults: {}, genres: {} });
const rows = ref([]);
const snapshot = ref("");
const saving = ref(false);
const savedAt = ref(null);
const loadError = ref("");
const serverProblems = ref([]);

// 편집 중에는 배열로 다룬다 — 맵으로 두면 이름을 고치는 순간 키가 바뀌어 입력이 튄다.
// 이름이 곧 키다. 따로 id를 두지 않는다.
let serial = 0;
const toRows = (genres) => Object.entries(genres || {}).map(([name, g]) => ({ key: ++serial, name, emoji: g.emoji || "", keywords: [...(g.keywords || [])] }));
const toMap = (list) => Object.fromEntries(list.map((r) => [r.name.trim(), { emoji: r.emoji, keywords: r.keywords }]));

// 상한은 비울 수 있다(제한 없음) — 빈 칸과 0을 가르려고 문자열로 다룬다.
const maxDurationText = computed({
  get: () => (draft.value.defaults.maxDurationSec == null ? "" : String(draft.value.defaults.maxDurationSec)),
  set: (v) => {
    const t = String(v).trim();
    draft.value.defaults.maxDurationSec = t === "" ? null : Number(t);
  },
});

const payload = computed(() => ({ defaults: draft.value.defaults, genres: toMap(rows.value) }));
const dirty = computed(() => JSON.stringify(payload.value) !== snapshot.value);

// 서버도 같은 것을 검사하지만, 저장 버튼을 누르기 전에 알려 주는 편이 낫다.
// 선택기로만 넣으니 여기서 걸릴 일은 없고, 파일을 손으로 고쳐 둔 경우를 잡는다.
const ONE_EMOJI = /^\p{RGI_Emoji}$/v;
const problems = computed(() => {
  const found = [];
  const names = rows.value.map((r) => r.name.trim());
  if (rows.value.length > 25) found.push("장르는 25개까지만 메뉴에 나옵니다.");
  if (names.some((name) => !name)) found.push("이름이 빈 장르가 있습니다.");
  if (new Set(names).size !== names.length) found.push("이름이 겹칩니다.");
  if (names.some((name) => ["true", "false", "null"].includes(name))) found.push("true·false·null 은 이름으로 쓸 수 없습니다.");
  // 숫자만으로 된 이름은 끌어 옮긴 차례가 조용히 어긋난다 — 서버도 같은 것을 막는다
  for (const name of names.filter((n) => /^(0|[1-9][0-9]*)$/.test(n))) found.push(`"${name}": 숫자만으로 된 이름은 차례가 어긋납니다. "${name}년대"처럼 글자를 붙여 주세요.`);
  for (const r of rows.value) {
    if (r.name.trim() && !r.keywords.length) found.push(`${r.name}: 검색어가 하나는 있어야 합니다.`);
    if (r.emoji && !ONE_EMOJI.test(r.emoji)) found.push(`${r.name || "이름 없는 장르"}: 이모지가 아닌 값이 들어 있습니다.`);
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
  draggedIndex.value = i;
  e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e, i) {
  const rect = e.currentTarget.getBoundingClientRect();
  dragOverIndex.value = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
}

function onDrop() {
  const from = draggedIndex.value;
  const to = dragOverIndex.value;
  if (from == null || to == null) return;
  const [moved] = rows.value.splice(from, 1);
  // 앞에서 빼면 뒤쪽 자리가 하나씩 당겨진다
  rows.value.splice(to > from ? to - 1 : to, 0, moved);
  onDragEnd();
}

function onDragEnd() {
  disarmDrag();
  draggedIndex.value = null;
  dragOverIndex.value = null;
}

function addRow() {
  rows.value.push({ key: ++serial, name: "", emoji: "", keywords: [] });
}

function apply(data) {
  draft.value = { defaults: { prefetchCount: 1, minDurationSec: 30, maxDurationSec: null, blockedKeywords: [], ...(data.defaults || {}) }, genres: data.genres || {} };
  rows.value = toRows(data.genres);
  snapshot.value = JSON.stringify(payload.value);
}

async function fetchConfig() {
  loadError.value = "";
  try {
    const res = await axios.get("/api/admin/config/genres");
    apply(res.data.data);
  } catch (error) {
    loadError.value = error.response?.data?.error || "설정을 읽지 못했습니다.";
  }
}

async function save() {
  saving.value = true;
  serverProblems.value = [];
  try {
    const res = await axios.put("/api/admin/config/genres", { data: payload.value });
    apply(res.data.data);
    savedAt.value = Date.now();
  } catch (error) {
    serverProblems.value = error.response?.data?.problems || [error.response?.data?.error || "저장하지 못했습니다."];
  } finally {
    saving.value = false;
  }
}

function revert() {
  const back = JSON.parse(snapshot.value);
  apply(back);
}

onMounted(fetchConfig);
</script>
