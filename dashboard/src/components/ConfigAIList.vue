<!--
  AI 보조 · 후보 목록: 요청 하나에 맡길 곡 수 · 줄 형식(문법 안내 · 문제 구간 · 미리보기).
  상태는 composables/ai-editor(ConfigAI 가 내려 준다).
-->
<template>
  <BaseCard icon="format_list_numbered" :title="TL.title">
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 @xl/card:grid-cols-3 gap-3">
        <label class="block">
          <span :class="FIELD_LABEL" v-tooltip="TL.batchTip">{{ TL.batch }}</span>
          <NumberInput v-model="draft.batchSize" :class="[FIELD, 'w-full']" />
        </label>
        <label class="flex items-center gap-2 cursor-pointer self-end h-10" v-tooltip="TL.skipConfidentTip">
          <BaseSwitch v-model="draft.skipConfident" />
          <span class="text-sm text-on-surface">{{ TL.skipConfident }}</span>
        </label>
      </div>

      <section class="flex flex-col gap-2 pt-3 border-t border-outline-variant/40">
        <div>
          <h3 class="flex items-center gap-1 text-sm font-semibold text-on-surface">
            {{ TL.lineFormat }}<button type="button" :class="[ICON_BTN, 'size-6']" v-tooltip="TL.help" :aria-label="TL.help" aria-haspopup="dialog" @click="syntaxOpen = true"><Icon name="info" :size="16" /></button>
          </h3>
          <p class="mt-1 text-xs text-on-surface-variant">
            {{ TL.lineFormatBefore }}<code class="font-mono">{{ LIST_MARK }}</code
            >{{ TL.lineFormatAfter }}
          </p>
        </div>
        <input :value="listCfg.lineFormat" :placeholder="defaults.line" :class="[FIELD, 'w-full font-mono']" @input="listCfg.lineFormat = valueOf($event)" />
        <!-- 문제는 입력란 아래에 그 구간을 표시한다(입력란 안은 색을 칠할 수 없다): 앞뒤 몇 글자와 틀린 구간 · 몇 번째 글자 · 까닭 -->
        <ul v-if="lineProblems.length" class="flex flex-col gap-1">
          <li v-for="(one, i) in lineProblems" :key="i" class="flex flex-wrap items-baseline gap-x-2 text-xs">
            <code class="font-mono text-on-surface-variant"
              >{{ one.before }}<mark class="rounded-xs bg-error-container px-0.5 text-on-error-container">{{ one.part || " " }}</mark
              >{{ one.after }}</code
            >
            <span class="text-error">{{ TL.problemAt(one.at + 1) }}: {{ one.message }}</span>
          </li>
        </ul>
        <div class="flex flex-wrap gap-2">
          <button v-for="one in MARKS" :key="one.mark" type="button" :class="[FILTER_CHIP, FILTER_CHIP_OFF, 'font-mono']" v-tooltip="one.hint" @click="insertMark(one.mark)"><Icon name="add" :size="18" />{{ one.mark }}</button>
          <button type="button" :class="[FILTER_CHIP, FILTER_CHIP_OFF, 'font-mono']" v-tooltip="TL.blockChipTip" @click="insertMark(BLOCK_MARK)"><Icon name="add" :size="18" />{{ TL.blockChip }}</button>
        </div>
        <!-- 미리보기: 봇과 같은 해석기로 길이를 아는 줄 · 모르는 줄을 그린다(조회 없이) -->
        <div class="flex flex-col gap-1">
          <span :class="FIELD_LABEL">{{ TL.previewTitle }}</span>
          <div v-for="one in linePreview" :key="one.label" class="flex flex-col gap-0.5">
            <span class="text-2xs text-on-surface-variant">{{ one.label }}</span>
            <pre :class="CODE_BOX">{{ one.line || " " }}</pre>
          </div>
        </div>
        <InfoDialog v-model="syntaxOpen" icon="format_list_numbered" :title="TL.helpTitle">
          <dl class="flex flex-col gap-1">
            <div v-for="row in TL.syntax" :key="row.code" class="rounded-(--r-inner) bg-surface-container-highest px-4 py-3">
              <dt class="text-sm font-semibold font-mono break-all">{{ row.code }}</dt>
              <dd class="mt-0.5 text-xs text-on-surface-variant">{{ row.text }}</dd>
            </div>
            <div class="rounded-(--r-inner) bg-surface-container-highest px-4 py-3">
              <dt class="text-sm font-semibold">{{ TL.syntaxExampleLabel }}</dt>
              <dd class="mt-0.5 text-xs font-mono break-all text-on-surface-variant">{{ TL.syntaxExample }}</dd>
            </div>
          </dl>
        </InfoDialog>
      </section>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import NumberInput from "./NumberInput.vue";
import { FIELD, FIELD_LABEL, CODE_BOX } from "../utils/field.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF } from "../utils/filter-chip.ts";
import BaseSwitch from "./BaseSwitch.vue";
import { valueOf } from "../utils/dom.ts";
import { LIST_MARK } from "../../../src/config/schema/ai-prompt.ts";
import InfoDialog from "./InfoDialog.vue";
import { text } from "../text/index.ts";
import { useAiEditor } from "../composables/ai-editor.ts";
const TL = text.ai.list;

const { MARKS, BLOCK_MARK, syntaxOpen, draft, listCfg, defaults, insertMark, lineProblems, linePreview } = useAiEditor();
</script>
