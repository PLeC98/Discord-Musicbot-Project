<template>
  <!-- 초기화(운영자 패널 백업 · 초기화 탭). 계약 contract/reset. 줄 다섯: 오디오 캐시 · 봇 설정 · 서버별 설정 · 디스플레이 설정 · 봇 전체.
       줄마다 이름 · 무엇을 삭제하는지 · 버튼, 누르면 확인 창(삭제할 양을 숫자로). 오디오 캐시는 선택하는 것(직접 지정한 음원은 처음에 꺼 둔다), 봇 전체는 봇 이름을 입력해야 연다.
       모두 최근 로그인을 본다. 봇 설정은 다시 시작해야 먹는 값이 바뀌었으면 다시 시작 창을 연다. 봇 전체는 실행기로 켠 봇이면 다시 시작을 기다려 화면을 새로고침한다 -->
  <!-- 뿌리 하나(받은 class 가 카드 쪽에 붙게) -->
  <div>
    <BaseCard icon="delete_sweep" :title="T.title">
      <NoticeBox v-if="view?.staged" variant="note" tone="notice" icon="info" class="mt-0! mb-3">
        <span class="flex flex-wrap items-center gap-2"
          >{{ T.staged }}<BaseButton variant="ghost" size="sm" class="ml-auto" :disabled="busy" @click="unstage">{{ T.unstage }}</BaseButton></span
        >
      </NoticeBox>
      <div class="flex flex-col">
        <div v-for="kind in RESET_KINDS" :key="kind" :class="actionRow" class="border-t border-outline-variant/40 first:border-t-0">
          <div class="min-w-0 flex-1 basis-56">
            <p class="text-sm font-semibold" :class="kind === 'all' ? 'text-error' : 'text-on-surface'">{{ T.rows[kind].title }}</p>
            <p class="text-xs text-on-surface-variant">{{ T.rows[kind].desc }}</p>
          </div>
          <BaseButton variant="ghost" class="text-error!" :disabled="busy || (kind === 'all' && view?.staged)" @click="ask(kind)">{{ busy && asking === kind ? T.running : T.run }}</BaseButton>
        </div>
      </div>
    </BaseCard>

    <!-- 확인 창: 삭제할 양을 숫자로. 오디오 캐시는 선택하는 것, 봇 전체는 봇 이름 -->
    <!-- ConfirmDialog 와 같은 모양에 선택 항목 · 이름 입력란을 더한 창 -->
    <Teleport to="body">
      <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
        <div v-if="asking" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="close">
          <div role="alertdialog" aria-modal="true" class="rounded-2xl bg-surface-container-high p-6 w-full max-w-md animate-[art-in_350ms_var(--ease-spring-fast)]">
            <span class="size-12 rounded-full flex items-center justify-center mx-auto mb-4 bg-error-container text-on-error-container"><Icon name="delete" :size="24" /></span>
            <h3 class="text-xl font-round font-semibold text-center mb-4">{{ T.confirm[asking].title }}</h3>
            <p v-if="bodyOf(asking)" class="text-sm text-on-surface-variant text-center whitespace-pre-line mb-4">{{ bodyOf(asking) }}</p>
            <div v-if="asking === 'audio-cache' && view" class="flex flex-col gap-1 mb-4">
              <label v-for="part in AUDIO_CACHE_PARTS" :key="part" class="flex items-center gap-3 min-h-12 px-2 rounded-(--r-row) cursor-pointer state-layer">
                <BaseSwitch v-model="parts[part]" :label="T.parts[part].label" />
                <span class="flex-1 min-w-0">
                  <span class="block text-body font-medium">{{ T.parts[part].label }}</span>
                  <span class="block text-label text-on-surface-variant">{{ T.parts[part].desc(counts) }}</span>
                </span>
              </label>
            </div>
            <label v-if="asking === 'all' && view" class="flex flex-col gap-1 mb-4">
              <span class="text-label text-on-surface-variant">{{ T.confirm.all.typeName(view.botName) }}</span>
              <input v-model="typed" type="text" :class="[FIELD, 'w-full']" :placeholder="view.botName" />
            </label>
            <div class="flex gap-2 justify-end">
              <BaseButton variant="ghost" :disabled="busy" @click="close">{{ CANCEL }}</BaseButton>
              <BaseButton variant="danger" :disabled="!canRun" @click="run">{{ T.confirm[asking].button }}</BaseButton>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import BaseSwitch from "./BaseSwitch.vue";
