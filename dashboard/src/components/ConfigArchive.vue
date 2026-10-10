<template>
  <!-- 설정 내보내기 · 가져오기. 내보내기는 ZIP 을 내려받고, 가져오기는 파일을 올려 항목마다 지금과 같은지 · 문제를 보고 고른 것만 덮어쓴다.
       둘 다 최근 로그인만(지났으면 로그인 창을 띄우고 마치면 이어서 한다) -->
  <!-- 뿌리 하나(받은 class 가 카드 쪽에 붙게). 미리 보기 창은 body 로 옮겨 그린다 -->
  <div>
    <BaseCard icon="download" :title="T.title">
      <p class="mb-3 text-sm text-on-surface-variant">{{ T.desc }}</p>
      <div class="flex gap-2 flex-wrap">
        <BaseButton variant="secondary" :disabled="busy" @click="exportNow"><Icon name="download" :size="18" />{{ T.exportButton }}</BaseButton>
        <BaseButton variant="secondary" :disabled="busy" @click="fileEl?.click()"><Icon name="upload" :size="18" />{{ T.importButton }}</BaseButton>
        <input ref="fileEl" type="file" accept=".zip,application/zip" class="hidden" @change="picked" />
      </div>
    </BaseCard>

    <Teleport to="body">
      <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
        <div v-if="preview" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="close">
          <div role="dialog" aria-modal="true" aria-labelledby="archive-title" class="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-high p-6 animate-[art-in_350ms_var(--ease-spring-fast)]">
            <h3 id="archive-title" class="text-xl font-round font-semibold mb-1">{{ T.dialogTitle }}</h3>
            <p v-if="preview.exportedAt" class="text-label text-on-surface-variant mb-3">{{ T.madeAt(formatDateTime(Date.parse(preview.exportedAt)), preview.botVersion) }}</p>
            <p class="text-sm text-on-surface-variant mb-4">{{ T.dialogNote }}</p>
            <ul class="flex flex-col gap-1 mb-6">
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
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { ARCHIVE_ITEMS, type ArchiveImported, type ArchiveItem, type ArchivePreview, type ArchiveRow } from "../../../src/dashboard/contract/settings-archive.ts";
import { text } from "../text/index.ts";
const T = text.archive;

const BASE = "/api/admin/settings-archive";
const fileEl = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const applying = ref(false);
const file = ref<File | null>(null);
const preview = ref<ArchivePreview | null>(null);
const chosen = reactive(Object.fromEntries(ARCHIVE_ITEMS.map((item) => [item, false])) as Record<ArchiveItem, boolean>);

// 가져올 수 있는 줄: 파일에 있고 검사를 지났고 지금과 다르다
const usable = (row: ArchiveRow) => row.inFile && !row.problems.length && !row.same;
const picks = computed(() => ARCHIVE_ITEMS.filter((item) => chosen[item]));

function stateOf(row: ArchiveRow) {
  if (!row.inFile) return T.notInFile;
  const count = row.count !== null ? T.counts[row.item]?.(row.count) : undefined;
  const state = row.problems.length ? T.problem : row.same ? T.same : T.differs;
  return count ? `${state} · ${count}` : state;
}

// 받은 이름(Content-Disposition)으로 내려받기
function saveAs(blob: Blob, disposition: string | undefined) {
  const name = /filename="([^"]+)"/.exec(disposition ?? "")?.[1] ?? "musicbot-settings.zip";
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function exportNow() {
  busy.value = true;
  try {
    const res = await axios.get<Blob>(`${BASE}/export`, { responseType: "blob", timeout: LIMIT.long });
    saveAs(res.data, res.headers["content-disposition"] as string | undefined);
    notifyDone(T.exported);
  } catch (err) {
    notifyProblem(err, T.exportFailed);
  } finally {
    busy.value = false;
  }
}

const zipBody = (blob: Blob) => ({ headers: { "Content-Type": "application/zip" }, timeout: LIMIT.long, data: blob });

async function picked(event: Event) {
  const input = event.target as HTMLInputElement;
  const one = input.files?.[0] ?? null;
  input.value = ""; // 같은 파일을 다시 골라도 바뀜으로 받게
  if (!one) return;
  busy.value = true;
  try {
    const res = await axios.request<ArchivePreview>({ method: "POST", url: `${BASE}/preview`, ...zipBody(one) });
    file.value = one;
    preview.value = res.data;
    // 가져올 수 있는 것은 처음부터 골라 둔다
    for (const row of res.data.rows) chosen[row.item] = usable(row);
  } catch (err) {
    notifyProblem(err, T.previewFailed);
  } finally {
    busy.value = false;
  }
}

function close() {
  if (applying.value) return;
  preview.value = null;
  file.value = null;
}

async function apply() {
  if (!file.value) return;
  applying.value = true;
  try {
    await axios.request<ArchiveImported>({ method: "POST", url: `${BASE}/import?items=${picks.value.join(",")}`, ...zipBody(file.value) });
    notifyDone(T.imported, T.importedBody);
    // 열려 있던 편집기들이 옛 값 · 옛 저장 번호를 들고 있다. 새로 읽는다
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    notifyProblem(err, T.importFailed);
    applying.value = false;
  }
}
</script>
