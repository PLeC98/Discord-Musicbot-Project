<!--
  AI 보조 · 모델: 어디로(프로바이더 · 주소 · 키) · 무엇을(모델) 부를지 한 카드, 연결 테스트 · 모델 파라미터.
  상태는 composables/ai-editor(ConfigAI 가 내려 준다).
-->
<template>
  <BaseCard icon="model_training" :title="TM.title">
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
        <label class="block">
          <span :class="FIELD_LABEL">{{ TM.provider }}</span>
          <SingleSelect :model-value="on ? draft.provider : ''" :options="providerOptions" :placeholder="text.fields.pick" @update:model-value="pickProvider" />
        </label>
        <!-- 주소를 직접 입력하는 것은 custom 뿐이다. 나머지는 그 서비스의 주소로 간다. 버텍스는 프로젝트 · 리전 · 모델로 조립한 것을 보여 준다 -->
        <label v-if="on" class="block min-w-0">
          <span :class="FIELD_LABEL">{{ TM.endpoint }}</span>
          <input v-if="spec?.editable" :value="draft.baseUrl" placeholder="https://example.com/v1" :class="[FIELD, 'w-full']" @input="draft.baseUrl = valueOf($event)" />
          <p v-else class="h-10 flex items-center text-sm font-mono text-on-surface-variant truncate" v-tooltip="shownEndpoint">{{ shownEndpoint }}</p>
        </label>
      </div>

      <!-- 버텍스는 주소를 이 둘로 조립한다 -->
      <div v-if="on && spec?.needsProject" class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
        <label class="block">
          <span :class="FIELD_LABEL" v-tooltip="TM.regionTip">{{ TM.region }}</span>
          <input :value="draft.location" placeholder="global" :class="[FIELD, 'w-full']" @input="draft.location = valueOf($event)" />
        </label>
        <label class="block">
          <span :class="FIELD_LABEL" v-tooltip="TM.projectTip">{{ TM.project }}</span>
          <input :value="draft.project" :placeholder="TM.projectPlaceholder" :class="[FIELD, 'w-full']" @input="draft.project = valueOf($event)" />
        </label>
      </div>

      <!-- 키는 쓰기 전용이다. 값은 내려오지 않고 있는지 없는지만 온다 -->
      <div v-if="on && needsKey" class="flex flex-col gap-1">
        <span :class="FIELD_LABEL" class="flex! items-center gap-2"
          >{{ spec?.serviceAccount ? TM.serviceAccount : TM.apiKey }}<span class="inline-flex items-center gap-1 text-xs" :class="hasKey ? 'text-primary' : 'text-on-surface-variant'"><Icon :name="hasKey ? 'check_circle' : 'radio_button_unchecked'" :size="16" :fill="hasKey" />{{ hasKey ? (spec?.serviceAccount ? TM.savedAccount : TM.savedKey) : spec?.serviceAccount ? TM.noAccount : TM.noKey }}</span></span
        >
        <!-- 서비스 계정은 JSON 블록이다. 다른 키와 같은 위치에 같은 방식으로 둔다 -->
        <textarea v-if="spec?.serviceAccount" :value="keyInput" rows="4" autocomplete="off" :placeholder="keyPlaceholder" :class="[AREA, 'font-mono text-xs', hasKey && 'placeholder:font-sans']" @input="keyInput = valueOf($event)"></textarea>
        <div class="flex items-center gap-2">
          <input v-if="!spec?.serviceAccount" :value="keyInput" type="password" autocomplete="off" :placeholder="keyPlaceholder" :class="[FIELD, 'flex-1 min-w-0']" @input="keyInput = valueOf($event)" />
          <BaseButton :disabled="!keyInput.trim() || savingKey" @click="saveKey">{{ savingKey ? TM.saving : TM.save }}</BaseButton>
          <button v-if="hasKey" type="button" :class="[ICON_BTN, 'size-8']" class="hover:text-error" :disabled="savingKey" :aria-label="TM.clearKey" v-tooltip="TM.clearValue" @click="clearKey"><Icon name="delete" :size="20" /></button>
        </div>
        <p v-if="keyTrouble" class="text-xs text-(--warn-ink)">{{ keyTrouble === "moved" ? (spec?.serviceAccount ? TM.keyMovedRegion : TM.keyMoved) : TM.keyAgain }}</p>
        <p v-if="spec?.serviceAccount && keyInput.trim() && !looksLikeAccount" class="text-xs text-(--warn-ink)">{{ TM.accountShape }}</p>
        <p v-if="spec?.serviceAccount" class="text-xs text-on-surface-variant">{{ TM.accountHint }}</p>
        <p v-if="!secureOrigin" class="text-xs text-(--warn-ink)">{{ TM.insecure }}</p>
      </div>
      <p v-if="on && staleCustomUrl" class="text-xs text-(--warn-ink)">{{ TM.staleUrl }}</p>
      <template v-if="on">
        <div>
          <span :class="FIELD_LABEL">{{ TM.model }}</span>
          <div class="flex items-center gap-2 flex-wrap">
            <SingleSelect v-if="models.length && !manualModel" class="flex-1 min-w-40" :model-value="draft.model ?? ''" :options="modelChoices.map((one) => ({ value: one.id, label: one.label }))" @update:model-value="pickModel" />
            <input v-else :value="draft.model" :placeholder="TM.modelPlaceholder" :class="[FIELD, 'flex-1 min-w-40']" @input="draft.model = valueOf($event)" @change="rememberModel(draft.provider, draft.model)" />
            <button type="button" :class="[ICON_BTN, 'size-8']" :disabled="loadingModels" :aria-label="TM.refreshList" v-tooltip="TM.refreshList" @click="loadModels()"><Icon name="refresh" :size="20" :class="loadingModels && 'animate-spin'" /></button>
            <label class="flex items-center gap-2 cursor-pointer shrink-0" v-tooltip="models.length ? '' : TM.manualTip">
              <span class="text-sm" :class="models.length ? 'text-on-surface' : 'text-on-surface-variant'">{{ TM.manual }}</span>
              <BaseSwitch v-model="manualModel" :disabled="!models.length" />
            </label>
          </div>
        </div>

        <div v-if="models.length || hideModels.length">
          <BaseButton variant="ghost" size="sm" @click="showHide = !showHide"
            ><Icon name="expand_more" :size="18" class="transition-transform duration-150" :class="showHide && 'rotate-180'" />{{ TM.hide }}<span v-if="hideModels.length" class="nums">{{ hideModels.length }}</span></BaseButton
          >
          <div v-if="showHide" class="mt-2 flex flex-col gap-1">
            <p class="text-xs text-on-surface-variant">{{ TM.hideHelpBefore }}<code class="font-mono">*</code>{{ TM.hideHelpAfter }}</p>
            <ChipInput v-model="hideModels" lowercase :placeholder="TM.hidePlaceholder" />
          </div>
        </div>
      </template>
    </div>
  </BaseCard>

  <BaseCard v-if="on" icon="network_check" :title="TT.title">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-on-surface-variant">{{ TT.desc }}</p>
      <div class="flex items-center gap-2 flex-wrap">
        <BaseButton variant="ghost" :disabled="loadingModels" @click="loadModels()">{{ loadingModels ? TT.freeRunning : TT.free }}</BaseButton>
        <BaseButton variant="warning" :disabled="pinging" @click="askPaid('ping')">{{ pinging ? TT.paidRunning : TT.paid }}</BaseButton>
      </div>
      <!-- 두 테스트의 결과. 한 곳에 쓴다 -->
      <template v-if="tested">
        <NoticeBox variant="note" :tone="tested.ok ? 'info' : 'error'" :icon="tested.ok ? 'check_circle' : 'cancel'" :fill="tested.ok" class="mt-0!"
          >{{ tested.kind }} · {{ tested.status ? `HTTP ${tested.status}` : TT.notSent }} · {{ tested.tookMs }}ms<template v-if="tested.extra"> · {{ tested.extra }}</template
          ><template v-if="tested.reason && !tested.status">{{ NL }}{{ tested.reason }}</template></NoticeBox
        >
        <pre v-if="tested.body" :class="CODE_BOX">{{ tested.body }}</pre>
        <div v-if="tested.raw && tested.raw !== tested.body">
          <BaseButton variant="ghost" size="sm" @click="showRaw = !showRaw"><Icon name="expand_more" :size="18" class="transition-transform duration-150" :class="showRaw && 'rotate-180'" />{{ showRaw ? TT.rawHide : TT.rawShow }}</BaseButton>
        </div>
        <pre v-if="showRaw && tested.raw" :class="CODE_BOX">{{ tested.raw }}</pre>
      </template>
    </div>
  </BaseCard>

  <BaseCard v-if="on" icon="tune" :title="TP.title">
    <template v-if="fieldInfo.fields.length" #actions>
      <button type="button" :class="[ICON_BTN, 'size-8']" :disabled="refreshing" :aria-label="TP.refresh" v-tooltip="TP.refreshTip" @click="refreshModels"><Icon name="refresh" :size="20" :class="refreshing && 'animate-spin'" /></button>
    </template>
    <div class="flex flex-col gap-4">
      <div v-if="fieldInfo.fields.length" class="flex items-center gap-3">
        <span class="flex-1 min-w-0 truncate text-sm font-semibold text-on-surface">{{ modelName || draft.model }}</span>
        <label class="flex items-center gap-2 cursor-pointer shrink-0">
          <span class="text-sm text-on-surface">{{ TP.advanced }}</span>
          <BaseSwitch v-model="showAdvanced" />
        </label>
      </div>

      <section v-for="group in paramGroups" :key="group.id" class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold text-on-surface">{{ group.label }}</h3>
        <div class="grid grid-cols-2 @xl/card:grid-cols-3 gap-3">
          <label v-for="field in group.fields" :key="field.key" class="block min-w-0">
            <span :class="FIELD_LABEL" class="truncate" v-tooltip="hintOf(field)">{{ field.label || field.key }}</span>
            <SingleSelect v-if="field.enum" :model-value="enumValue(field.enum, params[field.key])" :options="enumOptions(field.enum)" :empty-label="field.default ? TP.defaultWith(field.default) : TP.default" @update:model-value="params[field.key] = enumPick(field.enum, $event)" />
            <span v-else-if="field.type === 'boolean'" class="h-10 flex items-center">
              <BaseSwitch :model-value="Boolean(params[field.key])" :label="field.label || field.key" @update:model-value="params[field.key] = $event" />
            </span>
            <NumberInput v-else-if="field.type === 'integer' || field.type === 'number'" :model-value="numberParam(field.key)" :decimal="field.type === 'number'" :negative="(field.min ?? 0) < 0" :placeholder="String(field.default ?? '')" :class="[FIELD, 'w-full']" @update:model-value="(v) => (params[field.key] = v)" />
            <ChipInput v-else-if="field.type === 'stringArray'" :model-value="listParam(field.key)" :placeholder="TP.listPlaceholder" @update:model-value="(v) => (params[field.key] = v.length ? v : undefined)" />
            <template v-else-if="field.type === 'json'">
              <textarea :value="jsonText[field.key] ?? (params[field.key] ? JSON.stringify(params[field.key], null, 2) : '')" rows="3" placeholder="{ }" :class="[AREA, 'font-mono text-xs']" @input="(e) => onJson(field.key, valueOf(e))"></textarea>
              <span v-if="jsonBad[field.key]" class="mt-1 block text-xs text-error">{{ TP.badJson }}</span>
            </template>
            <input v-else :value="params[field.key]" :placeholder="String(field.default ?? '')" :class="[FIELD, 'w-full']" @input="params[field.key] = valueOf($event)" />
          </label>
        </div>
      </section>
      <p v-if="paramLimits" class="text-xs text-on-surface-variant">{{ paramLimits }}</p>

      <section class="flex flex-col gap-2" :class="paramGroups.length > 0 && 'pt-3 border-t border-outline-variant/40'">
        <div>
          <h3 class="text-sm font-semibold text-on-surface">{{ TP.extra }}</h3>
          <p class="mt-1 text-xs text-on-surface-variant">
            {{ TP.extraHelp }}<code class="font-mono">key=value</code> · <code class="font-mono">key=json::{...}</code> · <code class="font-mono">header::Name=value</code> · <code class="font-mono">key={{ NONE_MARK }}</code>
          </p>
        </div>
        <textarea :value="extraText" rows="4" :placeholder="EXTRA_SAMPLE" :class="[AREA, 'font-mono text-xs']" @input="extraText = valueOf($event)"></textarea>
      </section>
    </div>
  </BaseCard>
