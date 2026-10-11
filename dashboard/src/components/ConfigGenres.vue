<!--
  자동재생 장르 편집기 (운영자 패널).

  설정은 settings.db 의 "genres" 문서다. 저장 번호로 두 탭이 서로 덮지 않게 한다(composables/config-file).
-->
<template>
  <!-- 목록(첫 줄 "전역 설정", 그 아래 장르들) · 고른 것의 편집(M3 목록 · 상세). 넓으면(52rem 이상) 두 단, 좁으면 한 단씩:
       목록에서 누르면 편집이 목록 자리를 넘겨받고, 방문 기록이 한 칸 쌓여 OS · 브라우저의 뒤로가기가 목록으로 돌아온다.
       고른 것은 주소(?genre=이름, 이름이 비었거나 겹치면 @자리, 전역 설정은 @defaults)에 둬 새로고침 · 저장 뒤에도 다시 찾는다 -->
  <div class="flex flex-col gap-(--gap-in)">
    <div ref="paneEl" :class="paneClass">
      <!-- 장르 목록. 두 단이면 내려도 제자리에 붙어 있고, 길면 그 안에서 구른다 -->
      <BaseCard v-if="showList" icon="library_music" :title="T.listTitle(rows.length, SELECT_MAX)" :class="listCardClass">
        <template #actions>
          <button type="button" :class="[ICON_BTN, 'size-8']" :disabled="rows.length >= SELECT_MAX" :aria-label="T.addGenre" v-tooltip="rows.length >= SELECT_MAX ? T.atMost(SELECT_MAX) : text.common.add" @click="addRow"><Icon name="add" :size="20" /></button>
        </template>
        <p class="mb-3 text-sm text-on-surface-variant">{{ T.desc }}</p>
        <!-- 어느 줄의 것도 아닌 문제(저장할 때 서버가 짚은 것 등) · 읽기 실패. 줄마다의 문제는 그 줄의 오류 아이콘과 편집 칸 맨 위에 -->
        <NoticeBox v-if="listProblems.length" variant="note" tone="error" icon="error" class="mt-0! mb-3">{{ listProblems.join("\n") }}</NoticeBox>
        <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0! mb-3">{{ loadError }}</NoticeBox>
        <div ref="listEl" class="min-h-0 overflow-y-auto -mx-2 px-2" :style="listFade">
          <!-- 첫 줄: 전역 설정. 누르면 상세 자리에 전역 값(손잡이 자리는 비워 장르 줄과 아이콘 줄을 맞춘다) -->
          <div role="button" tabindex="0" :class="[LIST_ROW, globalOn && SELECT_ROW_ON]" :aria-current="globalOn ? 'true' : undefined" @click="openGlobal" @keydown.enter="openGlobal">
            <span class="size-5 shrink-0" />
            <Icon name="tune" :size="24" class="shrink-0" :class="!globalOn && 'text-on-surface-variant'" />
            <span class="min-w-0 flex-1 truncate">{{ T.global }}</span>
            <Icon v-if="globalProblems.length" name="error" :size="20" fill class="shrink-0" :class="!globalOn && 'text-error'" v-tooltip="globalProblems.join('\n')" />
            <Icon name="chevron_right" :size="20" class="shrink-0 -mr-1" :class="!globalOn && 'text-on-surface-variant'" />
          </div>
          <div class="h-px my-1 mx-3 bg-outline-variant/40" />
          <div v-for="(row, i) in rows" :key="row.key" role="button" tabindex="0" :class="[LIST_ROW, isOn(i) && SELECT_ROW_ON]" :aria-current="isOn(i) ? 'true' : undefined" data-reorder @click="select(i)" @keydown.enter="select(i)">
            <span class="shrink-0 flex touch-none cursor-grab active:cursor-grabbing" :class="isOn(i) ? '' : 'text-outline'" v-tooltip="T.dragToReorder" @pointerdown="startDrag($event, i)" @click.stop><Icon name="drag_indicator" :size="20" /></span>
            <Twemoji v-if="row.emoji" :char="row.emoji" :size="24" class="shrink-0" />
            <Icon v-else name="music_note" :size="24" class="shrink-0" :class="!isOn(i) && 'text-on-surface-variant'" />
            <span class="min-w-0 flex-1 truncate" :class="!row.name.trim() && !isOn(i) && 'text-on-surface-variant'">{{ row.name.trim() || T.noName }}</span>
            <!-- 오른쪽 끝: 문제(오류) 또는 경고(쓰이지 않는 출처 등) · 출처 수 · 열린다는 꺾쇠. 아이콘에 올리면 까닭 -->
            <Icon v-if="rowProblem(row)" name="error" :size="20" fill class="shrink-0" :class="!isOn(i) && 'text-error'" v-tooltip="rowProblem(row)" />
            <Icon v-else-if="rowWarning(row)" name="warning" :size="20" fill class="shrink-0" :class="!isOn(i) && 'text-(--warn-ink)'" v-tooltip="rowWarning(row)" />
            <span class="shrink-0 text-xs nums" :class="!isOn(i) && 'text-on-surface-variant'">{{ T.sourceCount(row.sources.length) }}</span>
            <Icon name="chevron_right" :size="20" class="shrink-0 -mr-1" :class="!isOn(i) && 'text-on-surface-variant'" />
          </div>
          <p v-if="loaded && !rows.length" class="py-3 text-sm text-on-surface-variant">{{ T.empty }}</p>
        </div>
      </BaseCard>

      <!-- 전역 설정 편집 -->
      <BaseCard v-if="showGlobal">
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-3 min-h-10">
            <span class="size-10 shrink-0 rounded-(--r-inner) bg-surface-container-highest flex items-center justify-center text-on-surface-variant"><Icon name="tune" :size="24" /></span>
            <h3 class="flex-1 min-w-0 truncate text-base font-semibold text-on-surface">{{ T.global }}</h3>
          </div>
          <NoticeBox v-if="globalProblems.length" variant="note" tone="error" icon="error" class="mt-0!">{{ globalProblems.join("\n") }}</NoticeBox>
          <GenreGlobalForm v-model="draft.defaults" />
        </div>
      </BaseCard>

      <!-- 고른 장르 편집 -->
      <BaseCard v-if="selected">
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-3">
            <EmojiInput v-model="selected.emoji" />
            <input :value="selected.name" :placeholder="T.namePlaceholder" :class="[FIELD, 'min-w-0 flex-1']" @input="selected.name = valueOf($event)" />
            <button type="button" :class="[ICON_BTN, 'size-8', 'hover:text-error']" :aria-label="T.removeGenre" v-tooltip="text.common.remove" @click="removeRow(selectedIndex)"><Icon name="delete" :size="20" /></button>
          </div>
          <NoticeBox v-if="rowProblems(selected).length" variant="note" tone="error" icon="error" class="mt-0!">{{ rowProblems(selected).join("\n") }}</NoticeBox>

          <section class="flex flex-col gap-2">
            <div>
              <h3 class="text-sm font-semibold text-on-surface">{{ T.sources }}</h3>
              <p class="mt-1 text-xs text-on-surface-variant">{{ T.sourcesDesc }}</p>
            </div>
            <SourceEditor :key="selected.key" v-model="selected.sources" :types="sourceTypes" :types-state="sourceTypesState" :types-error="sourceTypesError" :suggest="suggestFor" :genre-index="selectedIndex" />
          </section>

          <!-- 전역 설정 오버라이드: 적은 칸만 이 장르에서 전역 값을 대신한다. 비우면 전역 값(utils/genre-rows). 차단어는 키워드 출처마다 둔다(SourceEditor) -->
          <section class="flex flex-col gap-2 pt-3 border-t border-outline-variant/40">
            <h3 class="text-sm font-semibold text-on-surface">{{ T.overrides }}</h3>
            <div class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
              <label class="block">
                <span :class="FIELD_LABEL">{{ T.minDuration }}</span>
                <NumberInput v-model="selected.minDurationSec" :placeholder="T.currentGlobal(draft.defaults.minDurationSec ?? GENRE_DEFAULTS.minDurationSec)" :class="[FIELD, 'w-full']" />
              </label>
              <label class="block">
                <span :class="FIELD_LABEL">{{ T.maxDuration }}</span>
                <NumberInput v-model="selected.maxDurationSec" :placeholder="draft.defaults.maxDurationSec ? T.currentGlobal(draft.defaults.maxDurationSec) : T.noGlobalLimit" :class="[FIELD, 'w-full']" />
              </label>
            </div>
          </section>
        </div>
      </BaseCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import { valueOf } from "../utils/dom.ts";
