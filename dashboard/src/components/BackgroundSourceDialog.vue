<template>
  <!-- 로그인 배경의 변경 팝업. 파비콘의 크기별 팝업과 같은 형태: 남은 저장 공간 · 파일 업로드 · 링크로 추가 · 기록.
       기록은 행을 누르면 그 배경으로 바꾸고(다 만든 것만, 다시 만들지 않는다), 행 안 오른쪽 끝에서 삭제한다. 처리 중인 배경은 하는 일을, 실패한 배경은 까닭(툴팁)을 함께 보인다 -->
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
      <div v-if="open && state" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" tabindex="-1" @click.self="open = false" @keydown.esc="open = false">
        <div role="dialog" aria-modal="true" :aria-label="S.title" class="rounded-2xl bg-surface-container-high p-5 w-full max-w-md max-h-[90dvh] overflow-y-auto flex flex-col gap-4 animate-[art-in_350ms_var(--ease-spring-fast)]">
          <div class="flex flex-col gap-1">
            <h3 class="text-xl font-round font-semibold">{{ S.title }}</h3>
            <p class="text-sm text-on-surface-variant nums">{{ S.free(formatBytes(state.freeBytes)) }}</p>
          </div>

          <!-- 버튼 영역: 가져오는 중이면 같은 위치 · 같은 높이에 진행(파일 이름 · 진행 막대 · 지금 하는 일 한 줄 · %)을 겹쳐 그린다(팝업 높이가 그대로).
               미리보기가 생기면 카드가 이 팝업을 닫고 편집 창을 연다 -->
          <div class="grid grid-cols-[minmax(0,1fr)]">
            <section v-if="steps.length" class="[grid-area:1/1] min-w-0 flex flex-col justify-center gap-2 rounded-2xl bg-surface-container px-4" aria-live="polite">
              <span class="text-sm font-semibold truncate">{{ uploading?.name ?? pending?.name }}</span>
              <span class="h-1.5 w-full rounded-full bg-surface-container-highest overflow-hidden"><span class="block h-full bg-primary transition-[width] duration-500" :style="{ width: `${overall * 100}%` }"></span></span>
              <span class="flex items-baseline gap-2 text-xs text-on-surface-variant nums"
                ><span class="flex-1 truncate">{{ nowText }}</span
                ><span class="shrink-0">{{ Math.round(overall * 100) }}%</span></span
              >
            </section>

            <div class="[grid-area:1/1] grid grid-cols-2 gap-2" :class="steps.length > 0 && 'invisible'" :aria-hidden="steps.length > 0">
              <button type="button" class="tap state-layer flex flex-col items-center gap-1 rounded-2xl bg-surface-container-highest px-3 py-4 cursor-pointer disabled:opacity-38" :disabled="busy" @click="emit('upload')">
                <Icon name="upload" :size="24" />
                <span class="text-sm font-semibold">{{ S.fromFile }}</span>
                <span class="flex items-center gap-0.5 text-2xs text-on-surface-variant">{{ S.fileHint }}<Icon name="info" :size="14" class="cursor-help" v-tooltip="S.fileHintTip" /></span>
              </button>
              <button type="button" class="tap state-layer flex flex-col items-center gap-1 rounded-2xl px-3 py-4 cursor-pointer disabled:opacity-38" :class="linking ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-highest'" :disabled="busy" @click="toggleLink">
                <Icon name="link" :size="24" />
                <span class="text-sm font-semibold">{{ S.fromLink }}</span>
              </button>
            </div>
          </div>
          <form v-if="linking && !steps.length" class="flex flex-col gap-1" @submit.prevent="submitLink">
            <label class="text-xs text-on-surface-variant" for="bg-link">{{ S.linkLabel }}</label>
            <span class="flex gap-2">
              <input id="bg-link" ref="linkInput" v-model.trim="link" type="url" inputmode="url" :placeholder="S.linkPlaceholder" class="flex-1 min-w-0 h-10 rounded-xl bg-surface-container px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary" />
              <BaseButton type="submit" :disabled="busy || !link">{{ S.linkFetch }}</BaseButton>
            </span>
            <span v-if="linkError" class="text-xs text-error">{{ linkError }}</span>
          </form>

          <section v-if="state.list.length" class="flex flex-col gap-1">
            <h4 class="text-sm font-semibold">{{ S.historyTitle }}</h4>
            <p class="text-xs text-on-surface-variant mb-1">{{ S.historyDesc(state.limits.history) }}</p>
            <ul class="flex flex-col gap-1">
              <li v-for="one in state.list" :key="one.id" class="relative">
                <button type="button" class="tap state-layer w-full flex items-center gap-3 rounded-(--r-row) py-2 pl-2 pr-12 text-left disabled:cursor-default" :class="one.id === state.current ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container cursor-pointer'" :aria-current="one.id === state.current" :disabled="busy || one.id === state.current || !readyOf(one)" @click="emit('use', one.id)">
                  <span class="relative w-24 aspect-video shrink-0 overflow-hidden rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface-variant">
                    <img v-if="one.thumb" :src="one.thumb" alt="" class="size-full object-cover" />
                    <Icon v-else :name="one.kind === 'video' ? 'movie' : 'image'" :size="20" />
                  </span>
                  <span class="flex-1 min-w-0 flex flex-col">
                    <span class="text-sm truncate">{{ one.name }}</span>
                    <span class="text-xs opacity-80 nums"
                      >{{ S.kind[one.kind] }} · {{ S.from[one.from]
                      }}<template v-if="one.phase === 'failed'">
                        · <span class="text-error" v-tooltip="problemOf(one)">{{ S.failed }}</span></template
                      ><template v-else-if="one.stage !== null"> · {{ C.stage[one.stage] }}</template
                      ><template v-else-if="one.phase === 'queued'"> · {{ S.queued }}</template></span
                    >
                  </span>
                  <span v-if="one.id === state.current" class="flex items-center gap-1 text-xs font-semibold"><Icon name="check" :size="16" />{{ S.inUse }}</span>
                </button>
                <button type="button" :class="[ICON_BTN, 'size-8']" class="absolute right-2 top-1/2 -translate-y-1/2 hover:text-error" :disabled="busy" :aria-label="S.removeOne" v-tooltip="S.removeOne" @click="emit('remove', one.id)"><Icon name="delete" :size="18" /></button>
              </li>
            </ul>
          </section>

          <div class="flex justify-end">
            <BaseButton variant="ghost" @click="open = false">{{ text.common.close }}</BaseButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import { ICON_BTN } from "../utils/icon-button.ts";
