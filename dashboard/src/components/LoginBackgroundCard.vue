<template>
  <!-- 로그인 배경 카드(디스플레이 탭, 파비콘 카드 아래). /api/admin/appearance/login-background 의 상태 하나를 읽고 바꾸는 요청들도 그것으로 답한다.
       미리보기 화면: 지금 쓰는 배경을 선택한 화면 비율의 틀에 그린다(로그인 화면과 같은 LoginBackdrop, 옵션 영역의 값을 저장 전에도 바로 보인다). 정지 화면 전 새 배경은 아직 미리보기 화면에 없다(로그인 화면도 그렇다).
       아래: 로그인 화면에 지금 걸린 것 · 처리 중인 배경의 진행 · 그만두기 · 변경 · 편집 · 삭제 · 로그인 화면으로 보기.
       넓으면 미리보기 화면 영역(가운데 정렬) 오른쪽에 같은 높이의 옵션 영역: 좌우 · 상하(보일 위치) · 블러(화면 폭의 %) · 배경 불투명도(= 100 - 오버레이 진하기) · 몰입형 테마 색상 · 반복 전환 효과(영상).
       옵션 · 고급 설정은 운영자 패널의 저장 막대(SaveDock, composables/save-targets)로 저장 · 되돌린다. 접는 고급 설정: 보존 개수 · 최대 용량 · 인코딩 환경(코덱마다 쓰는 인코더 · 꺼진 까닭 · 지금 인코딩).
       만드는 동안은 운영자 패널의 상태 읽기와 같이 3초마다 다시 읽는다(화면이 숨으면 멈춘다). 로그인 배경 백업은 백업 탭(파비콘과 따로) -->
  <BaseCard icon="wallpaper" :title="C.title">
    <template #actions
      ><BaseButton size="sm" variant="secondary" @click="loginOpen = true"><Icon name="visibility" :size="16" />{{ C.viewLogin }}</BaseButton></template
    >
    <p class="mb-3 text-sm text-on-surface-variant">{{ C.desc }}</p>

    <div class="flex flex-col gap-3">
      <!-- 넓으면 왼쪽에 미리보기 화면 영역, 오른쪽에 옵션 영역(두 영역 높이를 맞춘다). 그 아래 상태 · 버튼. 좁으면 순서대로 -->
      <div class="grid gap-4 lg:grid-cols-[minmax(0,38rem)_minmax(16rem,1fr)]">
        <!-- 미리보기 화면 영역: 위에 화면 비율(버튼마다 툴팁으로 그 비율의 기기), 미리보기 화면은 영역 가운데 -->
        <div class="flex flex-col gap-3 min-w-0 rounded-2xl bg-surface-container p-4">
          <div class="flex flex-wrap justify-center gap-1">
            <button v-for="one in RATIOS" :key="one.label" type="button" class="tap state-layer h-8 px-3 rounded-full text-xs font-semibold nums cursor-pointer" :class="ratio === one ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-highest'" v-tooltip="C.ratioDevices[one.label]" @click="ratio = one">{{ one.label }}</button>
          </div>
          <label class="flex items-center justify-center gap-2 text-xs"> <BaseSwitch v-model="silhouette" :label="C.silhouette" />{{ C.silhouette }} </label>
          <!-- 미리보기 화면: 높이 PANE_REM 기준, 넓은 비율은 영역 폭에 맞춰 줄인다 -->
          <div class="flex flex-1 items-center justify-center">
            <div class="relative overflow-hidden rounded-2xl outline outline-outline-variant select-none bg-black" :style="{ aspectRatio: `${ratio.w} / ${ratio.h}`, width: `min(100%, ${(PANE_REM * ratio.w) / ratio.h}rem)` }">
              <LoginBackdrop v-if="shown" :bg="shown" :look="look" />
              <img v-else-if="avatar" :src="avatar" alt="" class="absolute inset-0 size-full object-cover" />
              <LoginSilhouette v-if="silhouette" :vw="ratio.vw" :vh="ratio.vh" :mouse="ratio.mouse" />
            </div>
          </div>
        </div>

        <!-- 옵션 영역: 화면에서 거는 것(CSS, 다시 만들지 않는다). 바꾼 값은 화면 판에 바로 보이고, 저장을 눌러야 봇에 간다 -->
        <div v-if="state" class="flex flex-col gap-4 rounded-2xl bg-surface-container p-4">
          <label v-for="axis in AXES" :key="axis.key" class="flex flex-col gap-1 text-sm">
            <span class="flex justify-between"
              ><span>{{ axis.label }}</span
              ><span class="nums text-on-surface-variant">{{ Math.round(draft.position[axis.key]) }}%</span></span
            >
            <input v-model.number="draft.position[axis.key]" type="range" min="0" max="100" step="1" :disabled="!cur" class="m3-slider m3-slider-compact" :style="{ '--v': draft.position[axis.key] / 100 }" />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span class="flex justify-between"
              ><span>{{ C.blur }}</span
              ><span class="nums text-on-surface-variant">{{ draft.look.blur.toFixed(1) }}%</span></span
            >
            <input v-model.number="draft.look.blur" type="range" :min="0" :max="LOGIN_BG_BLUR_MAX" step="0.1" class="m3-slider m3-slider-compact" :style="{ '--v': draft.look.blur / LOGIN_BG_BLUR_MAX }" />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span class="flex justify-between"
              ><span>{{ C.opacity }}</span
              ><span class="nums text-on-surface-variant">{{ 100 - draft.look.cover }}%</span></span
            >
            <input type="range" :min="OPACITY_MIN" max="100" step="5" :value="100 - draft.look.cover" class="m3-slider m3-slider-compact" :style="{ '--v': (100 - draft.look.cover - OPACITY_MIN) / (100 - OPACITY_MIN) }" @input="draft.look.cover = 100 - Number(($event.target as HTMLInputElement).value)" />
          </label>
          <template v-if="cur?.kind === 'video'">
            <label class="flex items-center gap-3 text-sm">
              <span class="flex flex-1 items-center gap-1">{{ C.immersive }}<Icon name="info" :size="16" class="cursor-help text-on-surface-variant" v-tooltip="C.immersiveTip" /></span>
              <BaseSwitch v-model="draft.look.follow" :label="C.immersive" />
            </label>
            <SeamPicker v-model="draft.look.seam" />
          </template>
          <!-- 아래: 위치 초기화(보일 위치만 가운데로) · 초기화(옵션 전부를 처음 값으로). 저장 · 되돌리기는 저장 막대 -->
          <div class="mt-auto flex justify-end gap-2">
            <BaseButton size="sm" variant="ghost" :disabled="busy || !cur || centered" @click="resetPosition">{{ C.resetPosition }}</BaseButton>
            <BaseButton size="sm" variant="ghost" :disabled="busy || isDefault" @click="resetOptions">{{ C.resetOptions }}</BaseButton>
          </div>
        </div>
      </div>

      <!-- 상태: 로그인 화면이 지금 무엇을 보이는지(만드는 동안만) · 만드는 진행 · 마지막으로 올린 배경의 실패 · 지금 배경의 정보(쓰는 영역 · 구간 · 저장 공간) -->
      <div class="flex flex-col gap-1 text-sm" data-bg-status>
        <span v-if="loginLine">{{ loginLine }}</span>
        <template v-if="work">
          <span v-if="work.phase === 'editing'" class="text-on-surface-variant">{{ C.waitingEdit }}</span>
          <span v-else-if="work.phase === 'queued'" class="text-on-surface-variant">{{ C.queued }}</span>
          <template v-else-if="work.stage">
            <span class="flex items-baseline gap-2 text-on-surface-variant nums"
              ><span class="truncate">{{ C.stageOf(work.stage, work.from) }}</span
              ><span class="ml-auto shrink-0">{{ Math.round(overall * 100) }}%</span></span
            >
            <span class="h-1.5 w-full rounded-full bg-surface-container-highest overflow-hidden"><span class="block h-full bg-primary transition-[width] duration-500" :style="{ width: `${overall * 100}%` }"></span></span>
            <span v-if="work.resumed" class="text-xs text-tertiary">{{ C.resumed }}</span>
          </template>
        </template>
        <span v-else-if="failed" class="flex items-start gap-1 text-error"><Icon name="error" :size="16" class="mt-0.5 shrink-0" />{{ C.failed(failed.name) }} {{ failedWhy }}</span>
        <span v-if="info" class="text-on-surface-variant nums">{{ info }}</span>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <BaseButton size="sm" variant="secondary" :disabled="busy || !state" @click="sourceOpen = true"><Icon :name="cur ? 'tune' : 'upload'" :size="16" />{{ cur ? C.change : C.add }}</BaseButton>
        <BaseButton v-if="editable" size="sm" variant="secondary" :disabled="busy" @click="openEdit(editable)">{{ C.edit }}</BaseButton>
        <BaseButton v-if="work" size="sm" variant="ghost" :disabled="busy" v-tooltip="encoding ? C.cancelEncodeTip : C.cancelEditTip" @click="cancelWork">{{ encoding ? C.cancelEncode : C.cancelEdit }}</BaseButton>
        <button v-if="cur" type="button" :class="[ICON_BTN, 'size-8']" class="hover:text-error" :disabled="busy" :aria-label="C.clear" v-tooltip="C.clear" @click="clear"><Icon name="delete" :size="18" /></button>
      </div>

      <!-- 고급 설정(접힘): 기록 보관 개수 · 최대 용량(쓰는 양 막대) · 인코딩 환경(코덱마다 쓰는 인코더, 꺼진 것은 까닭, 지금 인코딩). 다른 고급 설정(AI)과 같은 형태: 라벨에 툴팁 · 공용 숫자 입력란 · 빈칸이면 기본값 -->
      <details v-if="state" class="group/adv rounded-(--r-inner) bg-surface-container text-sm">
        <summary class="flex cursor-pointer list-none items-center gap-1 px-4 py-3 font-semibold"><Icon name="expand_more" :size="20" class="transition-transform group-open/adv:rotate-180" />{{ A.title }}</summary>
        <div class="flex flex-col gap-5 px-4 pb-4">
          <div class="flex flex-col gap-2">
            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span :class="FIELD_LABEL" v-tooltip="A.historyTip">{{ A.history }}</span>
                <NumberInput v-model="limitsDraft.history" :placeholder="String(DEFAULT_LIMITS.history)" :class="[FIELD, 'w-full nums']" />
              </label>
              <label class="block">
                <span :class="FIELD_LABEL" v-tooltip="A.maxSizeTip">{{ A.maxSize }}</span>
                <NumberInput v-model="limitsDraft.gb" decimal :placeholder="String(DEFAULT_LIMITS.gb)" :class="[FIELD, 'w-full nums']" />
              </label>
            </div>
            <!-- 쓰는 용량(무제한이면 막대 없이) -->
            <span class="flex items-baseline justify-between text-xs text-on-surface-variant nums"
              ><span>{{ A.usedLabel }}</span
              ><span>{{ A.used(formatBytes(state.usedBytes), state.limits.maxBytes ? formatBytes(state.limits.maxBytes) : null) }}</span></span
            >
            <span v-if="state.limits.maxBytes" class="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest"><span class="block h-full rounded-full bg-primary" :style="{ width: `${Math.min(100, (state.usedBytes / state.limits.maxBytes) * 100)}%` }"></span></span>
          </div>
          <div class="flex flex-col gap-2">
            <span class="flex items-center gap-2">
              <span :class="FIELD_LABEL" class="mb-0!" v-tooltip="A.encodersTip">{{ A.encoders }}</span>
              <BaseButton size="sm" variant="ghost" class="ml-auto" :disabled="busy || state.checking" @click="recheck">{{ state.checking ? A.checking : A.recheck }}</BaseButton>
            </span>
            <ul class="flex flex-col gap-1.5">
              <li v-for="one in state.encoders" :key="one.codec" class="flex flex-col">
                <span class="flex items-baseline gap-2"
                  ><span class="w-14 shrink-0 font-semibold">{{ A.codec[one.codec] }}</span
                  ><span :class="one.encoder ? 'text-on-surface-variant' : 'text-error'">{{ one.encoder ? A.use(A.encoderName[one.encoder] ?? one.encoder, one.hardware) : A.noEncoder }}</span></span
                >
                <span v-if="one.why" class="ml-16 flex items-start gap-1 text-xs text-(--warn-ink)"><Icon name="warning" :size="14" class="mt-px shrink-0" />{{ one.why }}</span>
              </li>
            </ul>
            <!-- 지금 인코딩: 함께 굽는 단계 · AV1 병렬 단계(남은 메모리에 맞춰 정한 것) · 묶은 코어 · 속도. 메모리 · 이벤트 루프 지연은 봇 상태 탭 -->
            <span v-if="bakeLine" class="flex items-baseline gap-2 text-xs nums"
              ><span class="shrink-0 font-semibold" v-tooltip="A.bakeTip">{{ A.bakeTitle }}</span
              ><span class="text-on-surface-variant">{{ bakeLine }}</span></span
            >
          </div>
        </div>
      </details>
    </div>
    <input ref="fileInput" type="file" accept="image/*,video/*" class="hidden" @change="onPick" />
  </BaseCard>

  <BackgroundSourceDialog v-model="sourceOpen" :state="state" :busy="busy" :pending="pending" :uploading="uploading" @upload="pickFile" @link="fromLink" @use="useBg" @remove="removeBg" />
  <BackgroundEditDialog v-model="editOpen" :bg="editing" :state="state" :seam="draft.look.seam" @done="applyEdit" @recount="recount" />

  <!-- 로그인 화면으로 보기: 지금 쓰는 배경(고친 값, 없으면 화면 판처럼 봇 그림) 위에 실제 로그인 화면. 그동안은 그 배경의 색을 화면 색으로 칠한다 -->
  <Teleport to="body">
    <div v-if="loginOpen" class="fixed inset-0 z-400 bg-surface">
      <LoginBackdrop v-if="shown" :bg="shown" :look="look" paint-theme />
      <img v-else-if="avatar" :src="avatar" alt="" class="absolute inset-0 size-full object-cover" />
      <div class="relative z-10 h-full overflow-auto"><LoginView preview /></div>
      <BaseButton class="fixed z-20 right-4 top-4" variant="secondary" @click="loginOpen = false">{{ C.closeLogin }}</BaseButton>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import BaseSwitch from "./BaseSwitch.vue";
