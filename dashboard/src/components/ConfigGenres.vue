<!--
  자동재생 장르 편집기 (운영자 패널).

  이 설정은 파일(config/genres.yaml)로도 고칠 수 있다. 대시보드는 선택 기능이다.
  그래서 저장은 파일을 통째로 덮지 않고 바뀐 자리만 고치며, 손으로 적은 주석은 그대로 남는다.
-->
<template>
  <div>
    <BaseCard icon="gear" title="자동재생 전역 설정" class="mb-3">
      <p class="text-muted text-[0.82rem] mt-1 mb-3">최소 · 최대 길이와 차단어는 장르마다 따로 적을 수 있습니다(장르 칸을 비우면 여기 값). 상한을 비우면 길이 제한이 없습니다.</p>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label class="block">
          <span :class="labelCls">대기열에 준비해 둘 곡 수(전역만)</span>
          <NumberInput v-model="draft.defaults.prefetchCount" :class="inputCls" />
        </label>
        <label class="block">
          <span :class="labelCls">최소 길이(초)</span>
          <NumberInput v-model="draft.defaults.minDurationSec" :class="inputCls" />
        </label>
        <label class="block">
          <span :class="labelCls">최대 길이(초)</span>
          <NumberInput v-model="draft.defaults.maxDurationSec" placeholder="제한 없음" :class="inputCls" />
        </label>
      </div>

      <div class="mt-4">
        <span :class="labelCls">차단어 - 제목에 해당 단어가 포함되면 선택하지 않습니다</span>
        <ChipInput v-model="draft.defaults.blockedKeywords" lowercase placeholder="차단할 말을 적고 Enter" />
      </div>
    </BaseCard>

    <BaseCard>
      <div class="flex items-start gap-3 mb-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] mb-2">
            <Icon name="music" :size="15" />
            <span>장르 ({{ rows.length }}/{{ SELECT_MAX }})</span>
          </div>
          <p class="text-muted text-[0.82rem]">장르마다 곡을 가져올 출처를 여럿 둘 수 있습니다. 가중치에 따라 골라 쓰고, 곡을 주지 않는 출처가 있으면 다음 출처로 넘어갑니다. 드래그해 순서를 바꿀 수 있습니다.</p>
        </div>
        <button :class="addBtn" :disabled="rows.length >= SELECT_MAX" v-tooltip="rows.length >= SELECT_MAX ? `${SELECT_MAX}개까지만 추가할 수 있습니다` : '장르 추가'" @click="addRow"><Icon name="add" :size="18" /></button>
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
        @dragover="onDragOver($event, i)"
        @drop="onDrop"
        @dragend="onDragEnd"
      >
        <!-- 아래 여백은 펼쳐졌을 때만 필요하다. 여기에 두면 접었을 때 아래쪽만 넓어진다 -->
        <div class="flex items-center gap-2">
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
          <button :class="foldBtn" v-tooltip="isFolded(genreFoldId(i)) ? '펼치기' : '접기'" @click="toggleFold(genreFoldId(i))">
            <svg width="11" height="7" viewBox="0 0 9 6" fill="currentColor" class="transition-transform duration-150" :class="{ '-rotate-90': isFolded(genreFoldId(i)) }"><path d="M0 0h9L4.5 6z" /></svg>
          </button>
          <EmojiInput v-model="row.emoji" />
          <input v-model="row.name" placeholder="장르 이름" :class="[inputCls, 'flex-1']" />
          <!-- 접어 두면 출처가 아예 안 보인다. 몇 개인지는 접힌 채로도 알려 준다 -->
          <span v-if="isFolded(genreFoldId(i))" class="text-[0.78rem] shrink-0" :class="row.sources.length ? 'text-muted' : 'text-[#f87171]'">출처 {{ row.sources.length }}개</span>
          <button :class="removeBtn" v-tooltip="'삭제'" @click="removeRow(i)"><Icon name="trash" :size="15" /></button>
        </div>
        <SourceEditor v-show="!isFolded(genreFoldId(i))" v-model="row.sources" :types="sourceTypes" :types-state="sourceTypesState" :types-error="sourceTypesError" :suggest="suggestFor" :genre-index="i" class="mt-2" />
        <!-- 이 장르만의 값. 비우면 전역 값을 쓴다(utils/genre-rows) -->
        <div v-show="!isFolded(genreFoldId(i))" class="mt-3 pt-3 border-t border-white/6">
          <p class="text-muted text-[0.78rem] mb-2">이 장르만의 값 - 비우면 위 전역 값을 씁니다</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span :class="labelCls">최소 길이(초)</span>
              <NumberInput v-model="row.minDurationSec" :placeholder="`전역 ${draft.defaults.minDurationSec ?? 0}`" :class="inputCls" />
            </label>
            <label class="block">
              <span :class="labelCls">최대 길이(초)</span>
              <NumberInput v-model="row.maxDurationSec" :placeholder="draft.defaults.maxDurationSec ? `전역 ${draft.defaults.maxDurationSec}` : '전역 제한 없음'" :class="inputCls" />
            </label>
          </div>
          <div class="mt-3">
            <span :class="labelCls">차단어 - 적으면 전역 차단어 대신 이것만 씁니다</span>
            <ChipInput v-model="row.blockedKeywords" lowercase placeholder="비우면 전역 차단어" />
          </div>
        </div>
      </div>

      <div v-if="problems.length" class="mt-3 text-[0.82rem] text-[#f87171]">
        <div v-for="p in problems" :key="p" class="whitespace-pre-line">· {{ p }}</div>
      </div>

      <p v-if="savedAt" class="mt-3 text-muted text-[0.8rem]">저장 완료. 다음 자동재생부터 반영됩니다</p>
      <p v-if="loadError" class="mt-3 text-[0.82rem] text-[#f87171] whitespace-pre-line">{{ loadError }}</p>
    </BaseCard>

    <SaveDock :dirty="dirty" :saving="saving" :blocked="problems.length > 0" @save="save" @revert="revert" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import ChipInput from "./ChipInput.vue";
