<template>
  <!-- yt-dlp 카드(유튜브 탭). 운영 조절값 카드와 같은 모양(라벨 + 높이 40 칸, 카드가 넓으면 2열).
       채널, 자동 업데이트는 다른 운영 조절값처럼 저장 막대로 저장한다(저장하면 서버가 새 설정으로 맞춘다).
       버전 고정, 되돌리기, 업데이트는 누르면 바로 한다(그 조작이 곧 다운로드를 시작한다).
       다운로드는 서버가 뒤에서 하고 카드는 상태를 다시 읽어 진행을 본다. 결과는 토스트, 다시 시도할 실패는 칸 아래에 남긴다 -->
  <BaseCard icon="download" :title="T.title">
    <template #actions
      ><BaseButton variant="secondary" size="sm" :href="RELEASES[state?.channel ?? 'nightly']" target="_blank" rel="noopener"><Icon name="open_in_new" :size="16" />{{ T.releases }}</BaseButton></template
    >
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
    <template v-if="state">
      <div class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
        <div class="min-w-0">
          <span :class="FIELD_LABEL" class="flex items-center gap-1">{{ T.channel }}<Icon name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="state.pin ? T.channelPinned : T.channelHelp" /></span>
          <SingleSelect :model-value="channelDraft" :options="CHANNELS" :disabled="Boolean(state.pin)" @update:model-value="draft.YTDLP_CHANNEL = String($event)" />
        </div>
        <div class="min-w-0">
          <span :class="FIELD_LABEL" class="flex items-center gap-1">{{ T.auto }}<Icon name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="state.pin ? T.autoPinned : T.autoHelp" /></span>
          <span class="flex items-center gap-2 h-10 min-w-0">
            <BaseSwitch :model-value="modeDraft === 'auto'" :label="T.auto" @update:model-value="draft.YTDLP_UPDATE = $event ? 'auto' : 'manual'" />
            <span class="text-sm text-on-surface">{{ modeDraft === "auto" ? text.tunables.on : text.tunables.off }}</span>
            <span v-if="state.nextAt && !state.failure" class="truncate text-xs text-on-surface-variant">{{ T.nextCheck(formatDateTime(state.nextAt)) }}</span>
          </span>
        </div>

        <!-- 설치된 버전과 업데이트. 버전을 고정한 상태에서는 업데이트 확인과 되돌리기를 숨긴다(고정을 해제해야 업데이트할 수 있다) -->
        <div class="min-w-0">
          <span :class="FIELD_LABEL">{{ T.installed }}</span>
          <span class="flex items-center gap-2 h-10 min-w-0">
            <span class="min-w-0 truncate text-sm" :class="state.busy ? 'text-on-surface-variant' : 'font-mono text-on-surface'">{{ state.busy ? T.downloading(state.busy) : (state.version ?? T.noVersion) }}</span>
            <template v-if="!state.pin">
              <span v-if="upToDate" class="shrink-0 text-xs text-on-surface-variant">{{ T.latest }}</span>
              <span class="flex-1"></span>
              <BaseButton v-if="newer" class="shrink-0" :disabled="working" @click="update">{{ T.update(newer) }}</BaseButton>
              <BaseButton v-else variant="secondary" class="shrink-0" :disabled="checking || working" @click="check">{{ checking ? T.checking : T.check }}</BaseButton>
              <MoreMenu v-if="previousItems.length" class="shrink-0" icon="history" :label="T.previousMenu(state.previous ?? '')" :button-class="iconButton(40, 'tonal')" :disabled="working" :items="previousItems" />
            </template>
          </span>
        </div>

        <!-- 버전 고정. 고정한 상태에서도 같은 칸 모양(입력란 자리에 고정한 버전, 버튼은 해제) -->
        <div class="min-w-0">
          <span :class="FIELD_LABEL" class="flex items-center gap-1">{{ T.pin }}<Icon name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="T.pinHelp" /></span>
          <form class="flex items-center gap-2" @submit.prevent="state.pin ? setPin(null) : setPin(pinDraft.trim())">
            <input :value="state.pin ?? pinDraft" :readonly="Boolean(state.pin)" spellcheck="false" :placeholder="T.pinPlaceholder" :aria-label="T.pin" :class="[FIELD, 'w-full min-w-0 flex-1 font-mono placeholder:font-sans', state.pin && 'text-on-surface-variant']" @input="pinDraft = valueOf($event)" />
            <BaseButton type="submit" variant="secondary" class="shrink-0" :disabled="saving || working || (!state.pin && !pinDraft.trim())">{{ state.pin ? T.unpin : T.pinApply }}</BaseButton>
          </form>
        </div>
      </div>

      <NoticeBox v-if="state.failure && !state.busy" variant="note" tone="error" icon="error">
        <span class="flex items-center gap-3 flex-wrap"
          ><span class="flex-1 min-w-0 break-words"
            >{{ T.failed(state.failure.target, state.failure.reason) }}<template v-if="state.nextAt"> {{ T.retryAt(formatDateTime(state.nextAt)) }}</template></span
          ><BaseButton v-if="state.pin" variant="secondary" size="sm" :disabled="working" @click="setPin(state.pin)">{{ T.pinRetry }}</BaseButton></span
        >
      </NoticeBox>
      <NoticeBox v-else-if="state.pin && pinDays !== null && pinDays >= OLD_DAYS" variant="note" tone="notice" icon="schedule">{{ T.pinnedAge(state.pin, pinDays) }}</NoticeBox>
    </template>
    <ConfirmDialog v-model="askingRollback" icon="undo" tone="primary" :title="T.rollbackTitle" :body="T.rollbackBody(state?.previous ?? '')" :confirm-label="T.rollbackConfirm" @confirm="rollback" />
    <ConfirmDialog v-model="askingForget" icon="delete" :title="T.forgetTitle" :body="T.forgetBody(state?.previous ?? '')" :confirm-label="T.forgetConfirm" @confirm="forget" />
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import BaseSwitch from "./BaseSwitch.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import MoreMenu from "./MoreMenu.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import SingleSelect from "./SingleSelect.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { iconButton } from "../utils/icon-button.ts";
import { valueOf } from "../utils/dom.ts";
import { formatDateTime } from "../utils/locale.ts";
import { problemText } from "../utils/problem.ts";
import { applyCard, attach, draft, inOrder, saved } from "../composables/tunables.ts";
import { trackUnsaved } from "../composables/unsaved.ts";
import { tunable, tunableValue } from "../../../src/rules/tunables.ts";
import { notify, notifyDone, notifyProblem } from "../composables/toasts.ts";
import type { Option } from "../utils/options.ts";
import type { IconName } from "../icons.ts";
import type { VendorReply } from "../../../src/dashboard/contract/admin.ts";
import type { YtdlpCardStatus, YtdlpChannel } from "../../../src/sources/ytdlp-status-types.ts";
import { text } from "../text/index.ts";
const T = text.ytdlp;