import SeamPicker from "./SeamPicker.vue";
import NumberInput from "./NumberInput.vue";
import Icon from "./BaseIcon.vue";
import LoginBackdrop from "./LoginBackdrop.vue";
import LoginSilhouette from "./LoginSilhouette.vue";
import BackgroundSourceDialog from "./BackgroundSourceDialog.vue";
import BackgroundEditDialog from "./BackgroundEditDialog.vue";
import LoginView from "../views/LoginView.vue";
import { FIELD, FIELD_LABEL } from "../utils/field.ts";
import { ICON_BTN } from "../utils/icon-button.ts";
import { LIMIT } from "../utils/request.ts";
import { noticeText } from "../utils/problem.ts";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { useSaveTarget } from "../composables/save-targets.ts";
import { formatBytes } from "../../../src/ui/format.ts";
import { LOGIN_BG_BEFORE_EDIT, LOGIN_BG_BLUR_MAX, LOGIN_BG_COVER_MAX, LOGIN_BG_LIMITS_DEFAULT, LOGIN_BG_OPTIONS_DEFAULT, type LoginBackground, type LoginBackgroundCrop, type LoginBackgroundEdit, type LoginBackgroundItem, type LoginBackgroundLook, type LoginBackgroundOptions, type LoginBackgroundState } from "../../../src/dashboard/contract/login-background.ts";
import { text } from "../text/index.ts";
const C = text.loginBackground.card;
const A = text.loginBackground.advanced;
const N = text.loginBackground.notice;

