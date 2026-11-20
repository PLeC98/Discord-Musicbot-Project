<template>
  <!-- yt-dlp 카드(업데이트 탭). 운영 설정값 카드와 같은 모양(라벨 + 높이 40px 칸, 카드가 넓으면 2열). 칸은 설치된 버전, 그 오른쪽에 업데이트 버튼, 채널, 버전 고정, 자동 업데이트 순서다.
       채널, 자동 업데이트는 다른 운영 설정값처럼 저장 바에서 저장한다(저장하면 서버가 새 설정으로 맞춘다).
       버전 고정, 되돌리기, 업데이트는 누르면 바로 한다(그 조작이 곧 다운로드를 시작한다).
       다운로드는 서버가 뒤에서 하고 카드는 상태를 다시 읽어 진행을 본다. 결과는 토스트, 다시 시도할 실패는 칸 아래에 남긴다 -->
  <BaseCard icon="smart_display" :title="T.title">
    <template #actions
      ><BaseButton variant="secondary" size="sm" :href="releasesUrl" target="_blank" rel="noopener"><Icon name="open_in_new" :size="16" />{{ T.releases }}</BaseButton></template
    >
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
    <template v-if="state">
      <div class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
        <!-- 설치된 버전 -->
        <div class="min-w-0">
          <span :class="FIELD_LABEL">{{ T.installed }}</span>
          <span class="flex items-center gap-2 h-10 min-w-0">
            <span class="min-w-0 truncate text-sm" :class="state.busy ? 'text-on-surface-variant' : 'font-mono text-on-surface'">{{ state.busy ? T.downloading(state.busy) : (state.version ?? T.noVersion) }}</span>
            <span v-if="upToDate && !state.pin && !state.busy" class="shrink-0 text-xs text-on-surface-variant">{{ T.latest }}</span>
          </span>
        </div>
        <!-- 업데이트와 이전 버전(라벨 없는 칸, 오른쪽 정렬, 줄 높이에 맞춘다). 버전을 고정한 상태에서는 레이아웃이 밀리지 않게 버튼만 숨기고 칸은 남긴다(1열이면 빈 줄이라 숨긴다) -->
        <div class="self-end items-center justify-end gap-2 h-10 min-w-0" :class="state.pin ? 'hidden @md/card:flex' : 'flex'">
          <template v-if="!state.pin">
            <BaseButton v-if="newer" :disabled="working" @click="update">{{ T.update(newer) }}</BaseButton>
            <BaseButton v-else variant="secondary" :disabled="checking || working" @click="check">{{ checking ? T.checking : T.check }}</BaseButton>
            <!-- 이전 버전으로 되돌리기만 한다. 이전 버전 삭제는 외부 프로그램 이전 버전 카드에서 -->
            <button v-if="state.canRollback && state.previous" type="button" :class="iconButton(40, 'tonal')" :disabled="working" :aria-label="T.rollbackTo(state.previous)" v-tooltip="T.rollbackTo(state.previous)" @click="askingRollback = true"><Icon name="history" /></button>
          </template>
        </div>
        <div class="min-w-0">
          <span :class="FIELD_LABEL" class="flex items-center gap-1">{{ T.channel }}<Icon name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="state.pin ? T.channelPinned : T.channelHelp" /></span>
          <SingleSelect :model-value="channelDraft" :options="CHANNELS" :disabled="Boolean(state.pin)" @update:model-value="draft.YTDLP_CHANNEL = String($event)" />
        </div>
        <!-- 버전 고정. 고정한 상태에서도 같은 칸 모양(입력란 자리에 고정한 버전, 버튼은 해제) -->
        <div class="min-w-0">
          <span :class="FIELD_LABEL" class="flex items-center gap-1">{{ T.pin }}<Icon name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="T.pinHelp" /></span>
          <form class="flex items-center gap-2" @submit.prevent="state.pin ? setPin(null) : setPin(pinDraft.trim())">
            <input :value="state.pin ?? pinDraft" :readonly="Boolean(state.pin)" spellcheck="false" :placeholder="T.pinPlaceholder" :aria-label="T.pin" :class="[FIELD, 'w-full min-w-0 flex-1 font-mono placeholder:font-sans', state.pin && 'text-on-surface-variant']" @input="pinDraft = valueOf($event)" />
            <BaseButton type="submit" variant="secondary" class="shrink-0" :disabled="saving || working || (!state.pin && !pinDraft.trim())">{{ state.pin ? T.unpin : T.pinApply }}</BaseButton>
          </form>
        </div>

        <div class="min-w-0">
          <span :class="FIELD_LABEL" class="flex items-center gap-1">{{ T.mode }}<Icon name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="state.pin ? T.modePinned : T.modeHelp" /></span>
          <SingleSelect :model-value="modeDraft" :options="MODES" @update:model-value="draft.YTDLP_UPDATE = String($event)" />
          <p v-if="state.nextAt && !state.failure" class="mt-1 truncate text-xs text-on-surface-variant">{{ T.nextCheck(formatDateTime(state.nextAt)) }}</p>
        </div>
      </div>

      <NoticeBox v-if="state.failure && !state.busy" variant="note" tone="error" icon="error">
        <!-- 실패와 다시 시도하는 때는 줄을 나눈다. 아이콘은 글 첫 줄에, 다시 시도 버튼은 글 전체의 가운데에 맞추고(버튼 높이 32px를 글 20px에 겹친다), 버튼은 오른쪽 끝 -->
        <span class="flex-1 min-w-0 flex items-center gap-3 flex-wrap"
          ><span class="flex-1 min-w-0 wrap-break-word"
            >{{ T.failed(state.failure.target, state.failure.reason) }}<span v-if="state.nextAt" class="block">{{ T.retryAt(formatDateTime(state.nextAt)) }}</span></span
          ><BaseButton v-if="state.pin" variant="secondary" size="sm" class="-my-1.5" :disabled="working" @click="setPin(state.pin)">{{ T.pinRetry }}</BaseButton></span
        >
      </NoticeBox>
      <NoticeBox v-else-if="state.pin && pinDays !== null && pinDays >= OLD_DAYS" variant="note" tone="notice" icon="schedule">{{ T.pinnedAge(state.pin, pinDays) }}</NoticeBox>
    </template>
    <ConfirmDialog v-model="askingRollback" icon="undo" tone="primary" :title="T.rollbackTitle" :body="T.rollbackBody(state?.previous ?? '')" :confirm-label="T.rollbackConfirm" @confirm="rollback" />
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
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
import type { VendorReply } from "../../../src/dashboard/contract/admin.ts";
import type { YtdlpCardStatus, YtdlpChannel } from "../../../src/sources/ytdlp-status-types.ts";
import { text } from "../text/index.ts";
const T = text.ytdlp;