const BASE = "/api/admin/vendor";
// 채널마다 릴리스를 내는 저장소
const RELEASES: Record<YtdlpChannel, string> = { stable: "https://github.com/yt-dlp/yt-dlp/releases", nightly: "https://github.com/yt-dlp/yt-dlp-nightly-builds/releases", master: "https://github.com/yt-dlp/yt-dlp-master-builds/releases" };
const CHANNELS: Option[] = (["stable", "nightly", "master"] as const).map((value) => ({ value, label: value }));
// 다운로드하는 동안 상태를 다시 읽는 간격(ms)
const POLL_MS = 1500;
// 고정한 버전이 나온 지 이만큼 지났으면 며칠 됐는지 표시한다(일)
const OLD_DAYS = 30;

const state = ref<YtdlpCardStatus | null>(null);
const loadError = ref("");
const checking = ref(false);
const saving = ref(false);
const pinDraft = ref("");
const askingRollback = ref(false);
const askingForget = ref(false);
let timer = 0;

// 채널, 자동 업데이트는 운영 조절값의 고치는 중인 값(저장 막대가 저장한다). 비우면 기본값
const draftOf = (key: "YTDLP_CHANNEL" | "YTDLP_UPDATE") => draft.value[key] || tunable(key).def;
const channelDraft = computed(() => draftOf("YTDLP_CHANNEL"));
const modeDraft = computed(() => draftOf("YTDLP_UPDATE"));
trackUnsaved(
  "youtube:ytdlp",
  computed(() => (["YTDLP_CHANNEL", "YTDLP_UPDATE"] as const).some((key) => tunableValue(key, draft.value[key] ?? "") !== (saved.value[key] ?? ""))),
);