const API = "/api/admin/appearance/login-background";
/** 운영자 패널의 상태 읽기와 같은 주기 */
const POLL_MS = 3000;
/** 다시 세는 동안은 더 자주 */
const COUNT_POLL_MS = 1000;
/** 배경 불투명도 슬라이더의 아래(= 100 - 오버레이 진하기 상한) */
const OPACITY_MIN = 100 - LOGIN_BG_COVER_MAX;
/** 화면 판의 높이(rem). 넓은 비율은 영역 폭에 맞춰 줄인다 */
const PANE_REM = 20;
/** 보일 위치 슬라이더 */
const AXES = [
  { key: "x" as const, label: C.positionX },
  { key: "y" as const, label: C.positionY },
];
/** 화면 비율(그 비율의 기기 이름은 문구표). vw · vh 는 그 기기의 대표 CSS 크기(로그인 화면 실루엣에 쓴다), mouse 는 마우스 기기 */
const RATIOS = [
  { label: "16:9", w: 16, h: 9, vw: 1920, vh: 1080, mouse: true },
  { label: "16:10", w: 16, h: 10, vw: 1440, vh: 900, mouse: true },
  { label: "3:2", w: 3, h: 2, vw: 1440, vh: 960, mouse: true },
  { label: "21:9", w: 21, h: 9, vw: 2520, vh: 1080, mouse: true },
  { label: "4:3", w: 4, h: 3, vw: 1366, vh: 1024, mouse: false },
  { label: "3:4", w: 3, h: 4, vw: 1024, vh: 1366, mouse: false },
  { label: "9:19.5", w: 9, h: 19.5, vw: 393, vh: 852, mouse: false },
  { label: "9:20", w: 9, h: 20, vw: 412, vh: 915, mouse: false },
  { label: "9:22", w: 9, h: 22, vw: 412, vh: 1004, mouse: false },
];

