<!--
  AI 보조 · 판정 프롬프트: 섹션(역할 · 이름 · 글)을 차례대로 보낸다. 토큰 어림수 · 리퀘스트 미리보기.
  상태는 composables/ai-editor(ConfigAI 가 내려 준다).
-->
<template>
  <BaseCard icon="terminal" :title="TR.title">
    <template #actions>
      <span v-if="tokenTotal != null" class="text-xs text-on-surface-variant nums" v-tooltip="tokenExact ? '' : TR.estimated">{{ TR.tokens(tokenTotal) }}</span>
      <span v-else-if="tokenError" class="text-xs text-(--warn-ink)" v-tooltip="tokenError">{{ TR.tokensFailed }}</span>
      <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="TR.addSection" v-tooltip="text.common.add" @click="addSection"><Icon name="add" :size="20" /></button>
    </template>
    <div class="flex flex-col gap-3">
      <p class="text-sm text-on-surface-variant">{{ TR.descBefore }}<code class="font-mono">[{"n":1,"song":true,"fits":false}]</code>{{ TR.descAfter }}</p>
      <NoticeBox v-if="!sections.length" variant="note" tone="info" icon="info" class="mt-0!">{{ TR.emptyUsesDefault }}</NoticeBox>
      <NoticeBox v-else-if="!listMarked" variant="note" tone="error" icon="error" class="mt-0!">{{ TR.listMarkMissing(LIST_MARK) }}</NoticeBox>

      <!-- 섹션 카드: 머리(손잡이 · 접기 · 이름 · 역할 · 지우기), 몸은 프롬프트. 출처 카드와 같은 모양 -->
      <div v-for="(section, i) in sections" :key="section.key" class="rounded-(--r-inner) bg-surface-container-high" data-reorder>
        <div class="flex items-center gap-1 @sm/card:gap-2 p-2">
          <span class="shrink-0 flex touch-none cursor-grab active:cursor-grabbing text-outline" v-tooltip="TR.dragToReorder" @pointerdown="startDrag($event, i)"><Icon name="drag_indicator" :size="20" /></span>
          <button type="button" :class="[ICON_BTN, 'size-8']" :aria-label="isFolded(promptFoldId(i)) ? text.common.expand : text.common.collapse" v-tooltip="isFolded(promptFoldId(i)) ? text.common.expand : text.common.collapse" @click="toggleFold(promptFoldId(i))"><Icon name="expand_more" :size="20" class="transition-transform duration-150" :class="isFolded(promptFoldId(i)) && '-rotate-90'" /></button>
          <input :value="section.name" :placeholder="TR.sectionName(i + 1)" :class="[FIELD, 'flex-1 min-w-0']" v-tooltip="TR.sectionNameTip" @input="section.name = valueOf($event)" />
          <SingleSelect :model-value="section.role" class="w-28 @sm/card:w-32 shrink-0" :options="ROLES.map((one) => ({ value: one, label: one }))" v-tooltip="TR.role" @update:model-value="section.role = $event as PromptSection['role']" />
          <button type="button" :class="[ICON_BTN, 'size-8']" class="hover:text-error" :aria-label="TR.removeSection" v-tooltip="text.common.remove" @click="removeSection(i)"><Icon name="delete" :size="20" /></button>
        </div>
        <div v-show="!isFolded(promptFoldId(i))" class="flex flex-col gap-1 px-3 pb-3">
          <span v-if="tokenEach[i] != null" class="self-end text-xs text-on-surface-variant nums" v-tooltip="tokenExact ? '' : TR.estimated">{{ TR.tokens(tokenEach[i]) }}</span>
          <textarea :value="section.text" rows="8" :class="[AREA, 'font-mono text-xs']" @input="section.text = valueOf($event)"></textarea>
        </div>
      </div>

      <div class="flex items-center gap-2 flex-wrap">
        <BaseButton variant="ghost" size="sm" @click="loadDefaults"><Icon name="restart_alt" :size="18" />{{ TR.defaults }}</BaseButton>
        <BaseButton variant="secondary" size="sm" class="ml-auto" @click="openPreview"><Icon name="visibility" :size="18" />{{ TR.preview }}</BaseButton>
      </div>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import SingleSelect from "./SingleSelect.vue";
import NoticeBox from "./NoticeBox.vue";
import { FIELD, AREA } from "../utils/field.ts";
import { isFolded, toggleFold, promptFoldId } from "../composables/config-folds.ts";
import { valueOf } from "../utils/dom.ts";
import { LIST_MARK, type PromptSection } from "../../../src/config/schema/ai-prompt.ts";
import { text } from "../text/index.ts";
import { useAiEditor } from "../composables/ai-editor.ts";
const TR = text.ai.prompt;

const { startDrag, ROLES, tokenEach, tokenTotal, tokenExact, tokenError, sections, listMarked, addSection, removeSection, loadDefaults, openPreview } = useAiEditor();
</script>
