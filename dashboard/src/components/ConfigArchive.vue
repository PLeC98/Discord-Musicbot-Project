<template>
  <!-- 설정 내보내기 · 불러오기. 카드 둘: 백업 내보내기(안에 봇 설정만(나눠 줄 것) · 암호화된 설정까지(서버별 설정 · 키 · 쿠키의 암호문) · 파비콘 · 로그인 배경) · 백업 불러오기.
       불러오기는 파일을 한 번 올려(봇이 받은 표를 돌려준다) 항목마다 지금과 같은지 · 문제 · 바깥으로 나가는 값의 변화를 보고 선택한 것만 덮어쓴다. 내보내기 · 불러오기는 최근 로그인만.
       설명은 짧게, 길어지는 주의는 제목 옆 툴팁으로(2026-10-17 사용자). .env 까지 담는 전체 백업은 대시보드가 아니라 봇 폴더의 명령(pnpm run backup)이다 -->
  <!-- 루트 하나(받은 class 가 카드 그룹에 붙게). 미리 보기 창은 body 로 옮겨 그린다 -->
  <div class="flex flex-col gap-(--gap-in)">
    <!-- 안쪽 카드들(넓으면 둘씩). 설명 길이가 달라도 버튼이 같은 줄에 오게 버튼은 아래에 붙인다 -->
    <BaseCard icon="download" :title="T.exportTitle">
      <div class="grid grid-cols-1 @2xl/card:grid-cols-2 gap-3">
        <section v-for="kind in ARCHIVE_KINDS" :key="kind" class="flex flex-col rounded-(--r-inner) bg-surface-container-high p-4">
          <h3 class="mb-1 flex items-center gap-1 text-title font-semibold text-on-surface">{{ T.exports[kind].title }}<Icon v-if="T.tips[kind]" name="info" :size="16" class="cursor-help text-on-surface-variant" v-tooltip="T.tips[kind]" /></h3>
          <p class="mb-3 text-sm text-on-surface-variant">{{ T.exports[kind].desc }}</p>
          <BaseButton variant="secondary" class="mt-auto self-start" :disabled="busy" @click="exportNow(kind)"><Icon name="download" :size="18" />{{ T.exports[kind].button }}</BaseButton>
        </section>
      </div>
    </BaseCard>
    <BaseCard icon="upload" :title="T.importTitle">
      <p class="mb-3 flex items-center gap-1 text-sm text-on-surface-variant">{{ T.importDesc }}<Icon name="info" :size="16" class="cursor-help" v-tooltip="T.tips.import" /></p>
      <BaseButton variant="secondary" :disabled="busy" @click="fileEl?.click()"><Icon name="upload" :size="18" />{{ T.importButton }}</BaseButton>
      <input ref="fileEl" type="file" accept=".zip,application/zip" class="hidden" @change="picked" />
    </BaseCard>

    <Teleport to="body">
      <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
        <div v-if="preview" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="close">
          <div role="dialog" aria-modal="true" aria-labelledby="archive-title" class="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-high p-6 animate-[art-in_350ms_var(--ease-spring-fast)]">
            <h3 id="archive-title" class="text-xl font-round font-semibold mb-1">{{ T.dialogTitle }}</h3>
            <p v-if="preview.exportedAt" class="text-label text-on-surface-variant mb-3">{{ T.madeAt(T.kinds[preview.kind], formatDateTime(Date.parse(preview.exportedAt)), preview.botVersion) }}</p>
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
                <!-- 가져올 수는 있지만 알아 둘 것: 바깥으로 나가는 값(AI 요청이 가는 곳 · 봇 웹사이트 주소)이 바뀐다 · 건너뛰는 값 -->
                <ul v-if="row.warnings.length && usable(row)" class="ml-16 mb-1 text-label text-(--warn-ink) list-disc pl-4">
                  <li v-for="line in row.warnings" :key="line">{{ line }}</li>
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
import { ARCHIVE_ITEMS, ARCHIVE_KINDS, type ArchiveDownload, type ArchiveImported, type ArchiveItem, type ArchiveKind, type ArchivePreview, type ArchiveRow } from "../../../src/dashboard/contract/settings-archive.ts";
import { text } from "../text/index.ts";
const T = text.archive;

const BASE = "/api/admin/settings-archive";
const fileEl = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const applying = ref(false);
const preview = ref<ArchivePreview | null>(null);
const chosen = reactive(Object.fromEntries(ARCHIVE_ITEMS.map((item) => [item, false])) as Record<ArchiveItem, boolean>);

// 가져올 수 있는 행: 파일에 있고 검사를 지났고 지금과 다르다
const usable = (row: ArchiveRow) => row.inFile && !row.problems.length && !row.same;
const picks = computed(() => ARCHIVE_ITEMS.filter((item) => chosen[item]));

function stateOf(row: ArchiveRow) {
  if (!row.inFile) return T.notInFile;
  const count = row.count !== null ? T.counts[row.item]?.(row.count) : undefined;
  const state = row.problems.length ? T.problem : row.same ? T.same : T.differs;
  return count ? `${state} · ${count}` : state;
}

// 다운로드는 두 단계: 최근 로그인을 보고(지났으면 다시 로그인 창) 받은 한 번 쓰는 주소를 브라우저가 바로 다운로드한다(수백 MB 인 로그인 배경을 메모리에 들지 않게).
// 이름은 봇이 보낸 Content-Disposition 대로
async function exportNow(kind: ArchiveKind) {
  busy.value = true;
  try {
    const { url } = (await axios.post<ArchiveDownload>(`${BASE}/export?kind=${kind}`)).data;
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
  input.value = ""; // 같은 파일을 다시 선택해도 바뀜으로 받게
  if (!one) return;
  busy.value = true;
  try {
    // 파일은 여기서 한 번만 올린다. 가져오기는 받은 표(token)로
    const res = await axios.request<ArchivePreview>({ method: "POST", url: `${BASE}/preview`, headers: { "Content-Type": "application/zip" }, timeout: LIMIT.long, data: one });
    preview.value = res.data;
    // 가져올 수 있는 것은 처음부터 선택해 둔다
    for (const row of res.data.rows) chosen[row.item] = usable(row);
  } catch (err) {
    notifyProblem(err, T.previewFailed);
  } finally {
    busy.value = false;
  }
}

// 닫으면 올린 파일을 삭제한다
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
  try {
    await axios.post<ArchiveImported>(`${BASE}/import?token=${preview.value.token}&items=${picks.value.join(",")}`, null, { timeout: LIMIT.long });
    notifyDone(T.imported, T.importedBody);
    // 열려 있던 편집기들이 옛 값 · 옛 저장 번호를 들고 있다. 새로 읽는다
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    notifyProblem(err, T.importFailed);
    applying.value = false;
  }
}
</script>