const state = ref<LoginBackgroundState | null>(null);
const busy = ref(false);
const ratio = ref(RATIOS[0]);
/** 화면 판에 로그인 화면 실루엣을 겹친다 */
const silhouette = ref(true);
const sourceOpen = ref(false);
const editOpen = ref(false);
const loginOpen = ref(false);
const editingId = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const avatar = ref<string | null>(null);
/** 가져오기를 시작한 배경. 미리보기가 생기면(편집 전 단계가 끝나면) 편집 창을 연다 */
const pendingEdit = ref<string | null>(null);
/** 올리는 중인 파일(봇이 받기 전까지 팝업이 올린 양을 보인다) */
const uploading = ref<{ name: string; progress: number } | null>(null);
/** 팝업이 진행을 보일 배경 */
const pending = computed(() => byId(pendingEdit.value));

const byId = (id: string | null) => state.value?.list.find((bg) => bg.id === id) ?? null;
const cur = computed(() => byId(state.value?.current ?? null));
/** 처리 중 · 차례를 기다리는 · 편집을 기다리는 가장 새 배경 */
const work = computed(() => state.value?.list.find((bg) => bg.phase === "preparing" || bg.phase === "editing" || bg.phase === "queued" || bg.phase === "encoding") ?? null);
/** 마지막으로 올린 배경이 실패했으면 그것(까닭을 보인다) */
const failed = computed(() => (state.value?.list[0]?.phase === "failed" ? state.value.list[0] : null));
const failedWhy = computed(() => (failed.value?.problem ? noticeText(failed.value.problem).body : ""));
/** 편집을 적용한 뒤(인코딩 중 · 차례 기다림)인지. 아니면 편집을 마치기 전(가져오기 · 프리뷰 · 스프라이트 · 편집 대기) */
const encoding = computed(() => work.value?.phase === "queued" || work.value?.phase === "encoding");
/** 만드는 진행: 지금 하는 쪽(편집 전 · 적용 뒤) 단계들 안에서 */
const overall = computed(() => {
  const bg = work.value;
  if (!bg?.stage) return 0;
  const before = LOGIN_BG_BEFORE_EDIT.includes(bg.stage);
  const steps = bg.stages.filter((one) => LOGIN_BG_BEFORE_EDIT.includes(one) === before);
  return steps.length ? steps.reduce((sum, one) => sum + (bg.done.includes(one) ? 1 : bg.stage === one ? bg.progress : 0), 0) / steps.length : 0;
});
/** 로그인 화면 줄: 새 배경을 만드는 동안만(다 만들면 말하지 않는다). 정지 화면 전에는 지금 배경 그대로, 정지 화면이 생기면 새 배경으로 넘어간다 */
const loginLine = computed(() => {
  const bg = work.value;
  if (bg && encoding.value) {
    if (bg.id !== state.value?.current) return C.loginMaking;
    if (bg.kind === "video") return bg.shows === "partial" ? C.loginPartial : C.loginThumb;
    return "";
  }
  return cur.value ? "" : C.none;
});
/** 지금 배경의 정보: 쓰는 영역(원본에서 자른 크기) · 구간 길이(영상) · 저장 공간(만든 것 전부) */
const info = computed(() => {
  const bg = cur.value;
  if (!bg?.edit || !bg.width) return "";
  const w = Math.round(bg.width * bg.edit.crop.w);
  const h = Math.round(bg.height * bg.edit.crop.h);
  const seconds = bg.edit.range ? bg.edit.range[1] - bg.edit.range[0] : null;
  return C.info(w, h, seconds, formatBytes(bg.bytes));
});
const editing = computed(() => byId(editingId.value));
/** 편집 버튼이 여는 것: 편집을 기다리는 배경만(적용한 뒤에는 원본이 없어 다시 편집하지 않는다, 바꾸려면 다시 올린다) */
const editable = computed(() => (work.value?.phase === "editing" ? work.value : null));
/** 지금 인코딩 한 줄: 코덱마다 단계(짧은 변 2160 은 4K) · 병렬 단계 · 코어 · 속도 */
const bakeLine = computed(() => {
  const bake = state.value?.bake;
  if (!bake) return "";
  const label = (short: number) => (short >= 2160 ? "4K" : `${short}p`);
  const codecs = [...new Set(bake.rungs.map((one) => A.codec[one.codec]))].join(" · ");
  const shorts = [...new Set(bake.rungs.map((one) => one.short))]
    .sort((a, b) => a - b)
    .map(label)
    .join(" · ");
  return A.bake(`${codecs} ${shorts}`, bake.lp, A.cores(bake.cores.bound, bake.cores.total), bake.speed);
});

