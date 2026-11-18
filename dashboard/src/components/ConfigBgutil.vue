<template>
  <!-- bgutil(POToken 공급자) 카드(업데이트 탭). 공유 타입 sources/bgutil/status-types. 설치된 버전과 POToken 서버 사용(켜기는 유튜브 탭의 설정값이라 여기서는 보이기만),
       업데이트 확인과 버전 고정(태그를 적으면 서버가 그 태그의 커밋을 확인해 보이고, 확인하면 그 짝을 고정하고 설치한다), 설정한 버전과 다른 설치의 설치,
       설치 진행(설치 중, 다른 작업 뒤로 미룸), 설치 뒤 다시 시작 예약과 그 취소, 실패와 없는 프로그램의 안내와 재시도, 다시 시작해야 적용될 때의 다시 시작.
       상태는 도구 라우트(/api/admin/vendor)를 다시 읽는다. 운영자 패널이 업데이트 탭을 보이는 동안 폴링으로 부른다(설치는 백그라운드에서 끝난다) -->
  <BaseCard icon="key" :title="T.title">
    <template #actions
      ><BaseButton variant="secondary" size="sm" :href="TAGS_URL" target="_blank" rel="noopener"><Icon name="open_in_new" :size="16" />{{ T.releases }}</BaseButton></template
    >
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>
    <template v-else-if="state">
      <div class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
        <!-- 설치된 버전과 POToken 서버 사용 -->
        <div class="min-w-0">
          <span :class="FIELD_LABEL">{{ T.installed }}</span>
          <span class="flex items-center gap-2 h-10 min-w-0 text-sm">
            <span class="min-w-0 truncate" :class="state.installed ? 'font-mono text-on-surface' : 'text-on-surface-variant'">{{ state.installed ? state.installed.tag : T.notInstalled }}</span>
            <span v-if="upToDate" class="shrink-0 text-xs text-on-surface-variant">{{ T.latest }}</span>
            <span v-else-if="servingDiffers && state.serving" class="min-w-0 truncate text-xs text-on-surface-variant">{{ T.serving(state.serving.tag) }}</span>
          </span>
        </div>
        <!-- 업데이트 확인(라벨 없는 칸, 오른쪽 정렬, 줄 높이에 맞춘다). 새 버전이 있으면 그 버전으로 고정하는 버튼 -->
        <div class="self-end flex items-center justify-end gap-2 h-10 min-w-0">
          <BaseButton v-if="newer" :disabled="working" @click="askPin(newer)">{{ T.update(newer) }}</BaseButton>
          <BaseButton v-else variant="secondary" :disabled="checking || working" @click="check">{{ checking ? T.checking : T.check }}</BaseButton>
        </div>
        <div class="min-w-0">
          <span :class="FIELD_LABEL">{{ T.use }}</span>
          <span class="flex items-center h-10 text-sm text-on-surface">{{ state.enabled ? T.on : T.off }}</span>
        </div>
        <!-- 버전 고정. 고정한 상태에서도 같은 칸 모양(입력란 자리에 고정한 버전, 버튼은 해제) -->
        <div class="min-w-0">
          <span :class="FIELD_LABEL" class="flex items-center gap-1">{{ T.pin }}<Icon name="info" :size="14" class="shrink-0 cursor-help" v-tooltip="T.pinHelp" /></span>
          <form class="flex items-center gap-2" @submit.prevent="state.pinned ? (askingUnpin = true) : askPin(pinDraft.trim())">
            <input :value="state.pinned ? state.target.tag : pinDraft" :readonly="state.pinned" spellcheck="false" :placeholder="T.pinPlaceholder(BGUTIL_VERSION)" :aria-label="T.pin" :class="[FIELD, 'w-full min-w-0 flex-1 font-mono placeholder:font-sans', state.pinned && 'text-on-surface-variant']" @input="pinDraft = valueOf($event)" />
            <BaseButton type="submit" variant="secondary" class="shrink-0" :disabled="working || (!state.pinned && !pinDraft.trim())">{{ state.pinned ? T.unpin : T.pinApply }}</BaseButton>
          </form>
        </div>
      </div>

      <!-- 진행: 설치 중, 미룸. 설치 중이고 다시 시작할 수 있으면 설치 후 다시 시작(예약했으면 그 안내와 취소. POToken 서버 사용이 꺼져 있으면 다시 시작해도 쓰지 않아 보이지 않는다) -->
      <NoticeBox v-if="state.job" variant="note" tone="notice" icon="schedule">
        <span class="flex items-start gap-3 flex-wrap"
          ><span class="flex-1 min-w-0"
            >{{ state.job === "running" ? T.installing : T.queued }}<span v-if="state.restartReserved" class="block">{{ T.reserved }}</span></span
          ><BaseButton v-if="state.restartReserved" variant="secondary" size="sm" class="-my-1.5" :disabled="working" @click="unreserve">{{ T.unreserve }}</BaseButton
          ><BaseButton v-else-if="canRestart && state.enabled" variant="secondary" size="sm" class="-my-1.5" :disabled="working" @click="askRestart('bgutil', state)">{{ T.installThenRestart }}</BaseButton></span
        >
      </NoticeBox>
      <!-- 실패, 없는 프로그램: 그 안내와 재시도(설치된 것이 없으면 켜져 있을 때만. 꺼져 있으면 설치하지 않는다) -->
      <NoticeBox v-else-if="(state.enabled || state.installed) && (state.missing?.length || state.failure) && !onTarget" variant="note" tone="error" icon="error">
        <span class="flex items-start gap-3 flex-wrap"
          ><span class="flex-1 min-w-0 wrap-break-word"
            ><BgutilNeeds v-if="state.missing?.length" :needs="state.missing" /><template v-else-if="state.failure">{{ T.failed(state.failure.reason) }}</template></span
          ><BaseButton variant="secondary" size="sm" class="-my-1.5" :disabled="working" @click="install">{{ T.retry }}</BaseButton></span
        >
      </NoticeBox>
      <!-- 설치된 것이 설정한 버전과 다르다(봇을 업데이트해 기본값이 올랐거나 고정을 바꿨다). 혼자서는 설치하지 않는다 -->
      <NoticeBox v-else-if="state.installed && !onTarget" variant="note" tone="notice" icon="download">
        <span class="flex items-start gap-3 flex-wrap"
          ><span class="flex-1 min-w-0">{{ T.differs(state.installed.tag, state.target.tag) }}</span
          ><BaseButton variant="secondary" size="sm" class="-my-1.5" :disabled="working" @click="install">{{ T.install }}</BaseButton></span
        >
      </NoticeBox>
      <NoticeBox v-else-if="state.restartNeeded" variant="note" tone="notice" icon="restart_alt">
        <span class="flex items-start gap-3 flex-wrap"
          ><span class="flex-1 min-w-0">{{ T.restartToApply }}</span
          ><BaseButton v-if="canRestart" variant="secondary" size="sm" class="-my-1.5" @click="askRestart()">{{ T.restart }}</BaseButton></span
        >
      </NoticeBox>
    </template>
    <ConfirmDialog v-model="askingPin" icon="keep" tone="primary" :title="T.pinTitle" :body="resolved ? T.pinBody(resolved.tag, resolved.commit, later) : ''" :confirm-label="T.pinConfirm" @confirm="pin" />
    <ConfirmDialog v-model="askingUnpin" icon="undo" tone="primary" :title="T.unpinTitle" :body="T.unpinBody(BGUTIL_VERSION, later)" :confirm-label="T.unpinConfirm" @confirm="unpin" />
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import BgutilNeeds from "./BgutilNeeds.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { valueOf } from "../utils/dom.ts";
import { askRestart } from "../composables/bot-restart.ts";
import { notifyProblem } from "../composables/toasts.ts";
import { applyCard, inOrder } from "../composables/tunables.ts";
import { problemText } from "../utils/problem.ts";
import { BGUTIL_VERSION } from "../../../src/config/vendor-versions.ts";
import { BGUTIL_REPO } from "../../../src/rules/bgutil-install.ts";
import type { BgutilResolveReply, VendorReply } from "../../../src/dashboard/contract/admin.ts";
import type { BgutilCardStatus } from "../../../src/sources/bgutil/status-types.ts";
import { text } from "../text/index.ts";
const T = text.bgutil;

