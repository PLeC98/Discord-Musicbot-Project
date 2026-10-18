<template>
  <!-- 설정 DB 스냅샷. 선택하면 예약하고 다시 시작해 교체한다(실행기 없이 실행했으면 다음에 시작할 때). 복원은 최근 로그인만 -->
  <!-- 루트 하나(받은 class 가 카드 쪽에 붙게) -->
  <div>
    <BaseCard icon="history" :title="T.title">
      <p class="mb-3 flex items-center gap-1 text-sm text-on-surface-variant">{{ T.desc }}<Icon name="info" :size="16" class="cursor-help" v-tooltip="T.descTip" /></p>
      <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
      <NoticeBox v-if="view?.staged" variant="note" tone="info" icon="history" class="mt-0! mb-3">
        <span class="flex items-center gap-3 flex-wrap"
          ><span class="flex-1 min-w-0 break-all">{{ T.staged(view.staged) }}</span
          ><BaseButton variant="ghost" size="sm" :disabled="busy" @click="unstage">{{ T.unstage }}</BaseButton></span
        >
      </NoticeBox>
      <p v-if="view && !view.rows.length" class="text-sm text-on-surface-variant">{{ T.empty }}</p>
      <ul v-else-if="view" class="flex flex-col">
        <li v-for="row in view.rows" :key="row.name" class="flex items-center gap-3 min-h-12 px-2">
          <span class="flex-1 min-w-0">
            <span class="block text-body font-medium">{{ formatDateTime(row.at) }}</span>
            <span class="block text-label text-on-surface-variant">{{ T.kinds[row.kind] }} · {{ formatBytes(row.bytes) }}</span>
          </span>
          <BaseButton variant="ghost" size="sm" :disabled="busy" @click="void ask(row)"><Icon name="undo" :size="18" />{{ T.restore }}</BaseButton>
        </li>
      </ul>
    </BaseCard>
    <ConfirmDialog :model-value="asking !== null" icon="history" tone="danger" :title="T.confirmTitle" :body="asking ? T.confirmBody(formatDateTime(asking.at), canRestart) : ''" :confirm-label="T.confirm" :busy="busy" @update:model-value="(open) => !open && (asking = null)" @confirm="restore" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import NoticeBox from "./NoticeBox.vue";
import Icon from "./BaseIcon.vue";
import { formatDateTime } from "../utils/locale.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import { problemText } from "../utils/problem.ts";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { restartNow } from "../composables/bot-restart.ts";
import { ensureRecentLogin } from "../composables/session.ts";
import type { Snapshot, SnapshotsView } from "../../../src/rules/snapshots.ts";
import { text } from "../text/index.ts";
const T = text.snapshots;

/** canRestart: 실행기로 시작했는가(봇 상태의 env.launcher). 아니면 예약만 한다 */
const props = defineProps<{ canRestart: boolean }>();

const BASE = "/api/admin/snapshots";
const view = ref<SnapshotsView | null>(null);
const loadError = ref("");
const busy = ref(false);
const asking = ref<Snapshot | null>(null);
// 로그인한 지 오래됐으면 로그인 창을 먼저(그만두면 확인 창을 열지 않는다)
async function ask(row: Snapshot) {
  if (await ensureRecentLogin()) asking.value = row;
}

async function load() {
  try {
    view.value = (await axios.get<SnapshotsView>(BASE)).data;
    loadError.value = "";
  } catch (err) {
    loadError.value = problemText(err, T.loadFailed);
  }
}

async function restore() {
  if (!asking.value) return;
  busy.value = true;
  try {
    view.value = (await axios.post<SnapshotsView>(`${BASE}/restore`, { name: asking.value.name })).data;
    asking.value = null;
    // 실행기가 있으면 곧바로 다시 시작해 교체한다(다시 뜨면 화면을 새로고침한다)
    if (props.canRestart) await restartNow();
    else notifyDone(T.stagedDone, T.stagedDoneBody);
  } catch (err) {
    notifyProblem(err, T.failed);
  } finally {
    busy.value = false;
  }
}

async function unstage() {
  busy.value = true;
  try {
    view.value = (await axios.delete<SnapshotsView>(`${BASE}/restore`)).data;
  } catch (err) {
    notifyProblem(err, T.failed);
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>
