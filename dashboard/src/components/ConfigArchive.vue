<template>
  <!-- 설정 내보내기 · 불러오기. 카드 둘: 백업 내보내기(안에 봇 설정만 · 파비콘 · 로그인 배경 · 오디오 캐시) · 백업 불러오기.
       불러오기는 파일을 한 번 올려(봇이 받은 표를 돌려준다) 항목마다 지금과 같은지 · 문제 · 바깥으로 나가는 값의 변화를 보고 선택한 것만 가져온다. 오디오 캐시는 합친다(나눔을 행마다).
       불러온 뒤 쿠키 출처가 바뀌었으면 알리고, 다시 시작해야 먹는 값이 바뀌었으면 다시 시작 창을 연다. 내보내기 · 불러오기는 최근 로그인만 -->
  <div class="flex flex-col gap-(--gap-in)">
    <BaseCard icon="download" :title="T.exportTitle">
      <p class="mb-3 text-sm text-on-surface-variant">
        {{ T.exportDescBefore }}<code class="px-1.5 rounded bg-on-surface/10 text-on-surface font-mono">{{ T.backupCommand }}</code
        >{{ T.exportDescAfter }}
      </p>
      <div class="grid grid-cols-1 @2xl/card:grid-cols-2 gap-3">
        <section v-for="kind in ARCHIVE_KINDS" :key="kind" class="flex flex-col rounded-(--r-inner) bg-surface-container-high p-4">
          <h3 class="mb-1 flex items-center gap-1 text-title font-semibold text-on-surface">{{ T.exports[kind].title }}<Icon v-if="T.tips[kind]" name="info" :size="16" class="cursor-help text-on-surface-variant" v-tooltip="T.tips[kind]" /></h3>
          <p class="mb-3 text-sm text-on-surface-variant">{{ T.exports[kind].desc }}</p>
          <div class="mt-auto flex flex-wrap items-center gap-3">
            <BaseButton variant="secondary" :disabled="busy" @click="exportNow(kind)"><Icon name="download" :size="18" />{{ T.exports[kind].button }}</BaseButton>
            <label v-if="kind === 'audio-cache'" class="flex items-center gap-2 text-sm text-on-surface-variant cursor-pointer" v-tooltip="T.withoutFilesTip"><BaseSwitch v-model="noFiles" :label="T.withoutFiles" />{{ T.withoutFiles }}</label>
          </div>
        </section>
      </div>
    </BaseCard>
    <BaseCard icon="upload" :title="T.importTitle">
      <p class="mb-1 flex items-center gap-1 text-sm text-on-surface-variant">{{ T.importDesc }}<Icon name="info" :size="16" class="cursor-help" v-tooltip="T.tips.import" /></p>
      <p class="mb-3 text-sm text-on-surface-variant">{{ T.importFullBackup }}</p>
      <BaseButton variant="secondary" :disabled="busy" @click="fileEl?.click()"><Icon name="upload" :size="18" />{{ T.importButton }}</BaseButton>
      <input ref="fileEl" type="file" accept=".zip,application/zip" class="hidden" @change="picked" />
    </BaseCard>

    <Teleport to="body">
      <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
        <div v-if="preview" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="close">
          <div role="dialog" aria-modal="true" aria-labelledby="archive-title" class="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-high p-6 animate-[art-in_350ms_var(--ease-spring-fast)]">
            <h3 id="archive-title" class="text-xl font-round font-semibold mb-1">{{ T.dialogTitle }}</h3>
            <p v-if="preview.exportedAt" class="text-label text-on-surface-variant mb-3">{{ T.madeAt(T.kinds[preview.kind], formatDateTime(Date.parse(preview.exportedAt)), preview.botVersion) }}</p>
            <p class="text-sm text-on-surface-variant mb-1">{{ preview.kind === "audio-cache" ? T.dialogNoteMerge : T.dialogNote }}</p>
            <p v-if="preview.room !== undefined" class="text-label text-on-surface-variant mb-4">{{ T.room(formatBytes(preview.room)) }}</p>
            <ul class="flex flex-col gap-1 mb-6 mt-3">
              <li v-for="row in preview.rows" :key="row.item">
                <label class="flex items-center gap-3 min-h-12 px-2 rounded-(--r-row)" :class="usable(row) ? 'cursor-pointer state-layer' : 'opacity-60'">
                  <BaseSwitch v-model="chosen[row.item]" :disabled="!usable(row) || applying" :label="T.items[row.item]" />
                  <span class="flex-1 min-w-0">
                    <span class="block text-body font-medium">{{ T.items[row.item] }}</span>
                    <span class="block text-label" :class="row.problems.length ? 'text-error' : 'text-on-surface-variant'">{{ stateOf(row) }}</span>
                  </span>
                </label>
                <ul v-if="row.problems.length" class="ml-16 mb-1 text-label text-error list-disc pl-4">
                  <li v-for="line in row.problems" :key="line">{{ line }}</li>
                </ul>
                <ul v-if="(row.warnings.length || row.breakdown?.overLimit) && usable(row)" class="ml-16 mb-1 text-label text-(--warn-ink) list-disc pl-4">
                  <li v-for="line in row.warnings" :key="line">{{ line }}</li>
                  <li v-if="row.breakdown?.overLimit">{{ T.breakdown.overLimit(row.breakdown.overLimit) }}</li>
                </ul>
              </li>
            </ul>
            <div class="flex gap-2 justify-end">
              <BaseButton variant="ghost" :disabled="applying" @click="close">{{ T.cancel }}</BaseButton>
              <BaseButton :disabled="!picks.length || applying" @click="apply">{{ T.apply(picks.length) }}</BaseButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import BaseSwitch from "./BaseSwitch.vue";
