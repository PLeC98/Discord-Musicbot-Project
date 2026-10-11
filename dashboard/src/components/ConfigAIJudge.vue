<!--
  AI 보조 · 판정 테스트(프롬프트 화면의 맨 아래: 프롬프트를 깎으면서 쓴다): 진짜 곡으로 시험한다.
  링크 조회는 아무것도 보내지 않고, 판정 요청만 실제로 보낸다.
  상태는 composables/ai-editor(ConfigAI 가 내려 준다).
-->
<template>
  <BaseCard icon="fact_check" :title="TJ.title">
    <div class="flex flex-col gap-4">
      <div class="flex flex-col @xl/card:flex-row gap-3 items-start">
        <label class="block flex-1 min-w-0 w-full">
          <span :class="FIELD_LABEL">{{ TJ.urls }}</span>
          <textarea :value="judgeUrls" rows="3" wrap="off" :placeholder="TJ.urlsPlaceholder" :class="[AREA, 'font-mono text-xs']" @input="judgeUrls = valueOf($event)"></textarea>
        </label>
        <div class="w-full @xl/card:w-60 @3xl/card:w-72 shrink-0 flex flex-col gap-3">
          <label class="block">
            <span :class="FIELD_LABEL">{{ TJ.genre }}</span>
            <input :value="judgeGenre" :placeholder="TJ.genrePlaceholder" :class="[FIELD, 'w-full']" @input="judgeGenre = valueOf($event)" />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <BaseButton variant="ghost" class="w-full justify-center" :disabled="judging || !judgeUrls.trim()" @click="lookupJudge">{{ judging ? TJ.looking : TJ.lookup }}</BaseButton>
            <BaseButton variant="warning" class="w-full justify-center" :disabled="judging" @click="askPaid('judge')">{{ judging ? TJ.sending : TJ.send }}</BaseButton>
          </div>
        </div>
      </div>

      <NoticeBox v-if="judgeStale" variant="note" tone="notice" icon="info" class="mt-0!"
        ><span class="min-w-0 flex-1"
          >{{ TJ.stale }}<span class="mt-2 block rounded-(--r-inner) bg-current/10 px-3 py-2 font-mono text-xs whitespace-pre-wrap">{{ SAMPLE_LINES }}</span></span
        ></NoticeBox
      >
      <NoticeBox v-if="judgeError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ judgeError }}</NoticeBox>

      <section v-if="judgeCands.length" class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <h3 class="flex-1 text-sm font-semibold text-on-surface">{{ TJ.listTitle }}</h3>
          <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="TJ.copyList" v-tooltip="TJ.copy" @click="copy(judgeList.join(NL))"><Icon name="content_copy" :size="20" /></button>
        </div>
        <ul class="flex flex-col rounded-(--r-inner) bg-surface-container-highest divide-y divide-outline-variant/40">
          <li v-for="(cand, i) in judgeCands" :key="cand.url" class="flex items-start gap-3 px-3 py-2">
            <span v-if="judgeVerdicts" class="shrink-0 w-16 text-xs font-semibold" :class="verdictOk(judgeVerdicts[i]) ? 'text-primary' : 'text-error'">{{ verdictText(judgeVerdicts[i]) }}</span>
            <p v-if="cand.error" class="min-w-0 flex-1 text-xs text-error break-all">{{ cand.url }}: {{ cand.error }}</p>
            <p v-else class="min-w-0 flex-1 font-mono text-xs text-on-surface break-all">{{ lineFor(cand) }}</p>
          </li>
        </ul>
      </section>

      <template v-if="judgeSent">
        <div>
          <BaseButton variant="ghost" size="sm" @click="showJudgeRaw = !showJudgeRaw"><Icon name="expand_more" :size="18" class="transition-transform duration-150" :class="showJudgeRaw && 'rotate-180'" />{{ showJudgeRaw ? TJ.rawHide : TJ.rawShow }}</BaseButton>
        </div>
        <div v-if="showJudgeRaw" class="flex flex-col gap-3">
          <div v-for="box in judgeBoxes" :key="box.title" class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <span class="flex-1 text-xs font-semibold text-on-surface-variant">{{ box.title }}</span>
              <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="TJ.copy" v-tooltip="TJ.copy" @click="copy(box.text)"><Icon name="content_copy" :size="20" /></button>
            </div>
            <pre :class="CODE_BOX">{{ box.text }}</pre>
          </div>
        </div>
      </template>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NoticeBox from "./NoticeBox.vue";
import { FIELD, FIELD_LABEL, AREA, CODE_BOX } from "../utils/field.ts";
import { valueOf } from "../utils/dom.ts";
import { text } from "../text/index.ts";
import { useAiEditor } from "../composables/ai-editor.ts";
const TJ = text.ai.judge;

const { NL, judgeUrls, judgeGenre, judging, judgeError, judgeCands, judgeList, judgeVerdicts, judgeSent, showJudgeRaw, copy, SAMPLE_LINES, judgeStale, judgeBoxes, lineFor, verdictOk, verdictText, lookupJudge, askPaid } = useAiEditor();
</script>
