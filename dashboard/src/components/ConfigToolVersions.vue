<template>
  <!-- 외부 프로그램 이전 버전(업데이트 탭). 공유 타입 contract/old-tools. 삭제할 것이 있는 도구마다 이전 버전과 크기, 남기는 사유. 지금 쓰는 버전은 yt-dlp 카드와 봇 정보 탭에 있다.
       줄마다 삭제 버튼(그 도구만), 헤더의 모두 삭제(휴지통 비우기처럼 전부). 지금 쓰는 버전은 남긴다(dashboard/old-tools). 안드로이드의 캐시 삭제처럼 공간만 비우는 조작이라
       버튼과 확인 창은 오류 색이 아니고, 최근 로그인은 보지 않는다. 폴더 크기를 세느라 폴링하지 않고 탭을 열 때와 삭제한 뒤에 읽는다 -->
  <!-- 루트 하나(받은 class가 카드 쪽에 붙게) -->
  <div>
    <BaseCard icon="folder" :title="T.title">
      <template #actions
        ><BaseButton variant="secondary" size="sm" :disabled="!deletable || busy" @click="asking = 'all'"><Icon name="delete_sweep" :size="16" />{{ T.removeAll }}</BaseButton></template
      >
      <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
      <p v-else-if="tools && !tools.length" class="text-sm text-on-surface-variant">{{ T.nothing }}</p>
      <dl v-else-if="tools" class="flex flex-col gap-2 text-sm">
        <!-- 줄: 이름, 이전 버전과 크기(그 아래 남기는 사유), 오른쪽 끝에 그 도구만 삭제하는 버튼(삭제할 것이 없으면 자리만 남긴다) -->
        <div v-for="t in tools" :key="t.tool" class="flex items-center justify-between gap-3">
          <dt class="shrink-0 text-on-surface-variant">{{ T.name[t.tool] }}</dt>
          <dd class="min-w-0 flex-1 flex items-center justify-end gap-2">
            <span class="min-w-0 text-right">
              <span v-if="hasOld(t)" class="block truncate nums">{{ T.line(versionsOf(t), formatBytes(t.bytes)) }}</span>
              <span v-for="k in t.kept" :key="k" class="block text-xs text-on-surface-variant">{{ T.kept[k] }}</span>
            </span>
            <button v-if="hasOld(t)" type="button" :class="iconButton(32)" :disabled="busy" :aria-label="T.removeOne(T.name[t.tool])" v-tooltip="T.removeOne(T.name[t.tool])" @click="asking = t.tool"><Icon name="delete" :size="20" /></button>
            <span v-else class="size-8 shrink-0"></span>
          </dd>
        </div>
      </dl>
    </BaseCard>
    <ConfirmDialog :model-value="asking !== null" icon="delete_sweep" tone="primary" :title="T.confirm.title" :body="confirmBody" :confirm-label="T.confirm.button" :busy="busy" @update:model-value="(open) => !open && (asking = null)" @confirm="run" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import { notify, notifyDone, notifyProblem } from "../composables/toasts.ts";
import { problemText } from "../utils/problem.ts";
import { LIMIT } from "../utils/request.ts";
import { releaseDay } from "../utils/ffmpeg-version.ts";
import { iconButton } from "../utils/icon-button.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import type { OldTool, OldToolDone, OldToolView } from "../../../src/dashboard/contract/old-tools.ts";
import { text } from "../text/index.ts";
const T = text.toolVersions;

const API = "/api/admin/vendor/old-versions";

const tools = ref<OldToolView[] | null>(null);
const loadError = ref("");
// 확인 창: 그 도구만, all이면 모두
const asking = ref<OldTool | "all" | null>(null);
const busy = ref(false);

// 삭제할 것이 있다(버전이나 크기)
const hasOld = (t: OldToolView) => t.versions.length > 0 || t.bytes > 0;
const deletable = computed(() => (tools.value ?? []).some(hasOld));
// ffmpeg 릴리스(autobuild-2026-09-30-12-59)는 날짜만
const versionsOf = (t: OldToolView) => (t.tool === "ffmpeg" ? t.versions.map(releaseDay) : t.versions);
const sizeOf = (list: OldToolView[]) => formatBytes(list.reduce((sum, t) => sum + t.bytes, 0));

const confirmBody = computed(() => {
  const doomed = (tools.value ?? []).filter((t) => hasOld(t) && (asking.value === "all" || asking.value === t.tool));
  const lines = doomed.map((t) => T.confirm.line(T.name[t.tool], versionsOf(t), formatBytes(t.bytes)));
  if (doomed.length > 1) lines.push(T.confirm.total(sizeOf(doomed)));
  return `${lines.join("\n")}\n\n${T.confirm.note}`;
});

async function refresh() {
  try {
    tools.value = (await axios.get<OldToolView[]>(API, { timeout: LIMIT.long })).data;
    loadError.value = "";
  } catch (e) {
    loadError.value = problemText(e, T.loadFailed);
  }
}
onMounted(refresh);

// 삭제한 것이 없으면(다른 프로그램이 쓰는 중 등) 남긴 사유를 경고로 보인다
function announce(done: OldToolDone[]) {
  const removed = done.some(hasOld);
  const kept = done.flatMap((t) => t.kept.map((k) => `${T.name[t.tool]}: ${T.kept[k]}`));
  const lines = [removed ? T.done.freed(sizeOf(done)) : "", done.some((t) => t.deferred) ? T.done.deferred : "", ...kept].filter(Boolean).join("\n");
  if (removed) notifyDone(T.done.title, lines);
  else notify({ title: T.done.none, body: lines, severity: "warning" });
}

async function run() {
  const which = asking.value;
  if (!which) return;
  busy.value = true;
  try {
    const { data } = await axios.post<OldToolDone[]>(API, which === "all" ? {} : { tool: which }, { timeout: LIMIT.long });
    announce(data);
    asking.value = null;
    await refresh();
  } catch (e) {
    notifyProblem(e, T.done.failed);
  } finally {
    busy.value = false;
  }
}

defineExpose({ refresh });
</script>