import { noticeText } from "../utils/problem.ts";
import { text } from "../text/index.ts";
import { LOGIN_BG_BEFORE_EDIT, type LoginBackgroundItem, type LoginBackgroundState } from "../../../src/dashboard/contract/login-background.ts";
import { formatBytes } from "../../../src/ui/format.ts";
const C = text.loginBackground.card;
const S = text.loginBackground.source;

/** pending: 가져오는 중인 배경(편집 전 단계를 보인다). uploading: 봇이 받기 전, 올리는 중인 파일과 올린 몫(0 ~ 1) */
const props = defineProps<{ state: LoginBackgroundState | null; busy: boolean; pending: LoginBackgroundItem | null; uploading: { name: string; progress: number } | null }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ upload: []; link: [url: string]; use: [id: string]; remove: [id: string] }>();

/** 보일 단계: 올리는 중이면 원본 받기 하나(올린 몫), 봇이 받은 뒤면 그 배경의 편집 전 단계 */
const steps = computed(() => {
  if (props.uploading) return [props.uploading.progress];
  const bg = props.pending;
  if (!bg || bg.phase !== "preparing") return [];
  return bg.stages.filter((one) => LOGIN_BG_BEFORE_EDIT.includes(one)).map((one) => (bg.done.includes(one) ? 1 : bg.stage === one ? bg.progress : 0));
});
const overall = computed(() => (steps.value.length ? steps.value.reduce((sum, one) => sum + one, 0) / steps.value.length : 0));
/** 다 구운 배경(기록에서 교체할 수 있다) */
const readyOf = (bg: LoginBackgroundItem) => bg.phase === "ready";
/** 실패한 까닭(봇 문장표의 문제 코드 안내) */
const problemOf = (bg: LoginBackgroundItem) => (bg.problem ? noticeText(bg.problem).title : "");
/** 지금 하는 일 한 줄(올리는 중 · 그 단계의 "…하는 중" 말) */
const nowText = computed(() => {
  if (props.uploading) return S.uploading;
  const now = props.pending?.stage;
  return now ? C.stage[now] : S.preparing;
});

const linking = ref(false);
const link = ref("");
const linkError = ref("");
const linkInput = ref<HTMLInputElement | null>(null);

watch(open, (on) => {
  if (!on) return;
  linking.value = false;
  link.value = "";
  linkError.value = "";
});

async function toggleLink() {
  linking.value = !linking.value;
  linkError.value = "";
  if (linking.value) {
    await nextTick();
    linkInput.value?.focus();
  }
}

function isWebUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function submitLink() {
  const ok = isWebUrl(link.value);
  linkError.value = ok ? "" : S.linkBad;
  if (ok) emit("link", link.value);
}
</script>