// ── 옵션 영역의 고친 값(저장 전) ──

const copyLook = (look: LoginBackgroundOptions): LoginBackgroundOptions => ({ ...look, seam: { ...look.seam } });
/** 고친 값: 지금 배경의 보일 위치 · 화면에서 거는 것 */
const draft = reactive({ position: { x: 50, y: 50 }, look: copyLook(LOGIN_BG_OPTIONS_DEFAULT) });
const saved = computed(() => ({ position: cur.value?.position ?? { x: 50, y: 50 }, look: state.value?.options ?? LOGIN_BG_OPTIONS_DEFAULT }));
const sameLook = (a: LoginBackgroundOptions, b: LoginBackgroundOptions) => a.blur === b.blur && a.cover === b.cover && a.follow === b.follow && a.seam.kind === b.seam.kind && a.seam.seconds === b.seam.seconds;
const dirty = computed(() => draft.position.x !== saved.value.position.x || draft.position.y !== saved.value.position.y || !sameLook(draft.look, saved.value.look));
/** 미리보기 화면 · 로그인 화면으로 보기에 그릴 값: 고친 화면 값 · 보일 위치 */
const look = computed<LoginBackgroundLook>(() => ({ ...draft.look, position: { ...draft.position } }));
function revert() {
  draft.position = { ...saved.value.position };
  draft.look = copyLook(saved.value.look);
}