const BASE = "/api/admin/vendor";
// 채널마다 릴리스를 내는 저장소의 태그 목록(고정할 버전을 고른다)
const RELEASES: Record<YtdlpChannel, string> = { stable: "https://github.com/yt-dlp/yt-dlp/tags", nightly: "https://github.com/yt-dlp/yt-dlp-nightly-builds/tags", master: "https://github.com/yt-dlp/yt-dlp-master-builds/tags" };
const CHANNELS: Option[] = (["stable", "nightly", "master"] as const).map((value) => ({ value, label: value }));
const MODES: Option[] = (["auto", "notify", "manual"] as const).map((value) => ({ value, label: T.modes[value] }));
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
let timer = 0;
// 이 카드에서 누른 조작(업데이트, 고정, 되돌리기)의 결과를 기다리는 중. 그 결과만 알린다(다시 읽은 상태가 화면이 들고 있던 옛 값과 달라도 알리지 않는다)
let awaiting = false;
// 상태를 읽는 중(운영자 패널의 폴링과 받는 중의 다시 읽기가 겹치지 않게)
let reading = false;

// 채널, 자동 업데이트는 운영 설정값의 고치는 중인 값(저장 바가 저장한다). 비우면 기본값
const draftOf = (key: "YTDLP_CHANNEL" | "YTDLP_UPDATE") => draft.value[key] || tunable(key).def;
const channelDraft = computed(() => draftOf("YTDLP_CHANNEL"));
const modeDraft = computed(() => draftOf("YTDLP_UPDATE"));
// 버전 목록은 저장 전이라도 선택한 채널의 목록을 연다
const releasesUrl = computed(() => RELEASES[channelDraft.value as YtdlpChannel] ?? RELEASES.nightly);
trackUnsaved(
  "update:ytdlp",
  computed(() => (["YTDLP_CHANNEL", "YTDLP_UPDATE"] as const).some((key) => tunableValue(key, draft.value[key] ?? "") !== (saved.value[key] ?? ""))),
);