import { ref, computed, onMounted } from "vue";
import GenreGlobalForm from "./GenreGlobalForm.vue";
import { useListDetail, LIST_ROW } from "../composables/list-detail.ts";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import SourceEditor from "./SourceEditor.vue";
import NumberInput from "./NumberInput.vue";
import EmojiInput from "./EmojiInput.vue";
import NoticeBox from "./NoticeBox.vue";
import Twemoji from "./TwemojiImage.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { SELECT_ROW_ON } from "../utils/select-row.ts";
import { useScrollFade } from "../composables/scroll-fade.ts";
import { reorderGenres } from "../composables/config-folds.ts";
import { configFileIo, useConfigFile } from "../composables/config-file.ts";
import { useSaveTarget } from "../composables/save-targets.ts";
import { useDragReorder } from "../composables/drag-reorder.ts";
import { problemText } from "../utils/problem.ts";
import { toRows, toMap, newRow, type GenreData, type GenreRow } from "../utils/genre-rows.ts";
import { genreProblems, GENRE_DEFAULTS } from "../../../src/config/schema/genres.ts";
import { SELECT_MAX } from "../../../src/rules/limits.ts";
import type { SourceTypeView } from "../../../src/config/schema/genre-sources.ts";
import type { SourceTypes, Suggestions } from "../../../src/dashboard/contract/admin.ts";
import { text } from "../text/index.ts";
const T = text.genres;