import SourceEditor from "./SourceEditor.vue";
import NumberInput from "./NumberInput.vue";
import EmojiInput from "./EmojiInput.vue";
import SaveDock from "./SaveDock.vue";
import { isFolded, toggleFold, genreFoldId, reorderGenres } from "../composables/config-folds.ts";
import { configFileIo, useConfigFile } from "../composables/config-file.ts";
import { useDragReorder } from "../composables/drag-reorder.ts";
import { problemText } from "../utils/problem.ts";
import { toRows, toMap, newRow, type GenreData, type GenreRow } from "../utils/genre-rows.ts";
import { genreProblems } from "../../../src/config/schema/genres.ts";
import { SELECT_MAX } from "../../../src/rules/limits.ts";
import type { SourceTypeView } from "../../../src/config/schema/genre-sources.ts";
import type { SourceTypes, Suggestions } from "../../../src/dashboard/contract/admin.ts";

const inputCls = "w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2 text-[0.9rem] outline-none font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7";
const labelCls = "block text-[0.8rem] text-muted mb-1.5";
// 옆 입력칸과 같은 높이로. py-2 + text-[0.9rem] 입력이 38px이다
const removeBtn = "h-[38px] w-[38px] rounded-xl border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color,border-color] duration-150 hover:bg-danger/15 hover:text-danger hover:border-danger/30";
const foldBtn = "size-7 rounded-lg text-muted cursor-pointer flex items-center justify-center shrink-0 transition-colors duration-150 hover:text-fg hover:bg-white/8";
const addBtn = "size-9 rounded-xl border border-white/9 bg-white/5 text-fg-soft cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color,opacity] duration-150 hover:not-disabled:bg-white/10 disabled:opacity-35 disabled:cursor-not-allowed";

/** 전역 값(genres.yaml 의 defaults) */
type Defaults = { prefetchCount: number | null; minDurationSec: number | null; maxDurationSec: number | null; blockedKeywords: string[] } & Record<string, unknown>;

const draft = ref<{ defaults: Defaults; genres: Record<string, GenreData> }>({ defaults: { prefetchCount: 1, minDurationSec: 0, maxDurationSec: null, blockedKeywords: [] }, genres: {} });
const rows = ref<GenreRow[]>([]);
const sourceTypes = ref<SourceTypeView[]>([]);
const sourceTypesState = ref<"loading" | "ready" | "failed">("loading"); // 목록이 오기 전에는 "모르는 종류"로 판정하지 않는다
const sourceTypesError = ref("");

const payload = computed(() => ({ defaults: draft.value.defaults, genres: toMap(rows.value) }));

function apply(data: Record<string, unknown>) {
  // 파일에 칸이 없을 때의 값은 봇이 그때 쓰는 값과 같게(prefetchCount 1 은 player, minDurationSec 0 은 autoplay/filter).
  // 다른 값을 채워 두면 손대지 않고 저장해도 동작이 바뀐다
  const defaults: Defaults = { prefetchCount: 1, minDurationSec: 0, maxDurationSec: null, blockedKeywords: [], ...((data.defaults as Partial<Defaults> | undefined) || {}) };
  // 차단어는 제목을 소문자로 낮춰 견주므로, 적히는 값도 낮춰 둔다. 대문자로 적어 두면 아무것도 못 거른다
  defaults.blockedKeywords = [...new Set((defaults.blockedKeywords || []).map((k) => String(k).trim().toLowerCase()))];
  const genres = (data.genres as Record<string, GenreData> | undefined) || {};
  draft.value = { defaults, genres };
  rows.value = toRows(genres);
}

const { dirty, saving, savedAt, loadError, serverProblems, fetch, save, revert } = useConfigFile({ tab: "config", payload: () => payload.value, apply, ...configFileIo("genres") });

// 저장할 때 서버가 보는 검사 그대로(schema/genres). 저장 버튼을 누르기 전에 알려 준다
const problems = computed(() => [...genreProblems(payload.value), ...serverProblems.value]);

// ── 순서 바꾸기. 접어 둔 기억도 그 장르를 따라간다 ─────────────────────────
const { draggedIndex, dragOverIndex, dragReady, armDrag, onDragStart, onDragOver, onDrop, onDragEnd } = useDragReorder(rows, reorderGenres);

// 자동완성 후보. 브라우저가 저쪽에 바로 묻지 않고 서버를 거친다(GET /api/admin/source-suggest)
const suggestFor = async (type: string, field: string, term: string) => (await axios.get<Suggestions>("/api/admin/source-suggest", { params: { type, field, q: term } })).data.items || [];

function removeRow(i: number) {
  reorderGenres(rows.value.map((_, at) => at).filter((at) => at !== i));
  rows.value.splice(i, 1);
}

function addRow() {
  rows.value.push(newRow());
}

// 어떤 출처를 쓸 수 있고 무슨 칸을 받는지는 서버가 안다(.env 의 키 유무까지).
// 못 읽어도 편집은 막지 않는다. 그때는 이미 적혀 있는 것만 보이고 새로 고르지는 못한다.
async function fetchSourceTypes() {
  try {
    sourceTypes.value = (await axios.get<SourceTypes>("/api/admin/source-types")).data.types || [];
    sourceTypesState.value = "ready";
  } catch (error) {
    sourceTypes.value = [];
    sourceTypesState.value = "failed";
    sourceTypesError.value = problemText(error, "");
  }
}

onMounted(() => {
  void fetchSourceTypes();
  void fetch();
});
</script>