const BASE = "/api/admin/vendor";
const TAGS_URL = `https://github.com/${BGUTIL_REPO}/tags`;

/** canRestart: 실행기로 켠 봇이라 대시보드에서 다시 시작할 수 있다 */
const props = defineProps<{ canRestart: boolean }>();

const state = ref<BgutilCardStatus | null>(null);
const loadError = ref("");
const working = ref(false);
const checking = ref(false);
const pinDraft = ref("");
/** 확인한 태그와 커밋(고정 물음에 보인다) */
const resolved = ref<BgutilResolveReply | null>(null);
const askingPin = ref(false);
const askingUnpin = ref(false);
let reading = false;

const canRestart = computed(() => props.canRestart);
// 설치된 것과 이 봇이 쓰는 것이 다르다(그사이 설치했다)
const servingDiffers = computed(() => Boolean(state.value?.installed && state.value.serving && state.value.installed.tag !== state.value.serving.tag));
// 설치된 것이 설정한 버전(태그와 커밋)이다
const onTarget = computed(() => Boolean(state.value?.installed && state.value.installed.tag === state.value.target.tag && state.value.installed.commit === state.value.target.commit));
// 확인으로 본 최신이 설정한 버전과 다르면 그 버전, 같으면 최신이라고 보인다
const newer = computed(() => (state.value?.latest && state.value.latest.tag !== state.value.target.tag ? state.value.latest.tag : null));
const upToDate = computed(() => Boolean(state.value?.latest && state.value.latest.tag === state.value.target.tag && onTarget.value));
// 꺼져 있고 설치된 것이 없으면 고정만 하고 설치는 켤 때 한다
const later = computed(() => Boolean(state.value && !state.value.enabled && !state.value.installed));