/** 전역 값(장르 설정의 defaults) */
type Defaults = { prefetchCount: number | null; minDurationSec: number | null; maxDurationSec: number | null; blockedKeywords: string[] } & Record<string, unknown>;

const draft = ref<{ defaults: Defaults; genres: Record<string, GenreData> }>({ defaults: { ...GENRE_DEFAULTS, blockedKeywords: [] }, genres: {} });
const rows = ref<GenreRow[]>([]);
const sourceTypes = ref<SourceTypeView[]>([]);
const sourceTypesState = ref<"loading" | "ready" | "failed">("loading"); // 목록이 오기 전에는 "모르는 종류"로 판정하지 않는다
const sourceTypesError = ref("");

const payload = computed(() => ({ defaults: draft.value.defaults, genres: toMap(rows.value) }));

function apply(data: Record<string, unknown>) {
  // 파일에 칸이 없을 때의 값은 봇이 그때 쓰는 값(schema/genres 의 GENRE_DEFAULTS). 다른 값을 채워 두면 손대지 않고 저장해도 동작이 바뀐다
  const defaults: Defaults = { ...GENRE_DEFAULTS, blockedKeywords: [], ...((data.defaults as Partial<Defaults> | undefined) || {}) };
  // 차단어는 제목을 소문자로 낮춰 견주므로, 적히는 값도 낮춰 둔다. 대문자로 적어 두면 아무것도 못 거른다
  defaults.blockedKeywords = [...new Set((defaults.blockedKeywords || []).map((k) => String(k).trim().toLowerCase()))];
  const genres = (data.genres as Record<string, GenreData> | undefined) || {};
  draft.value = { defaults, genres };
  rows.value = toRows(genres);
}

const { loaded, dirty, saving, loadError, serverProblems, fetch, save, revert } = useConfigFile({ tab: "autoplay", savedNote: T.savedNote, payload: () => payload.value, apply, ...configFileIo("genres") });