import Icon from "./BaseIcon.vue";
import { LIMIT } from "../utils/request.ts";
import { formatDateTime } from "../utils/locale.ts";
import { notify, notifyDone, notifyProblem } from "../composables/toasts.ts";
import { askRestart } from "../composables/bot-restart.ts";
import { ensureRecentLogin } from "../composables/session.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import { ARCHIVE_ITEMS, ARCHIVE_KINDS, type ArchiveDownload, type ArchiveImported, type ArchiveItem, type ArchiveKind, type ArchivePreview, type ArchiveRow } from "../../../src/dashboard/contract/settings-archive.ts";
import { text } from "../text/index.ts";
const T = text.archive;

const BASE = "/api/admin/settings-archive";
const fileEl = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const applying = ref(false);
const noFiles = ref(false);
const preview = ref<ArchivePreview | null>(null);
const chosen = reactive(Object.fromEntries(ARCHIVE_ITEMS.map((item) => [item, false])) as Record<ArchiveItem, boolean>);

// 가져올 수 있는 행: 파일에 있고 검사를 지났고 지금과 다르다(합치는 행은 새로 가져올 것 · 바뀔 것이 있을 때)
const usable = (row: ArchiveRow) => row.inFile && !row.problems.length && (row.breakdown ? row.breakdown.added + row.breakdown.changed > 0 : !row.same);
const picks = computed(() => ARCHIVE_ITEMS.filter((item) => chosen[item]));

function stateOf(row: ArchiveRow) {
  if (!row.inFile) return T.notInFile;
  if (row.problems.length) return T.problem;
  if (row.breakdown) {
    const b = row.breakdown;
    const parts = [T.breakdown.added(b.added), b.existing ? T.breakdown.existing(b.existing) : "", b.changed ? T.breakdown.changed(b.changed) : "", b.bytes ? formatBytes(b.bytes) : ""].filter(Boolean);
    return parts.join(" · ");
  }
  const count = row.count !== null ? T.counts[row.item]?.(row.count) : undefined;
  const state = row.same ? T.same : T.differs;
  return count ? `${state} · ${count}` : state;
}

async function exportNow(kind: ArchiveKind) {
  busy.value = true;
  try {
    const files = kind === "audio-cache" && noFiles.value ? "&files=0" : "";
    const { url } = (await axios.post<ArchiveDownload>(`${BASE}/export?kind=${kind}${files}`)).data;
    Object.assign(document.createElement("a"), { href: url, download: "" }).click();
    notifyDone(T.exported);
  } catch (err) {
    notifyProblem(err, T.exportFailed);
  } finally {
    busy.value = false;
  }
}

async function picked(event: Event) {
  const input = event.target as HTMLInputElement;
  const one = input.files?.[0] ?? null;
  input.value = "";
  // 가져오기는 최근 로그인만. 오래됐으면 로그인 창을 먼저(그만두면 올리지 않고 선택 창도 열지 않는다)
  if (!one || !(await ensureRecentLogin())) return;
  busy.value = true;
  try {
    const res = await axios.request<ArchivePreview>({ method: "POST", url: `${BASE}/preview`, headers: { "Content-Type": "application/zip" }, timeout: LIMIT.long, data: one });
    preview.value = res.data;
    for (const item of ARCHIVE_ITEMS) chosen[item] = false;
    for (const row of res.data.rows) chosen[row.item] = usable(row);
  } catch (err) {
    notifyProblem(err, T.previewFailed);
  } finally {
    busy.value = false;
  }
}

function close() {
  if (applying.value || !preview.value) return;
  void axios.delete(`${BASE}/upload/${preview.value.token}`).catch(() => {
    /* 봇이 1시간 뒤에 삭제한다 */
  });
  preview.value = null;
}

async function apply() {
  if (!preview.value) return;
  applying.value = true;
  const merging = preview.value.kind === "audio-cache";
  try {
    const { data } = await axios.post<ArchiveImported>(`${BASE}/import?token=${preview.value.token}&items=${picks.value.join(",")}`, null, { timeout: LIMIT.long });
    notifyDone(T.imported, merging ? "" : T.importedBody);
    // 쿠키 자체는 백업에 없다: 출처가 바뀌었으면 입력하거나 확인하라고
    if (data.cookiesSource) notify({ ...T.cookiesChanged(data.cookiesSource), severity: "warning" });
    preview.value = null;
    applying.value = false;
    // 다시 시작해야 먹는 값이 바뀌었으면 묻는다(지금 다시 시작 · 나중에). 아니면 열려 있던 편집기들이 옛 값을 들고 있어 새로 읽는다
    if (data.restart) askRestart();
    else if (!merging) setTimeout(() => location.reload(), 800);
  } catch (err) {
    notifyProblem(err, T.importFailed);
    applying.value = false;
  }
}
</script>