// 다운로드 중이거나 저장하는 중에는 다운로드를 시작하는 버튼을 막는다
const working = computed(() => saving.value || Boolean(state.value?.busy));
// 확인으로 본 최신이 설치된 버전과 다르면 그 버전, 같으면 최신이라고 보인다
const newer = computed(() => (state.value?.seen && state.value.seen.latest !== state.value.version ? state.value.seen.latest : null));
const upToDate = computed(() => Boolean(state.value?.seen && state.value.seen.latest === state.value.version));
// 이전 버전의 메뉴: 되돌리기(되돌릴 수 있을 때), 삭제
type MenuItem = { label: string; icon: IconName; danger?: boolean; select: () => void };
const askRollback = (): void => void (askingRollback.value = true);
const askForget = (): void => void (askingForget.value = true);
const previousItems = computed((): MenuItem[] => {
  const previous = state.value?.previous;
  if (!previous) return [];
  const back: MenuItem[] = state.value?.canRollback ? [{ label: T.rollbackItem, icon: "undo", select: askRollback }] : [];
  return [...back, { label: T.forgetItem, icon: "delete", danger: true, select: askForget }];
});
// 고정한 태그는 날짜로 시작한다(2026.08.19, 2026.08.19.232849). 그 날짜부터 지난 일수
const pinDays = computed(() => {
  const found = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(state.value?.pin ?? "");
  return found ? Math.floor((Date.now() - Date.UTC(Number(found[1]), Number(found[2]) - 1, Number(found[3]))) / 86_400_000) : null;
});

// 응답을 반영한다. 다운로드가 끝났으면 결과를 알리고, 진행 중이면 조금 뒤에 다시 읽는다
function show({ status, tunables }: VendorReply) {
  const before = state.value;
  const now = status.ytdlp;
  state.value = now;
  if (tunables) applyCard(tunables);
  // 화면을 연 뒤에 바뀐 것만 알린다(처음 읽은 상태는 알리지 않는다)
  if (before && now.failure && now.failure.at !== before.failure?.at) notify({ title: T.downloadFailed, body: now.failure.reason });
  else if (before && now.version && now.version !== before.version) notifyDone(T.updated, now.version);
  clearTimeout(timer);
  if (now.busy) timer = window.setTimeout(() => void refresh(), POLL_MS);
}

async function refresh() {
  try {
    show((await axios.get<VendorReply>(BASE)).data);
    loadError.value = "";
  } catch (err) {
    if (!state.value) loadError.value = problemText(err, T.loadFailed);
    else notifyProblem(err, T.loadFailed);
  }
}

// 조작 하나를 보낸다. 조절값 상태를 바꾸는 요청이라 저장 막대의 저장과 겹치지 않게 차례로 보낸다
async function act(path: string, body: object, failed: string) {
  saving.value = true;
  try {
    show(await inOrder(async () => (await axios.post<VendorReply>(`${BASE}${path}`, body)).data));
    // 저장한 뒤 서버가 다운로드를 시작했을 수 있다
    clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), POLL_MS);
    return true;
  } catch (err) {
    notifyProblem(err, failed);
    void refresh();
    return false;
  } finally {
    saving.value = false;
  }
}

async function check() {
  checking.value = true;
  try {
    show((await axios.post<VendorReply>(`${BASE}/ytdlp/check`)).data);
  } catch (err) {
    notifyProblem(err, T.checkFailed);
  } finally {
    checking.value = false;
  }
}

const update = () => state.value?.seen && act("/ytdlp/update", { channel: state.value.channel, tag: state.value.seen.latest }, T.updateFailed);
async function setPin(version: string | null) {
  if (!state.value || (await act("/ytdlp/pin", { version, expect: state.value.pin }, T.saveFailed)) !== true) return;
  pinDraft.value = "";
}
async function rollback() {
  askingRollback.value = false;
  await act("/ytdlp/rollback", {}, T.saveFailed);
}
async function forget() {
  askingForget.value = false;
  const previous = state.value?.previous ?? "";
  if (await act("/ytdlp/forget-previous", {}, T.forgetFailed)) notifyDone(T.forgotten(previous));
}

const { ready, detach } = attach();
onMounted(() => {
  void refresh();
  ready.catch(() => undefined);
});
onUnmounted(() => {
  clearTimeout(timer);
  detach();
});
// 저장 막대가 채널, 자동 업데이트를 저장하면 서버가 맞추기 시작한다. 조금 뒤 상태를 다시 읽는다
watch(
  () => [saved.value.YTDLP_CHANNEL, saved.value.YTDLP_UPDATE],
  () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), POLL_MS);
  },
);
</script>
