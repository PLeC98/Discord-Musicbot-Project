<!--
  AI 보조 설정 (운영자 패널). 여기는 목록 · 상세 레이아웃과 대화상자, 카드는 ConfigAI* 컴포넌트, 상태 · 동작은 composables/ai-editor.

  설정과 **프롬프트**는 settings.db 의 딴 문서("ai" · "ai-prompt")다. 저장은 한 요청으로 둘을 함께 한다.

  키는 쓰기 전용이다. 프로바이더마다 따로 비밀 테이블에 암호화해 두고, 입력할 수는 있어도
  화면으로 되읽지는 못한다. 값을 내려보내면 XSS 하나로 새어 나간다.
  키는 입력할 때 화면에 입력된 주소(custom 의 주소 · 버텍스의 리전)에 묶인다. 저장된 주소가 다르면 쓰이지 않는다(moved).

  미리보기는 **보내지 않고 만들기만** 한다. 테스트는 설정한 엔드포인트로 **실제로 보낸다**.
  조립은 봇이 쓰는 코드를 그대로 부르므로, 보이는 것과 나가는 것이 어긋날 수 없다.
-->
<template>
  <!-- 목록 · 상세(자동재생 · 상태 문구와 같은 레이아웃, composables/list-detail 의 배치). 목록 헤더에 켜고 끄기 스위치 · 무엇을 하는지 한 줄.
       목록: 모델 · 프롬프트 · 고급 설정 · 리퀘스트 로그 · 사용량 통계. 선택한 것은 주소 ?ai=(두 단이면 선택한 것이 없을 때 모델) -->
  <div class="flex flex-col gap-(--gap-in)">
    <NoticeBox v-if="problems.length" variant="note" tone="error" icon="error" class="mt-0!">{{ problems.join(NL) }}</NoticeBox>
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>

    <!-- 그룹: 모델(프로바이더 · 주소 · 키 · 모델이 한 카드, 연결 테스트 · 모델 파라미터) · 프롬프트(후보 목록 · 판정 프롬프트 · 판정 테스트) · 고급 설정(부르기 · 재시도) · 리퀘스트 로그 · 사용량 통계(둘 다 플레이스홀더만) -->
    <div ref="paneEl" :class="paneClass">
      <!-- 목록: 모델 · 프롬프트(후보 목록 · 판정 프롬프트 · 판정 테스트를 그 안에 모아서) · 고급 설정 · 리퀘스트 로그 · 사용량 통계. 프로바이더를 선택하지 않았으면 모델 · 리퀘스트 로그 · 사용량 통계만 -->
      <BaseCard v-if="showList" icon="campaign" :title="T.title" :class="listCardClass">
        <template #actions><BaseSwitch v-model="aiOn" :label="T.enable" /></template>
        <!-- 무엇을 하는지 한 줄, 자세한 것은 툴팁 -->
        <p class="mb-3 flex items-center gap-1 text-sm text-on-surface-variant">{{ T.desc }}<Icon name="info" :size="16" class="shrink-0 cursor-help" v-tooltip="T.descTip" /></p>
        <div class="min-h-0 overflow-y-auto -mx-2 px-2">
          <div v-for="item in FIXED_ITEMS" :key="item.id" role="button" :tabindex="ALWAYS_OPEN.includes(item.id) || on ? 0 : -1" :class="[LIST_ROW, isOn(item.id) && SELECT_ROW_ON, !ALWAYS_OPEN.includes(item.id) && !on && 'opacity-38 pointer-events-none']" :aria-current="isOn(item.id) ? 'true' : undefined" @click="openItem(item.id)" @keydown.enter="openItem(item.id)">
            <Icon :name="item.icon" :size="24" class="shrink-0" :class="!isOn(item.id) && 'text-on-surface-variant'" />
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            <span v-if="item.id === 'model'" class="shrink-0 text-xs" :class="!isOn(item.id) && 'text-on-surface-variant'">{{ on ? providerLabel : "" }}</span>
            <template v-if="item.id === 'prompt'">
              <Icon v-if="sections.length && !listMarked" name="error" :size="20" fill class="shrink-0" :class="!isOn(item.id) && 'text-error'" v-tooltip="T.listMarkMissing(LIST_MARK)" />
            </template>
            <Icon name="chevron_right" :size="20" class="shrink-0 -mr-1" :class="!isOn(item.id) && 'text-on-surface-variant'" />
          </div>
        </div>
      </BaseCard>

      <div v-if="showDetail" class="flex flex-col gap-(--gap-in) min-w-0">
        <ConfigAIModel v-if="view === 'model'" />

        <!-- ── 프롬프트: 후보 목록 형식 · 판정 프롬프트 · 판정 테스트(맨 아래: 프롬프트를 깎으면서 쓴다) ── -->
        <template v-if="view === 'prompt'">
          <ConfigAIList />
          <ConfigAIPrompt />
          <ConfigAIJudge />
        </template>

        <!-- ── 리퀘스트 로그 · 사용량 통계: 탭이 보일 때만 읽는다(로그는 실시간 연결도 그때만) ── -->
        <ConfigAILog v-if="view === 'log'" :active="active" />
        <ConfigAIUsage v-if="view === 'usage'" :active="active" />

        <!-- ── 고급 설정: 요청 · 재시도 ── -->
        <ConfigAIAdvanced v-if="view === 'advanced'" />
      </div>
    </div>

    <Teleport to="body">
      <!-- 유료 확인. 보안이 아니라 돈 때문이다. 실수로 눌러 토큰을 태우는 것을 막는다(M3 대화상자, 설정 대화상자와 같은 모양) -->
      <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
        <div v-if="paid" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="paid = null">
          <div role="dialog" aria-modal="true" aria-labelledby="paid-title" class="w-fit min-w-[min(26rem,100%)] max-w-[min(48rem,100%)] rounded-2xl bg-surface-container-high p-6 animate-[art-in_350ms_var(--ease-spring-fast)]">
            <div class="flex items-center gap-3 mb-4">
              <span class="size-9 shrink-0 rounded-full bg-tertiary-container text-on-tertiary-container flex items-center justify-center"><Icon name="paid" :size="20" /></span>
              <h3 id="paid-title" class="flex-1 text-xl font-round font-semibold">{{ TD.title }}</h3>
            </div>
            <p class="mb-3 text-body text-on-surface-variant">{{ TD.body }}</p>
            <dl class="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt class="text-on-surface-variant">{{ TD.to }}</dt>
              <dd class="font-mono break-all whitespace-pre-line text-on-surface">{{ paidUrl || paidUrlError || TD.checking }}</dd>
              <dt class="text-on-surface-variant">{{ TD.model }}</dt>
              <dd class="font-mono break-all text-on-surface">{{ draft.model || TD.emptyModel }}</dd>
              <dt class="text-on-surface-variant">{{ TD.what }}</dt>
              <dd v-if="paid === 'ping'" class="text-on-surface">{{ pingText || TD.checking }}</dd>
              <dd v-else class="text-on-surface">{{ TD.judgeWhat(sections.length, judgeUsable.length) }}</dd>
            </dl>
            <div class="flex gap-2 justify-end">
              <BaseButton variant="ghost" @click="paid = null">{{ TD.cancel }}</BaseButton>
              <BaseButton variant="warning" @click="runPaid">{{ TD.send }}</BaseButton>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 요청 미리보기: 나간 것과 온 것을 그대로 본다. 다듬지 않는다 -->
      <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150">
        <div v-if="shown" class="fixed inset-0 z-300 bg-black/50 flex items-center justify-center p-4" @click.self="shown = null">
          <div role="dialog" aria-modal="true" aria-labelledby="preview-title" class="w-[min(56rem,100%)] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-container-high p-6 animate-[art-in_350ms_var(--ease-spring-fast)]">
            <div class="flex items-center gap-3 mb-4">
              <span class="size-9 shrink-0 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center"><Icon name="visibility" :size="20" /></span>
              <h3 id="preview-title" class="flex-1 text-xl font-round font-semibold">{{ TV.title }}</h3>
              <span class="text-xs text-on-surface-variant">{{ TV.notSent }}</span>
              <span v-if="shown.tokens" class="text-xs text-on-surface-variant nums" v-tooltip="shown.tokens.exact ? '' : TR.estimated">{{ TR.tokens(shown.tokens.total) }}</span>
              <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="text.common.close" @click="shown = null"><Icon name="close" :size="20" /></button>
            </div>
            <div class="flex flex-col gap-3">
              <div v-for="(part, i) in shownSections" :key="i" class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="flex-1 text-sm font-semibold text-on-surface">{{ part.name }}</span>
                  <span class="text-xs font-mono text-on-surface-variant">{{ part.role }}</span>
                  <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="TJ.copy" v-tooltip="TJ.copy" @click="copy(part.text)"><Icon name="content_copy" :size="20" /></button>
                </div>
                <pre :class="CODE_BOX">{{ part.text }}</pre>
              </div>
              <div>
                <BaseButton variant="ghost" size="sm" @click="showRawRequest = !showRawRequest"><Icon name="expand_more" :size="18" class="transition-transform duration-150" :class="showRawRequest && 'rotate-180'" />{{ showRawRequest ? TV.rawHide : TV.rawShow }}</BaseButton>
              </div>
              <div v-if="showRawRequest" class="flex flex-col gap-3">
                <div v-for="box in boxes" :key="box.title" class="flex flex-col gap-1">
                  <div class="flex items-center gap-2">
                    <span class="flex-1 text-xs font-semibold text-on-surface-variant">{{ box.title }}</span>
                    <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="TJ.copy" v-tooltip="TJ.copy" @click="copy(box.text)"><Icon name="content_copy" :size="20" /></button>
                  </div>
                  <pre :class="CODE_BOX">{{ box.text }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import { CODE_BOX } from "../utils/field.ts";
import BaseSwitch from "./BaseSwitch.vue";
import { reportSinglePane, useListDetailLayout, LIST_ROW } from "../composables/list-detail.ts";
import { pushDown } from "../utils/up-nav.ts";
import { SELECT_ROW_ON } from "../utils/select-row.ts";
import { LIST_MARK } from "../../../src/config/schema/ai-prompt.ts";
import { text } from "../text/index.ts";
import ConfigAIModel from "./ConfigAIModel.vue";
import ConfigAIList from "./ConfigAIList.vue";
import ConfigAIPrompt from "./ConfigAIPrompt.vue";
import ConfigAIJudge from "./ConfigAIJudge.vue";
import ConfigAIAdvanced from "./ConfigAIAdvanced.vue";
import ConfigAILog from "./ConfigAILog.vue";
import ConfigAIUsage from "./ConfigAIUsage.vue";
import { provideAiEditor } from "../composables/ai-editor.ts";
const TV = text.ai.preview;
const TD = text.ai.paid;
const TJ = text.ai.judge;
const TR = text.ai.prompt;
const T = text.ai;

// 상태 · 주고받기는 composables/ai-editor(카드들이 같이 쓴다)
const { loadError, NL, draft, sections, paid, paidUrl, paidUrlError, pingText, shown, on, aiOn, listMarked, shownSections, boxes, showRawRequest, problems, copy, judgeUsable, providerOptions, runPaid } = provideAiEditor();

/** active: AI 보조 탭이 보이는가(편집기는 탭을 오가도 남아 있다) */
defineProps<{ active: boolean }>();

const route = useRoute();
const router = useRouter();
// 프로바이더를 선택하지 않아도 여는 것
const ALWAYS_OPEN: readonly string[] = ["model", "log", "usage"];

// ── 목록 · 상세. 주소 ?ai= 에 선택한 항목(model · prompt · advanced · log · usage). 두 단이면 선택한 것이 없을 때 모델 ──
const FIXED_ITEMS = [
  { id: "model", label: T.items.model, icon: "model_training" },
  { id: "prompt", label: T.items.prompt, icon: "terminal" },
  { id: "advanced", label: T.items.advanced, icon: "settings" },
  { id: "log", label: T.items.log, icon: "history" },
  { id: "usage", label: T.items.usage, icon: "bar_chart" },
] as const;
const paneEl = ref<HTMLElement | null>(null);
const { twoPane, listCardClass, paneClass } = useListDetailLayout(paneEl);
// 한 단이면 운영자 패널 위 막대 ← 로 목록에
reportSinglePane("ai", () => !twoPane.value);
const picked = computed<string | null>(() => {
  const q = route.query.ai;
  if (typeof q === "string") {
    if (ALWAYS_OPEN.includes(q) || (on.value && ["prompt", "advanced"].includes(q))) return q;
  }
  return twoPane.value ? "model" : null;
});
const showList = computed(() => twoPane.value || !picked.value);
const showDetail = computed(() => !!picked.value);
const isOn = (id: string) => twoPane.value && picked.value === id;
/** 보이는 그룹(선택한 항목) */
const view = computed(() => picked.value);
const providerLabel = computed(() => providerOptions.value.find((one) => one.value === draft.value.provider)?.label ?? draft.value.provider ?? "");
// 한 단에서 열면 방문 기록을 하나 쌓아(뒤로가기 = 목록), 두 단에서 선택하면 주소만 바꾼다
function openItem(id: string) {
  const query = { ...route.query, ai: id };
  if (twoPane.value) void router.replace({ query });
  else void pushDown(router, route, { query });
}
</script>