// 저장할 때 서버가 보는 검사 그대로(schema/genres). 저장 버튼을 누르기 전에 알려 준다
const problems = computed(() => (loaded.value ? [...genreProblems(payload.value), ...serverProblems.value] : []));
// 운영자 패널의 저장 막대에 올린다(검사에 걸린 값이 있으면 막대가 저장을 막는다)
useSaveTarget({ tab: "autoplay", dirty, saving, blocked: computed(() => problems.value.length > 0), save: () => save(), revert });

// ── 순서 바꾸기. 접어 둔 기억도 그 장르를 따라간다 ─────────────────────────
const { startDrag } = useDragReorder(rows, reorderGenres);

// 자동완성 후보. 브라우저가 저쪽에 바로 묻지 않고 서버를 거친다(GET /api/admin/source-suggest)
const suggestFor = async (type: string, field: string, term: string) => (await axios.get<Suggestions>("/api/admin/source-suggest", { params: { type, field, q: term } })).data.items || [];

// ── 목록 · 상세(composables/list-detail). 주소는 ?genre= ─────────────────────────
const paneEl = ref<HTMLElement | null>(null);
const { listCardClass, paneClass, selectedIndex, selected, showGlobal, showList, isOn, globalOn, select, openGlobal, afterRemove } = useListDetail({ param: "genre", rows, paneEl });
const listEl = ref<HTMLElement | null>(null);
// 더 있는 쪽 끝 반 줄(24)을 흐리게
const listFade = useScrollFade(listEl, () => true, 24);

// 줄마다의 문제: 이름이 비었거나 겹침 + 서버 검사(schema/genres)를 그 장르 하나에만 돌린 것. 목록 줄의 아이콘(툴팁)과 편집 칸 맨 위에 보인다.
// 이름이 비었으면 검사에는 "이름 없는 장르"로 넘긴다(빈 이름으로 돌리면 ": 소스…" · "null" 같은 문장이 나온다)
function rowProblems(row: GenreRow) {
  const name = row.name.trim();
  const out: string[] = [];
  if (!name) out.push(T.problems.noName);
  else if (rows.value.filter((r) => r.name.trim() === name).length > 1) out.push(T.problems.duplicate);
  out.push(...genreProblems({ defaults: {}, genres: toMap([{ ...row, name: name || T.problems.unnamed }]) }));
  return out;
}
const rowProblem = (row: GenreRow) => rowProblems(row).join("\n");
// 전역 설정의 문제: 멀쩡한 장르 하나를 붙여 전역 값만 본다
const SOUND_GENRE = { sources: [{ type: "keyword", keywords: ["-"] }] };
const globalProblems = computed(() => (loaded.value ? genreProblems({ defaults: draft.value.defaults, genres: { "-": SOUND_GENRE } }) : []));
// 어느 줄의 것도 아닌 문제: 장르가 없음 · 저장할 때 서버가 짚은 것
const listProblems = computed(() => [...(loaded.value && !rows.value.length ? [T.problems.noGenres] : []), ...serverProblems.value]);

// 목록에 띄울 경고: 쓰이지 않는 출처(.env 에 키가 없음) · 모르는 종류. 출처 편집기의 안내와 같은 말
function rowWarning(row: GenreRow) {
  if (sourceTypesState.value !== "ready") return "";
  const lines = row.sources.flatMap((one) => {
    const spec = sourceTypes.value.find((t) => t.type === one.type);
    if (!spec) return [T.problems.unknownType(String(one.type ?? "?"))];
    if (!spec.usable) return [T.problems.unusable(spec.label)];
    return [];
  });
  return [...new Set(lines)].join("\n");
}

function removeRow(i: number) {
  const wasSelected = i === selectedIndex.value;
  reorderGenres(rows.value.map((_, at) => at).filter((at) => at !== i));
  rows.value.splice(i, 1);
  afterRemove(i, wasSelected);
}

function addRow() {
  rows.value.push(newRow());
  select(rows.value.length - 1);
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