import Icon from "./BaseIcon.vue";
import { text } from "../text/index.ts";
import NoticeBox from "./NoticeBox.vue";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { askRestart, currentPid, waitRestart } from "../composables/bot-restart.ts";
import { LIMIT } from "../utils/request.ts";
import { FIELD } from "../utils/field.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import { AUDIO_CACHE_PARTS, AUDIO_CACHE_PARTS_DEFAULT, RESET_KINDS, type AudioCachePart, type ResetDone, type ResetKind, type ResetOverview, type ResetRequest } from "../../../src/dashboard/contract/reset.ts";
const T = text.reset;

const API = "/api/admin/reset";
const CANCEL = text.common.cancel;
// 줄 하나: 이름 · 설명, 오른쪽에 버튼. 좁으면 버튼이 아래로
const actionRow = "flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0";

const view = ref<ResetOverview | null>(null);
const asking = ref<ResetKind | null>(null);
const busy = ref(false);
const typed = ref("");
const parts = reactive(Object.fromEntries(AUDIO_CACHE_PARTS.map((part) => [part, AUDIO_CACHE_PARTS_DEFAULT.includes(part)])) as Record<AudioCachePart, boolean>);
const counts = computed(() => ({ ...view.value!.audioCache, bytes: formatBytes(view.value!.audioCache.bytes) }));

async function load() {
  try {
    view.value = (await axios.get<ResetOverview>(API)).data;
  } catch (e) {
    notifyProblem(e, T.loadFailed);
  }
}
onMounted(load);

function ask(kind: ResetKind) {
  asking.value = kind;
  typed.value = "";
  for (const part of AUDIO_CACHE_PARTS) parts[part] = AUDIO_CACHE_PARTS_DEFAULT.includes(part);
  void load();
}
function close() {
  if (!busy.value) asking.value = null;
}
function bodyOf(kind: ResetKind | null): string {
  if (!kind || !view.value) return "";
  const c = T.confirm;
  if (kind === "audio-cache") return "";
  if (kind === "bot-settings") return c["bot-settings"].body({ changed: view.value.botSettings.tunables + view.value.botSettings.documents, secrets: view.value.botSettings.secrets });
  if (kind === "guild-settings") return c["guild-settings"].body(view.value.guildSettings.guilds);
  if (kind === "display") return c.display.body(view.value.display);
  const restore = view.value.restore.snapshot || view.value.restore.audioCache ? `\n${c.all.restore}` : "";
  return `${c.all.body(view.value.launcher)}${restore}`;
}
const chosenParts = computed(() => AUDIO_CACHE_PARTS.filter((part) => parts[part]));
const canRun = computed(() => !busy.value && (asking.value !== "audio-cache" || chosenParts.value.length > 0) && (asking.value !== "all" || typed.value === view.value?.botName));

function requestOf(kind: ResetKind): ResetRequest {
  if (kind === "audio-cache") return { kind, parts: chosenParts.value };
  if (kind === "all") return { kind, confirmName: typed.value };
  return { kind };
}
function announce(done: ResetDone) {
  if (done.kind === "audio-cache") notifyDone(T.done.cache, T.done["audio-cache"](done.removedFiles, formatBytes(done.freedBytes), done.keptFiles));
  else if (done.kind === "bot-settings") notifyDone(T.done["bot-settings"]);
  else if (done.kind === "guild-settings") notifyDone(T.done["guild-settings"](done.guilds));
  else if (done.kind === "display") notifyDone(T.done.display);
  // 다시 시작하는 봇은 다시 시작 창(기다리기 · 새로고침)이 알린다
  else if (!done.restarting) notifyDone(T.done.allStaged, T.done.allStagedBody);
}
async function run() {
  if (!asking.value || !canRun.value) return;
  busy.value = true;
  try {
    // 봇 전체: 봇이 답을 보낸 뒤 스스로 다시 시작한다. 새 봇을 알아보려고 보내기 전의 프로세스를 받아 둔다
    const before = asking.value === "all" ? await currentPid().catch(() => null) : null;
    const { data } = await axios.post<ResetDone>(API, requestOf(asking.value), { timeout: LIMIT.long });
    announce(data);
    asking.value = null;
    // 다시 시작해야 먹는 값(POToken · SponsorBlock)이 바뀌었으면 묻는다(지금 다시 시작 · 나중에)
    if (data.kind === "bot-settings" && data.restart) askRestart();
    if (data.kind === "all" && data.restarting && before !== null) return void waitRestart(before);
    await load();
  } catch (e) {
    notifyProblem(e, T.failed);
  } finally {
    busy.value = false;
  }
}
async function unstage() {
  busy.value = true;
  try {
    view.value = (await axios.delete<ResetOverview>(`${API}/staged`)).data;
  } catch (e) {
    notifyProblem(e, T.failed);
  } finally {
    busy.value = false;
  }
}
</script>