// 다운로드 중이거나 저장하는 중에는 다운로드를 시작하는 버튼을 막는다
const working = computed(() => saving.value || Boolean(state.value?.busy));
// 확인으로 본 최신이 설치된 버전과 다르면 그 버전, 같으면 최신이라고 보인다
const newer = computed(() => (state.value?.seen && state.value.seen.latest !== state.value.version ? state.value.seen.latest : null));
const upToDate = computed(() => Boolean(state.value?.seen && state.value.seen.latest === state.value.version));
// 고정한 태그는 날짜로 시작한다(2026.08.19, 2026.08.19.232849). 그 날짜부터 지난 일수
const pinDays = computed(() => {
  const found = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(state.value?.pin ?? "");
  return found ? Math.floor((Date.now() - Date.UTC(Number(found[1]), Number(found[2]) - 1, Number(found[3]))) / 86_400_000) : null;
});

// 응답을 반영한다. 이 카드에서 누른 조작이 끝났으면 결과를 알리고, 진행 중이면 조금 뒤에 다시 읽는다
/** started: 조작을 보낸 직후의 응답(서버가 받기를 막 시작했을 수 있어 결과를 기다리는 표시를 풀지 않는다) */
function show({ status, tunables }: VendorReply, started = false) {
  const before = state.value;
  const now = status.ytdlp;
  state.value = now;
  if (tunables) applyCard(tunables);
  if (awaiting && before && now.failure && now.failure.at !== before.failure?.at) notify({ title: T.downloadFailed, body: now.failure.reason });
  else if (awaiting && before && now.version && now.version !== before.version) notifyDone(T.updated, now.version);
  if (!now.busy && !started) awaiting = false;
  clearTimeout(timer);
  if (now.busy) timer = window.setTimeout(() => void refresh(), POLL_MS);
}

/** 상태를 다시 읽는다. 운영자 패널이 업데이트 탭을 보이는 동안 폴링으로 부른다(자동 업데이트는 봇이 켜진 채 버전을 바꾼다) */
async function refresh() {
  if (reading) return;
  reading = true;
  try {
    show((await axios.get<VendorReply>(BASE)).data);
    loadError.value = "";
  } catch (err) {
    if (!state.value) loadError.value = problemText(err, T.loadFailed);
    else notifyProblem(err, T.loadFailed);
  } finally {
    reading = false;
  }
}

// 조작 하나를 보낸다. 설정값 상태를 바꾸는 요청이라 저장 바의 저장과 겹치지 않게 차례로 보낸다
async function act(path: string, body: object, failed: string) {
  saving.value = true;
  awaiting = true;
  try {
    show(await inOrder(async () => (await axios.post<VendorReply>(`${BASE}${path}`, body)).data), true);
    // 저장한 뒤 서버가 다운로드를 시작했을 수 있다
    clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), POLL_MS);
    return true;
  } catch (err) {
    awaiting = false;
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

const { ready, detach } = attach();
onMounted(() => {
  void refresh();
  ready.catch(() => undefined);
});
onUnmounted(() => {
  clearTimeout(timer);
  detach();
});
defineExpose({ refresh });
// 저장 바가 채널, 자동 업데이트를 저장하면 서버가 맞추기 시작한다. 조금 뒤 상태를 다시 읽는다
watch(
  () => [saved.value.YTDLP_CHANNEL, saved.value.YTDLP_UPDATE],
  () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), POLL_MS);
  },
);
</script>