/** 상태를 다시 읽는다. 운영자 패널이 업데이트 탭을 보이는 동안 폴링으로 부른다 */
async function refresh() {
  if (reading) return;
  reading = true;
  try {
    state.value = (await axios.get<VendorReply>(BASE)).data.status.bgutil;
    loadError.value = "";
  } catch (err) {
    if (!state.value) loadError.value = problemText(err, T.loadFailed);
  } finally {
    reading = false;
  }
}

// 응답을 반영한다. 버전 고정은 설정값 상태를 바꾸므로 저장 바가 쥔 저장 번호도 맞춘다
function show({ status, tunables }: VendorReply) {
  state.value = status.bgutil;
  if (tunables) applyCard(tunables);
}

async function send(method: "post" | "delete", path: string, failed: string, body?: object) {
  working.value = true;
  try {
    show((await axios.request<VendorReply>({ method, url: `${BASE}${path}`, data: body })).data);
    return true;
  } catch (err) {
    notifyProblem(err, failed);
    return false;
  } finally {
    working.value = false;
  }
}

const install = () => send("post", "/bgutil/install", T.retryFailed);
const unreserve = () => send("delete", "/bgutil/restart-after-install", T.unreserveFailed);

async function check() {
  checking.value = true;
  try {
    show((await axios.post<VendorReply>(`${BASE}/bgutil/check`)).data);
  } catch (err) {
    notifyProblem(err, T.checkFailed);
  } finally {
    checking.value = false;
  }
}

// 태그의 커밋을 확인하고 고정 물음을 연다
async function askPin(tag: string) {
  if (!tag) return;
  working.value = true;
  try {
    resolved.value = (await axios.post<BgutilResolveReply>(`${BASE}/bgutil/resolve`, { tag })).data;
    askingPin.value = true;
  } catch (err) {
    notifyProblem(err, T.resolveFailed);
  } finally {
    working.value = false;
  }
}

// 고정, 해제. 설정값 상태를 바꾸는 요청이라 저장 바의 저장과 겹치지 않게 차례로 보낸다(최근 로그인을 요구하면 요청 도구가 다시 로그인한 뒤 다시 보낸다)
async function savePin(body: { tag: string | null; commit?: string }) {
  if (!state.value) return false;
  const expect = { tag: state.value.target.tag, commit: state.value.target.commit };
  return inOrder(() => send("post", "/bgutil/pin", T.pinFailed, { ...body, expect }));
}

async function pin() {
  askingPin.value = false;
  if (resolved.value && (await savePin(resolved.value))) pinDraft.value = "";
}

async function unpin() {
  askingUnpin.value = false;
  await savePin({ tag: null });
}

onMounted(() => void refresh());
defineExpose({ refresh });
</script>
