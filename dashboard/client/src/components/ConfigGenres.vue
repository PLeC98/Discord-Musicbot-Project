<!--
  자동재생 장르 편집기 (운영자 패널).

  이 설정은 파일(config/genres.yaml)로도 고칠 수 있다 — 대시보드는 선택 기능이다.
  그래서 저장은 파일을 통째로 덮지 않고 바뀐 자리만 고치며, 손으로 적은 주석은 그대로 남는다.
-->
<template>
  <div>
    <BaseCard icon="gear" title="자동재생 기본값" class="mb-3">
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

    <BaseCard icon="music" :title="`장르 (${rows.length}/25)`">
      <p class="text-muted text-[0.82rem] mt-1 mb-3">자동 재생은 지정한 키워드들 중 하나를 무작위로 선택해 검색에 사용합니다.</p>

      <div v-for="(row, i) in rows" :key="row.key" class="border border-white/8 rounded-xl p-3 mb-2.5 bg-white/3">
        <div class="flex items-center gap-2 mb-2">
          <input v-model="row.emoji" placeholder="🎵" :class="[inputCls, 'w-11! px-2! text-center']" />
          <input v-model="row.name" placeholder="장르 이름" :class="[inputCls, 'flex-1']" />
          <button :class="removeBtn" v-tooltip="'이 장르 삭제'" @click="rows.splice(i, 1)"><Icon name="trash" :size="14" /></button>
        </div>
        <ChipInput v-model="row.keywords" placeholder="검색어를 적고 Enter" />
      </div>

      <BaseButton variant="ghost" :disabled="rows.length >= 25" @click="addRow">장르 추가</BaseButton>

      <div v-if="problems.length" class="mt-3 text-[0.82rem] text-[#f87171]">
        <div v-for="p in problems" :key="p">· {{ p }}</div>
      </div>

      <div class="flex gap-2.5 mt-4">
        <BaseButton variant="primary" :disabled="!dirty || saving || problems.length > 0" @click="save">{{ saving ? "저장 중..." : "저장" }}</BaseButton>
        <BaseButton variant="ghost" :disabled="!dirty || saving" @click="revert">되돌리기</BaseButton>
        <span v-if="savedAt" class="self-center text-muted text-[0.8rem]">저장됨 — 다음 자동재생부터 반영됩니다</span>
      </div>

      <p v-if="loadError" class="mt-3 text-[0.82rem] text-[#f87171]">{{ loadError }}</p>
    </BaseCard>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import ChipInput from "./ChipInput.vue";

const inputCls = "w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2 text-[0.9rem] outline-none font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7";
const labelCls = "block text-[0.8rem] text-muted mb-1.5";
const removeBtn = "size-8 rounded-lg text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color] duration-150 hover:bg-danger/15 hover:text-danger";

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
const problems = computed(() => {
  const found = [];
  const names = rows.value.map((r) => r.name.trim());
  if (rows.value.length > 25) found.push("장르는 25개까지만 메뉴에 나옵니다.");
  if (names.some((name) => !name)) found.push("이름이 빈 장르가 있습니다.");
  if (new Set(names).size !== names.length) found.push("이름이 겹칩니다.");
  if (names.some((name) => ["true", "false", "null"].includes(name))) found.push("true·false·null 은 이름으로 쓸 수 없습니다.");
  for (const r of rows.value) {
    if (r.name.trim() && !r.keywords.length) found.push(`${r.name}: 검색어가 하나는 있어야 합니다.`);
  }
  return [...found, ...serverProblems.value];
});

watch(payload, () => {
  savedAt.value = null;
  serverProblems.value = [];
});

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