</template>

<script setup lang="ts">
import { ICON_BTN } from "../utils/icon-button.ts";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NumberInput from "./NumberInput.vue";
import ChipInput from "./ChipInput.vue";
import SingleSelect from "./SingleSelect.vue";
import NoticeBox from "./NoticeBox.vue";
import { FIELD, FIELD_LABEL, AREA, CODE_BOX } from "../utils/field.ts";
import BaseSwitch from "./BaseSwitch.vue";
import { valueOf } from "../utils/dom.ts";
import { text } from "../text/index.ts";
import { useAiEditor } from "../composables/ai-editor.ts";
const TT = text.ai.test;
const TP = text.ai.params;
const TM = text.ai.model;

const {
  NL,
  NONE_MARK,
  EXTRA_SAMPLE,
  draft,
  fieldInfo,
  showAdvanced,
  showHide,
  refreshing,
  refreshModels,
  params,
  jsonText,
  jsonBad,
  numberParam,
  listParam,
  onJson,
  keyInput,
  savingKey,
  loadingModels,
  rememberModel,
  models,
  modelChoices,
  manualModel,
  pinging,
  tested,
  showRaw,
  hasKey,
  keyTrouble,
  spec,
  on,
  needsKey,
  shownEndpoint,
  keyPlaceholder,
  looksLikeAccount,
  secureOrigin,
  staleCustomUrl,
  hideModels,
  extraText,
  modelName,
  hintOf,
  paramGroups,
  paramLimits,
  providerOptions,
  pickProvider,
  pickModel,
  enumOptions,
  enumValue,
  enumPick,
  loadModels,
  askPaid,
  saveKey,
  clearKey,
} = useAiEditor();
</script>