// ── 화면 판에 그릴 것: 로그인 화면이 받는 배경 정보(지금 배경이 걸 것을 가졌을 때만) ──

const shown = ref<Exclude<LoginBackground, { kind: "none" }> | null>(null);
async function loadShown() {
  try {
    const got = (await axios.get<LoginBackground>("/api/login-background")).data;
    shown.value = got.kind === "none" ? null : got;
  } catch {
    // 꾸밈이다. 못 불러오면 봇 그림으로
  }
}
// 지금 배경 · 걸 수 있는 것(정지 화면 → 저화질 → 다)이 바뀌면 다시 불러온다
watch(
  () => JSON.stringify([state.value?.current, state.value?.shows]),
  () => void loadShown(),
);

// ── 고급 설정의 고친 값 ──

/** 한도의 처음 값(빈칸이면 이것) */
const DEFAULT_LIMITS = { history: LOGIN_BG_LIMITS_DEFAULT.history, gb: LOGIN_BG_LIMITS_DEFAULT.maxBytes / 1024 ** 3 };
const limitsDraft = reactive<{ history: number | null; gb: number | null }>({ history: null, gb: null });
/** 고친 입력란이 비었으면 처음 값 */
const limitsWanted = computed(() => ({ history: limitsDraft.history ?? DEFAULT_LIMITS.history, maxBytes: Math.round((limitsDraft.gb ?? DEFAULT_LIMITS.gb) * 1024 ** 3) }));
const limitsDirty = computed(() => !!state.value && (limitsWanted.value.history !== state.value.limits.history || limitsWanted.value.maxBytes !== state.value.limits.maxBytes));
function revertLimits() {
  if (!state.value) return;
  limitsDraft.history = state.value.limits.history;
  limitsDraft.gb = Number((state.value.limits.maxBytes / 1024 ** 3).toFixed(1));
}

function apply(next: LoginBackgroundState) {
  const wasDirty = dirty.value;
  const wasLimitsDirty = limitsDirty.value;
  const before = state.value?.current ?? null;
  state.value = next;
  // 고친 값이 없으면(또는 배경이 바뀌면) 저장한 값을 따라간다. 고치는 중이면 두고 본다
  if (!wasDirty || before !== next.current) revert();
  if (!wasLimitsDirty) revertLimits();
  const waiting = byId(pendingEdit.value);
  if (waiting?.phase === "editing" && !editOpen.value) {
    sourceOpen.value = false;
    openEdit(waiting);
    pendingEdit.value = null;
  }
  // 가져오다 실패했으면 기다리지 않는다(팝업 · 카드가 까닭을 보인다)
  if (waiting?.phase === "failed") pendingEdit.value = null;
}
const load = async () => apply((await axios.get<LoginBackgroundState>(API)).data);

async function run(job: () => Promise<void>, failure = N.failed) {
  busy.value = true;
  try {
    await job();
  } catch (err) {
    notifyProblem(err, failure);
  } finally {
    busy.value = false;
  }
}

function openEdit(bg: LoginBackgroundItem) {
  editingId.value = bg.id;
  editOpen.value = true;
}

// ── 변경 팝업 ──

function pickFile() {
  fileInput.value?.click();
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  void run(async () => {
    uploading.value = { name: file.name, progress: 0 };
    try {
      // 파일 그대로(종류는 봇이 원본을 읽어 다시 정한다). 큰 영상이라 시간 한도를 두지 않는다
      const next = (
        await axios.post<LoginBackgroundState>(`${API}/upload?name=${encodeURIComponent(file.name)}`, file, {
          headers: { "Content-Type": file.type || "application/octet-stream" },
          timeout: LIMIT.none,
          onUploadProgress: (e) => uploading.value && (uploading.value.progress = e.total ? e.loaded / e.total : 0),
        })
      ).data;
      // 봇이 미리보기를 만들면 편집 창이 열린다(링크와 같다). 그동안 팝업이 진행을 보인다
      pendingEdit.value = next.list[0]?.id ?? null;
      apply(next);
    } finally {
      uploading.value = null;
    }
  });
}

function fromLink(url: string) {
  void run(async () => {
    const next = (await axios.post<LoginBackgroundState>(`${API}/link`, { url })).data;
    pendingEdit.value = next.list[0]?.id ?? null;
    apply(next);
  });
}

const useBg = (id: string) =>
  run(async () => {
    apply((await axios.put<LoginBackgroundState>(`${API}/current`, { id })).data);
    notifyDone(N.applied);
  });
const removeBg = (id: string) =>
  run(async () => {
    apply((await axios.delete<LoginBackgroundState>(`${API}/${id}`)).data);
    notifyDone(N.removed);
  });
const clear = () =>
  run(async () => {
    apply((await axios.delete<LoginBackgroundState>(`${API}/current`)).data);
    notifyDone(N.cleared);
  });

/** 편집 적용: 편집 창에서 고른 반복 전환 효과는 화면 값으로 저장한다(카드에서 나중에 바꿀 수 있다). 저장 전에 고친 다른 화면 값은 그대로 둔다 */
function applyEdit(edit: LoginBackgroundEdit, seam: LoginBackgroundOptions["seam"]) {
  const id = editingId.value;
  if (!id) return;
  void run(async () => {
    apply((await axios.put<LoginBackgroundState>(`${API}/${id}/edit`, edit)).data);
    const savedSeam = state.value?.options.seam;
    if (state.value && (savedSeam?.kind !== seam.kind || savedSeam.seconds !== seam.seconds)) apply((await axios.put<LoginBackgroundState>(`${API}/options`, { ...copyLook(state.value.options), seam })).data);
    draft.look.seam = { ...seam };
    void loadShown();
    notifyDone(N.applied);
  });
}

const cancelWork = () =>
  run(async () => {
    const bg = work.value;
    if (!bg) return;
    apply((await axios.post<LoginBackgroundState>(`${API}/${bg.id}/cancel`)).data);
    notifyDone(N.canceled);
  });
const recheck = () => run(async () => apply((await axios.post<LoginBackgroundState>(`${API}/encoders/check`)).data));

// ── 저장 막대(운영자 패널의 SaveDock)에 올린다: 옵션 · 고급 설정 ──

const savingOptions = ref(false);
const savingLimits = ref(false);
/** 저장: 보일 위치(지금 배경) · 화면에서 거는 것 */
async function saveOptions() {
  savingOptions.value = true;
  try {
    const bg = cur.value;
    if (bg) await axios.put(`${API}/${bg.id}/position`, draft.position);
    state.value = (await axios.put<LoginBackgroundState>(`${API}/options`, copyLook(draft.look))).data;
    revert();
    void loadShown();
    return true;
  } catch (err) {
    notifyProblem(err, N.failed);
    return false;
  } finally {
    savingOptions.value = false;
  }
}
async function saveLimits() {
  savingLimits.value = true;
  try {
    state.value = (await axios.put<LoginBackgroundState>(`${API}/limits`, limitsWanted.value)).data;
    revertLimits();
    return true;
  } catch (err) {
    notifyProblem(err, N.failed);
    return false;
  } finally {
    savingLimits.value = false;
  }
}
useSaveTarget({ tab: "appearance", dirty, saving: savingOptions, save: saveOptions, revert });
useSaveTarget({ tab: "appearance", dirty: limitsDirty, saving: savingLimits, save: saveLimits, revert: revertLimits });
/** 편집 창에서 크롭을 정하거나 구간을 넓히면 그것만 다시 센다(세는 동안은 더 자주 다시 읽는다) */
function recount(id: string, crop: LoginBackgroundCrop, range: [number, number] | null) {
  void run(async () => {
    apply((await axios.put<LoginBackgroundState>(`${API}/${id}/estimate`, { crop, range })).data);
    const again = async () => {
      await load();
      if (byId(id)?.estimate?.counting && editOpen.value) countTimer = window.setTimeout(() => void again(), COUNT_POLL_MS);
    };
    clearTimeout(countTimer);
    countTimer = window.setTimeout(() => void again(), COUNT_POLL_MS);
  });
}
let countTimer = 0;

/** 보일 위치가 가운데인지 */
const centered = computed(() => draft.position.x === 50 && draft.position.y === 50);
const isDefault = computed(() => sameLook(draft.look, LOGIN_BG_OPTIONS_DEFAULT) && centered.value);
/** 보일 위치만 가운데로(저장은 저장 버튼으로) */
function resetPosition() {
  draft.position = { x: 50, y: 50 };
}
/** 옵션을 처음 값으로(저장은 저장 버튼으로) */
function resetOptions() {
  resetPosition();
  draft.look = copyLook(LOGIN_BG_OPTIONS_DEFAULT);
}

// 만드는 중 · 가져오기를 기다리는 중 · 인코더를 테스트하는 중이면 3초마다 다시 읽는다(화면이 숨으면 건너뛴다). 편집을 기다리는 동안은 바뀌는 것이 없다
let timer = 0;
const polling = computed(() => Boolean(work.value && work.value.phase !== "editing") || pendingEdit.value !== null || Boolean(state.value?.checking));
watch(polling, (on) => {
  clearInterval(timer);
  if (on)
    timer = window.setInterval(
      () =>
        !document.hidden &&
        void load().catch(() => {
          // 다음 주기에 다시 읽는다
        }),
      POLL_MS,
    );
});

onMounted(async () => {
  await load().catch((err: unknown) => notifyProblem(err, N.failed));
  void loadShown();
  try {
    avatar.value = (await axios.get<{ avatarUrl: string | null }>("/api/bot")).data.avatarUrl ?? null;
  } catch {
    // 화면 판의 기본 그림만 빈다
  }
});
onBeforeUnmount(() => {
  clearInterval(timer);
  clearTimeout(countTimer);
});
</script>
