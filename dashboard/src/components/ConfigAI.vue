<!--
  AI 보조 설정 (운영자 패널).

  설정은 config/ai.yaml, **프롬프트는 config/ai-prompt.chatml** 로 따로 산다.
  둘 다 파일로도 고칠 수 있다. 대시보드는 선택 기능이다.

  키는 쓰기 전용이다. 프로바이더마다 따로 비밀 표에 암호화해 두고, 넣을 수는 있어도
  화면으로 되읽지는 못한다. 값을 내려보내면 XSS 하나로 새어 나간다.
  키는 넣을 때 화면에 적힌 주소(custom 의 주소 · 버텍스의 리전)에 묶인다. 저장된 주소가 다르면 쓰이지 않는다(moved).

  미리보기는 **보내지 않고 만들기만** 한다. 테스트는 설정한 엔드포인트로 **실제로 보낸다**.
  조립은 봇이 쓰는 코드를 그대로 부르므로, 보이는 것과 나가는 것이 어긋날 수 없다.
-->
<template>
  <!-- 목록 · 상세(자동재생 · 상태 문구와 같은 틀, composables/list-detail 의 배치). 목록 머리에 켜고 끄기 스위치 · 무엇을 하는지 한 줄.
       목록: 모델 · 프롬프트 · 고급 설정 · 리퀘스트 로그 · 사용량 통계. 고른 것은 주소 ?ai=(두 단이면 고른 것이 없을 때 모델) -->
  <div class="flex flex-col gap-(--gap-in)">
    <NoticeBox v-if="problems.length" variant="note" tone="error" icon="error" class="mt-0!">{{ problems.join(NL) }}</NoticeBox>
    <NoticeBox v-if="loadError" variant="note" tone="error" icon="cancel" class="mt-0!">{{ loadError }}</NoticeBox>

    <!-- 묶음: 모델(프로바이더 · 주소 · 키 · 모델이 한 카드, 모델 파라미터 · 연결 테스트) · 프롬프트(후보 목록 · 판정 프롬프트 · 판정 테스트) · 고급 설정(부르기 · 재시도) · 리퀘스트 로그 · 사용량 통계(둘 다 자리만) -->
    <div ref="paneEl" :class="paneClass">
      <!-- 목록: 모델 · 프롬프트(후보 목록 · 판정 프롬프트 · 판정 테스트를 그 안에 모아서) · 고급 설정 · 리퀘스트 로그 · 사용량 통계. 프로바이더를 안 골랐으면 모델 · 리퀘스트 로그 · 사용량 통계만 -->
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
        <template v-if="view === 'model'">
          <!-- 모델: 어디로(프로바이더 · 주소 · 키) · 무엇을(모델) 부를지 한 카드에 -->
          <BaseCard icon="model_training" :title="TM.title">
            <div class="flex flex-col gap-4">
              <div class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
                <label class="block">
                  <span :class="FIELD_LABEL">{{ TM.provider }}</span>
                  <SingleSelect :model-value="on ? draft.provider : ''" :options="providerOptions" :placeholder="text.fields.pick" @update:model-value="pickProvider" />
                </label>
                <!-- 주소를 직접 적는 것은 custom 뿐이다. 나머지는 그 서비스의 주소로 간다. 버텍스는 프로젝트 · 리전 · 모델로 조립한 것을 보여 준다 -->
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
                <!-- 서비스 계정은 JSON 덩어리다. 다른 키와 같은 자리에 같은 방식으로 둔다 -->
                <textarea v-if="spec?.serviceAccount" :value="keyInput" rows="4" autocomplete="off" :placeholder="keyPlaceholder" :class="[AREA, 'font-mono text-xs']" @input="keyInput = valueOf($event)"></textarea>
                <div class="flex items-center gap-2">
                  <input v-if="!spec?.serviceAccount" :value="keyInput" type="password" autocomplete="off" :placeholder="keyPlaceholder" :class="[FIELD, 'flex-1 min-w-0']" @input="keyInput = valueOf($event)" />
                  <BaseButton :disabled="!keyInput.trim() || savingKey" @click="saveKey">{{ savingKey ? TM.saving : TM.save }}</BaseButton>
                  <button v-if="hasKey" type="button" :class="[ICON_BTN, 'size-8']" class="hover:text-error" :disabled="savingKey" :aria-label="TM.clearKey" v-tooltip="TM.clearValue" @click="clearKey"><Icon name="delete" :size="20" /></button>
                </div>
                <p v-if="keyTrouble" class="text-xs text-(--warn-ink)">{{ keyTrouble === "moved" ? (spec?.serviceAccount ? TM.keyMovedRegion : TM.keyMoved) : TM.keyAgain }}</p>
                <p v-if="spec?.serviceAccount && keyInput.trim() && !looksLikeAccount" class="text-xs text-(--warn-ink)">{{ TM.accountShape }}</p>
                <p class="text-xs text-on-surface-variant">{{ spec?.serviceAccount ? TM.accountHint : TM.keyHint }}</p>
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

          <BaseCard v-if="on" icon="network_check" :title="TT.title">
            <div class="flex flex-col gap-3">
              <p class="text-sm text-on-surface-variant">{{ TT.desc }}</p>
              <div class="flex items-center gap-2 flex-wrap">
                <BaseButton variant="ghost" :disabled="loadingModels" @click="loadModels()">{{ loadingModels ? TT.freeRunning : TT.free }}</BaseButton>
                <BaseButton variant="warning" :disabled="pinging" @click="askPaid('ping')">{{ pinging ? TT.paidRunning : TT.paid }}</BaseButton>
              </div>
              <!-- 두 테스트의 결과. 한 자리에 쓴다 -->
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
        </template>

        <!-- ── 프롬프트: 후보 목록 형식 · 판정 프롬프트 ── -->
        <template v-if="view === 'prompt'">
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
                  <h3 class="text-sm font-semibold text-on-surface">{{ TL.lineFormat }}</h3>
                  <p class="mt-1 text-xs text-on-surface-variant">
                    {{ TL.lineFormatBefore }}<code class="font-mono">{{ LIST_MARK }}</code
                    >{{ TL.lineFormatAfter }}
                  </p>
                </div>
                <input :value="listCfg.lineFormat" :placeholder="defaults.line" :class="[FIELD, 'w-full font-mono']" @input="listCfg.lineFormat = valueOf($event)" />
                <div class="flex flex-wrap gap-2">
                  <button v-for="one in MARKS" :key="one.mark" type="button" :class="[FILTER_CHIP, FILTER_CHIP_OFF, 'font-mono']" v-tooltip="one.hint" @click="insertMark(one.mark)"><Icon name="add" :size="18" />{{ one.mark }}</button>
                </div>
              </section>

              <section class="grid grid-cols-1 @md/card:grid-cols-2 gap-3">
                <label class="block">
                  <span :class="FIELD_LABEL">{{ TL.unknownDuration }}</span>
                  <SingleSelect :model-value="listCfg.unknownDuration" :options="UNKNOWN" @update:model-value="listCfg.unknownDuration = $event as AiUnknown" />
                </label>
                <label v-if="listCfg.unknownDuration === 'text'" class="block">
                  <span :class="FIELD_LABEL">{{ TL.unknownText }}</span>
                  <input :value="listCfg.unknownText" :placeholder="TL.unknownTextPlaceholder" :class="[FIELD, 'w-full']" @input="listCfg.unknownText = valueOf($event)" />
                </label>
                <p class="@md/card:col-span-2 text-xs text-on-surface-variant">{{ UNKNOWN.find((u) => u.value === listCfg.unknownDuration)?.hint }}</p>
              </section>
            </div>
          </BaseCard>

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

        <!-- ── 판정 테스트(프롬프트 화면의 맨 아래: 프롬프트를 깎으면서 쓴다): 진짜 곡으로 시험한다. 링크 조회는 아무것도 보내지 않고, 판정 요청만 실제로 보낸다 ── -->

        <template v-if="view === 'prompt'">
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

        <!-- ── 리퀘스트 로그: 신규 기능이라 2차 17단계에서 검토해 만든다. 지금은 자리만 ── -->
        <template v-if="view === 'log'">
          <section class="pane rounded-(--r-window) p-(--pad-window) flex flex-col items-center justify-center gap-3 min-h-60 text-center text-on-surface-variant">
            <Icon name="history" :size="40" />
            <p class="text-sm">{{ text.ai.logNotYet }}</p>
          </section>
        </template>

        <!-- ── 사용량 통계: 신규 기능이라 2차 17단계에서 검토해 만든다. 지금은 자리만 ── -->
        <template v-if="view === 'usage'">
          <section class="pane rounded-(--r-window) p-(--pad-window) flex flex-col items-center justify-center gap-3 min-h-60 text-center text-on-surface-variant">
            <Icon name="bar_chart" :size="40" />
            <p class="text-sm">{{ text.ai.usageNotYet }}</p>
          </section>
        </template>

        <!-- ── 고급 설정: 요청 · 재시도 ── -->
        <template v-if="view === 'advanced'">
          <BaseCard icon="replay" :title="TA.title">
            <div class="flex flex-col gap-4">
              <p class="text-sm text-on-surface-variant">{{ TA.desc }}</p>
              <div class="grid grid-cols-2 @xl/card:grid-cols-3 gap-3">
                <label class="block">
                  <span :class="FIELD_LABEL" v-tooltip="TA.timeoutTip">{{ TA.timeout }}</span>
                  <NumberInput v-model="timeoutSec" :placeholder="defaultSec('timeoutMs')" :class="[FIELD, 'w-full']" />
                </label>
                <label class="block">
                  <span :class="FIELD_LABEL" v-tooltip="TA.retriesTip">{{ TA.retries }}</span>
                  <NumberInput v-model="draft.retries" :placeholder="defaultOf('retries')" :class="[FIELD, 'w-full']" />
                </label>
                <label class="block">
                  <span :class="FIELD_LABEL" v-tooltip="TA.totalTip">{{ TA.total }}</span>
                  <NumberInput v-model="totalSec" :placeholder="defaultSec('totalTimeoutMs')" :class="[FIELD, 'w-full']" />
                </label>
                <label class="block">
                  <span :class="FIELD_LABEL" v-tooltip="TA.delayTip">{{ TA.delay }}</span>
                  <NumberInput v-model="delaySec" decimal :placeholder="defaultSec('retryDelayMs')" :class="[FIELD, 'w-full']" />
                </label>
                <label class="block">
                  <span :class="FIELD_LABEL" v-tooltip="TA.delayMaxTip">{{ TA.delayMax }}</span>
                  <NumberInput v-model="delayMaxSec" decimal :placeholder="defaultSec('retryDelayMaxMs')" :class="[FIELD, 'w-full']" />
                </label>
                <label class="flex items-center gap-2 cursor-pointer self-end h-10">
                  <BaseSwitch v-model="draft.retryTimeouts" />
                  <span class="text-sm text-on-surface">{{ TA.retryTimeouts }}</span>
                </label>
              </div>
              <label class="block">
                <span :class="FIELD_LABEL" v-tooltip="TA.retryStatusTip">{{ TA.retryStatus }}</span>
                <ChipInput :model-value="(draft.retryStatus ?? []).map(String)" :placeholder="defaultOf('retryStatus')" @update:model-value="setRetryStatus" />
              </label>
            </div>
          </BaseCard>
        </template>
      </div>
    </div>

    <SaveDock tab="ai" :dirty="dirty" :saving="saving" :blocked="problems.length > 0" @save="save" @revert="revert" />

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
import { problemText } from "../utils/problem.ts";
import { vertexChatUrl } from "../../../src/rules/vertex-url.ts";
import { LIMIT } from "../utils/request.ts";
import { ref, computed, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NumberInput from "./NumberInput.vue";
import ChipInput from "./ChipInput.vue";
import SaveDock from "./SaveDock.vue";
import SingleSelect from "./SingleSelect.vue";
import NoticeBox from "./NoticeBox.vue";
import { FIELD, FIELD_LABEL, AREA, CODE_BOX } from "../utils/field.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF } from "../utils/filter-chip.ts";
import BaseSwitch from "./BaseSwitch.vue";
import type { Option, OptionValue } from "../utils/options.ts";
import { isFolded, toggleFold, promptFoldId, reorderPrompts } from "../composables/config-folds.ts";
import { useConfigFile } from "../composables/config-file.ts";
import { notifyDone, notifyProblem } from "../composables/toasts.ts";
import { useDragReorder } from "../composables/drag-reorder.ts";
import { reportSinglePane, useListDetailLayout, LIST_ROW } from "../composables/list-detail.ts";
import { pushDown } from "../utils/up-nav.ts";
import { SELECT_ROW_ON } from "../utils/select-row.ts";
import { readStored, writeStored } from "../utils/storage.ts";
import { valueOf } from "../utils/dom.ts";
import { AI_ROLES, LIST_MARK, LINE_MARKS, hasListMark, promptProblems, type PromptSection } from "../../../src/config/schema/ai-prompt.ts";
import { AI_KEY_ORDER, aiProblems, aiSwitchedOff, type AiUnknown } from "../../../src/config/schema/ai.ts";
import type { ModelField, ModelGroup } from "../../../src/config/ai-model-types.ts";
import type { AiDefaults, ModelsCheck, PingCheck, Preview, JudgeResult, TestCandidate } from "../../../src/autoplay/assist/types.ts";
import type { AiFields, AiKeyState, AiSaved, AiState, CandidatesReply, ConfigFile, KeysReply, LinesReply, PromptReply, TokensReply } from "../../../src/dashboard/contract/admin.ts";
import { AI_SAMPLE_CANDIDATES } from "../../../src/dashboard/contract/admin.ts";
import { formatDuration } from "../../../src/ui/format.ts";
import type { RefreshResult } from "../../../src/config/ai-model-types.ts";
import { formatNumber } from "../utils/locale.ts";
import { text } from "../text/index.ts";
const TV = text.ai.preview;
const TD = text.ai.paid;
const TA = text.ai.advanced;
const TJ = text.ai.judge;
const TR = text.ai.prompt;
const TL = text.ai.list;
const TT = text.ai.test;
const TP = text.ai.params;
const TM = text.ai.model;
const T = text.ai;

/** 편집 중인 ai.yaml. 화면이 모르는 칸도 들고 있다가 그대로 돌려보낸다 */
type Draft = Record<string, unknown> & {
  /** 켜고 끄기. 끄면 고른 것은 두고 부르지만 않는다(없으면 provider 로 판단: off 면 꺼짐) */
  enabled?: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  location?: string;
  project?: string;
  extra?: string;
  hideModels?: string[];
  retryStatus?: number[] | null;
  // 수 칸. 비우면 null(서버의 기본값을 쓴다). 손으로 고친 파일에는 글자로 적힌 수가 있을 수 있다
  timeoutMs?: number | string | null;
  totalTimeoutMs?: number | string | null;
  retries?: number | string | null;
  retryDelayMs?: number | string | null;
  retryDelayMaxMs?: number | string | null;
  batchSize?: number | string | null;
  retryTimeouts?: boolean;
  skipConfident?: boolean;
};
/** 프롬프트 섹션 하나(편집 중). key 는 화면이 붙잡아 두는 번호, name 은 설정 쪽에 실리는 이름 */
type Section = PromptSection & { key: number; name: string };
/** 목록 줄 형식(ai.yaml 의 list) */
type ListCfg = { lineFormat: string; unknownDuration: AiUnknown; unknownText: string };
/** 확인 결과 한 칸(무료 · 유료 테스트) */
type Tested = { kind: string; ok: boolean; status: number | null | undefined; tookMs: number; reason?: string; extra?: string; asked?: string; body?: string; raw?: string };

// 아이콘 버튼(XS 32 · 20, 누를 자리 48)
const NL = String.fromCharCode(10);

const route = useRoute();
const router = useRouter();
// 프로바이더를 안 골라도 여는 것
const ALWAYS_OPEN: readonly string[] = ["model", "log", "usage"];

// ── 목록 · 상세. 주소 ?ai= 에 고른 줄(model · prompt · advanced · log · usage). 두 단이면 고른 것이 없을 때 모델 ──
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
/** 보이는 묶음(고른 줄) */
const view = computed(() => picked.value);
const providerLabel = computed(() => providerOptions.value.find((one) => one.value === draft.value.provider)?.label ?? draft.value.provider ?? "");
// 한 단에서 열면 방문 기록을 한 칸 쌓아(뒤로가기 = 목록), 두 단에서 고르면 주소만 바꾼다
function openItem(id: string) {
  const query = { ...route.query, ai: id };
  if (twoPane.value) void router.replace({ query });
  else void pushDown(router, route, { query });
}

// 템플릿에 그대로 적으면 Vue 가 보간으로 읽는다. 값으로 둔다(LIST_MARK 는 봇과 같이 쓰는 config/schema/ai-prompt)
const NONE_MARK = "{{none}}";
const EXTRA_SAMPLE = `think=false\nreasoning_effort=low\nresponse_format=json::{"type":"json_object"}\nheader::X-Title=Discord Musicbot\nmax_tokens=${NONE_MARK}`;

const ROLES = AI_ROLES;

// 프로바이더 목록은 서버가 준다(주소·키 필요 여부까지). 화면이 베껴 두면 한쪽만 고치게 된다.

const MARKS = LINE_MARKS.map((name) => ({ mark: `{{${name}}}`, hint: T.markHints[name] }));

const UNKNOWN: Array<{ value: AiUnknown; label: string; hint: string }> = [
  { value: "hide", ...T.unknownWays.hide },
  { value: "text", ...T.unknownWays.text },
  { value: "zero", ...T.unknownWays.zero },
];

const draft = ref<Draft>({ provider: "off" });
// 모델이 받는 칸. 서버가 프로필(data/ai-models.json)을 보고 알려 준다
const fieldInfo = ref<AiFields>({ known: false, fields: [], groups: [], models: [] });
const showAdvanced = ref(false);
const showHide = ref(false);
const refreshing = ref(false);

async function refreshModels() {
  refreshing.value = true;
  try {
    const { data } = await axios.post<RefreshResult>("/api/admin/ai/models/refresh", undefined, { timeout: LIMIT.none });
    if (data.changed) {
      notifyDone(T.modelsRefreshed, T.modelCount(data.count));
      await loadFields();
    } else notifyDone(T.modelsCurrent);
  } catch (error) {
    notifyProblem(error, T.modelsRefreshFailed);
  } finally {
    refreshing.value = false;
  }
}
// 값은 모델별로 따로 든다. 모델을 갈아타도 앞 모델에서 고른 값이 따라오지 않는다.
const allParams = ref<Record<string, Record<string, unknown>>>({});
const params = ref<Record<string, unknown>>({});
const jsonText = ref<Record<string, string>>({});
// 토큰은 어림수다. 어느 기준으로 셌는지 같이 밝힌다
const tokenEach = ref<number[]>([]);
const tokenTotal = ref<number | null>(null);
const tokenExact = ref(true);
const tokenError = ref("");
let tokenTimer: ReturnType<typeof setTimeout> | undefined;
// 아래 감시가 화면을 만드는 도중에 곧바로(immediate) 부르는 함수들이 읽는 값. 감시보다 먼저 둔다
let picking = ""; // 지금 칸을 보여 주는 모델
// 이름은 설정 쪽에 있고 내용은 프롬프트 파일에 있다. 둘을 차례로 짝지어 합친다
let names: string[] = [];
// 세기 · 칸 읽기는 고치는 대로 다시 묻는다. 늦게 온 앞 물음의 답이 새 답을 덮지 않게 차례를 맞춘다
let tokensSeq = 0;
let fieldsSeq = 0;
const jsonBad = ref<Record<string, boolean>>({});

// 모델 칸의 값. 고른 것은 모양이 정해져 있지 않아(프로필이 정한다) 그리는 칸에 맞춰 읽는다
function numberParam(key: string): number | string | null {
  const v = params.value[key];
  return typeof v === "number" || typeof v === "string" ? v : null;
}
const listParam = (key: string): string[] => {
  const v = params.value[key];
  return Array.isArray(v) ? v.map(String) : [];
};

function onJson(key: string, text: string) {
  jsonText.value = { ...jsonText.value, [key]: text };
  if (!text.trim()) {
    params.value = { ...params.value, [key]: undefined };
    jsonBad.value = { ...jsonBad.value, [key]: false };
    return;
  }
  try {
    params.value = { ...params.value, [key]: JSON.parse(text) };
    jsonBad.value = { ...jsonBad.value, [key]: false };
  } catch {
    jsonBad.value = { ...jsonBad.value, [key]: true };
  }
}
const listCfg = ref<ListCfg>({ lineFormat: "", unknownDuration: "hide", unknownText: "" });
const sections = ref<Section[]>([]);

const keyPresence = ref<Record<string, boolean>>({});
const keyStates = ref<Record<string, AiKeyState>>({});
const keyInput = ref("");
const savingKey = ref(false);
const paid = ref<"ping" | "judge" | null>(null); // 확인 대화상자
const paidUrl = ref(""); // 그 대화상자에 띄울 진짜 주소. 서버에 물어서 채운다
const paidUrlError = ref(""); // 못 물어봤으면 까닭. 틀린 주소를 지어 보여 주지 않는다
const providers = ref<AiState["providers"]>([{ value: "off", label: T.providerOff, group: "" }]);
const pingText = ref("");
const loadingModels = ref(false);
// 프로바이더를 바꾸면 모델 칸이 빈다. 사람이 고른 것만 브라우저에 적어 둔다.
// 저절로 고른 첫 모델까지 적으면 "마지막에 고른 것"이 그것으로 덮인다.
// 접기 상태와 같은 화면 편의라 설정 파일에 넣지 않는다.
const PICK_KEY = "configAI.model.picked";
function rememberedModels(): Record<string, string> {
  try {
    return JSON.parse(readStored(PICK_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}
// 사생활 보호 모드처럼 못 쓰는 브라우저면 기억을 못 할 뿐이다
function rememberModel(provider: string | undefined, model: string | undefined) {
  if (!provider || provider === "off" || !model) return;
  writeStored(PICK_KEY, JSON.stringify({ ...rememberedModels(), [provider]: model }));
}

const models = ref<string[]>([]);
// 프로필이 아는 모델은 보기 좋은 이름으로 보여준다. 모르는 것은 원본 ID 그대로.
// 키로 실제로 쓸 수 있는 것은 /models 만 안다(로컬·신모델은 프로필에 없다).
const modelChoices = computed(() =>
  models.value.map((id) => {
    const known = fieldInfo.value.models.find((one) => one.modelId === id);
    return { id, label: known ? `${known.name} (${id})` : id };
  }),
);
const manualModel = ref(false);
const pinging = ref(false);
// 무료·유료 둘 다 테스트 결과다. 나눠 두면 어느 것이 방금 것인지 헷갈린다.
const tested = ref<Tested | null>(null);
const showRaw = ref(false);
// 미리보기: 나갈 것을 만들어만 본 것
const shown = ref<Preview | null>(null);
const defaults = ref<{ sections: PromptSection[]; line: string }>({ sections: [], line: "" });

let serial = 0;

// 키는 프로바이더마다 따로다(비밀 표). 값은 안 내려오고 상태만 온다.
// 저장된 키가 있는가(지금 주소로 쓸 수 없어도 있다. 그때는 keyTrouble 이 까닭을 보인다)
const hasKey = computed(() => (keyStates.value[draft.value.provider ?? ""] ?? (keyPresence.value[draft.value.provider ?? ""] ? "ok" : "none")) !== "none");
// 키가 있는데 지금 쓸 수 없는 까닭: moved(주소 · 리전이 바뀜) · again(풀 수 없음). 없거나 쓸 수 있으면 null
const keyTrouble = computed(() => {
  const state = keyStates.value[draft.value.provider ?? ""];
  return state === "moved" || state === "again" ? state : null;
});
const spec = computed(() => providers.value.find((one) => one.value === draft.value.provider) || null);

// 로컬 · 클라우드 · 게이트웨이로 묶어 보여 준다. 묶음 없는 것("사용하지 않음")은 맨 위에.
const ungrouped = computed(() => providers.value.filter((one) => !one.group));
const grouped = computed(() => {
  const out: Array<{ name: string; items: AiState["providers"] }> = [];
  for (const one of providers.value.filter((x) => x.group)) {
    const found = out.find((g) => g.name === one.group);
    if (found) found.items.push(one);
    else out.push({ name: one.group, items: [one] });
  }
  return out;
});
// 프로바이더를 골랐는지(모델 말고 나머지 칸을 쓸 수 있는지). 실제로 켜졌는지는 aiOn
const on = computed(() => !!draft.value.provider && draft.value.provider !== "off");
// 켜고 끄기 스위치. 파일에 enabled 가 없으면 provider 로 판단한다(옛 파일: off 면 꺼짐)
const aiOn = computed({
  get: () => draft.value.enabled ?? on.value,
  set: (v: boolean) => (draft.value.enabled = v),
});
// 로컬 모델은 키를 안 받는다. 있으나 마나 한 표시를 띄우지 않는다
const needsKey = computed(() => !!spec.value?.key);

/**
 * 어디로 나가는지 보여 준다. 버텍스는 주소가 없어 봇과 같은 규칙(rules/vertex-url)으로 조립한다.
 *
 * 프로젝트 ID 만 가린다. 리전은 공개된 값이고, 가려 두면 정작 주소가 맞는지 못 본다.
 * 조립은 칸을 인코딩하므로 보일 때는 풀어 쓴다(자리 글 · 한글). 주소를 바꾸는 글자(# / ? @)는 decodeURI 가 풀지 않아 그대로 드러난다
 */
const shownEndpoint = computed(() => {
  if (!spec.value?.needsProject) return spec.value?.baseUrl;
  return decodeURI(vertexChatUrl(draft.value, T.endpointProject, String(draft.value.model || "").trim() || T.endpointModel));
});
const keyPlaceholder = computed(() => {
  if (spec.value?.serviceAccount) return hasKey.value ? T.keyPlaceholder.accountSaved : '{\n  "type": "service_account",\n  "project_id": "…",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n…",\n  "client_email": "…@….iam.gserviceaccount.com"\n}';
  return hasKey.value ? T.keyPlaceholder.keySaved : T.keyPlaceholder.empty;
});

// 붙여넣기 전에 알려 준다. 엉뚱한 것을 저장해 두고 나중에 401 만 보는 것보다 낫다
const looksLikeAccount = computed(() => {
  const text = keyInput.value.trim();
  if (!text.startsWith("{")) return true; // 경로로 적는 옛 방식도 받는다
  try {
    const one = JSON.parse(text);
    return !!(one?.client_email && one?.private_key);
  } catch {
    return false;
  }
});
// 평문으로 열어 두었으면 키가 그대로 네트워크를 지난다. 파일을 고칠 때는 없는 일이다
const secureOrigin = computed(() => window.isSecureContext);
// custom 은 저장된 주소와 같을 때만 키가 붙는다(autoplayAssist.authOf).
// ref 를 computed 보다 먼저 선언한다. 아래에 두면 TDZ 이고, Vue 가 그 예외를 삼켜
// 화면만 조용히 비는 종류의 버그가 된다(SourceEditor 에서 한 번 당했다).
const savedBaseUrl = ref("");
const staleCustomUrl = computed(() => !!spec.value?.editable && String(draft.value.baseUrl || "") !== savedBaseUrl.value);
const listMarked = computed(() => hasListMark(sections.value));

// 다듬지 않는다. 무엇이 나갈지 그대로 봐야 한다.
// 보낼 글을 섹션별로. 규격에 따라 본문 모양이 달라 JSON 으로는 읽기 어렵다.
// 이름은 프롬프트 칸에 적어 둔 것을 쓴다.
// 빈 섹션은 요청에서 빠진다. 서버가 달아 준 `at`(원래 섹션 번호)으로 이름표를 찾아야
// 밀리지 않는다. 번호로 짝지으면 빈 섹션 뒤의 것들이 전부 한 칸씩 어긋난다.
const shownSections = computed(() =>
  (shown.value?.messages || []).map((one, i) => {
    const at = Number.isInteger(one.at) ? one.at : i;
    return { name: sections.value[at]?.name || TR.sectionName(at + 1), role: one.role, text: one.content };
  }),
);

// 날것 그대로도 볼 수 있게 남겨 둔다(접어 둔다)
const boxes = computed(() => {
  const one = shown.value;
  if (!one) return [];
  return [
    { title: "URL", text: one.url },
    { title: T.boxes.headers, text: JSON.stringify(one.headers, null, 2) },
    { title: T.boxes.body, text: JSON.stringify(one.body, null, 2) },
  ];
});
const showRawRequest = ref(false);

const hideModels = computed({
  get: () => draft.value.hideModels || [],
  set: (v: string[]) => {
    draft.value.hideModels = v;
  },
});

// 추가 파라미터는 한 줄에 하나씩 적는 글이다. 뜯어 읽는 것은 서버가 한다(autoplayAssist)
const extraText = computed({
  get: () => draft.value.extra || "",
  set: (v: string) => {
    draft.value.extra = v;
  },
});

// 파일은 밀리초로 적히지만 사람에게는 초가 낫다
const secondsOf = (key: string, round = true) =>
  computed({
    get: () => {
      const ms = draft.value[key];
      return ms == null ? null : round ? Math.round(Number(ms) / 1000) : Number(ms) / 1000;
    },
    set: (v: number | null) => {
      draft.value[key] = v == null ? null : Math.round(v * 1000);
    },
  });
const timeoutSec = secondsOf("timeoutMs");
const totalSec = secondsOf("totalTimeoutMs");
const delaySec = secondsOf("retryDelayMs", false);
const delayMaxSec = secondsOf("retryDelayMaxMs", false);

// 비운 칸이 쓰는 값(서버의 기본값). 흐린 글로 보여 준다
const settingDefaults = ref<Partial<AiDefaults>>({});
const defaultOf = (key: keyof AiDefaults) => {
  const value = settingDefaults.value[key];
  return value == null ? "" : Array.isArray(value) ? value.join(" · ") : String(value);
};
const defaultSec = (key: keyof AiDefaults) => {
  const ms = settingDefaults.value[key];
  return ms == null ? "" : String(Number(ms) / 1000);
};
// 상태 코드는 수로 적는다. 수가 아닌 것은 버린다. 다 지우면 칸을 비운다(기본값)
function setRetryStatus(values: string[]) {
  const codes = values.map(Number).filter((n) => Number.isInteger(n));
  draft.value.retryStatus = codes.length ? codes : null;
}

// 설정과 프롬프트는 딴 파일이라 저장도 따로 간다.
// 섹션 이름은 ChatML 에 적을 자리가 없어 설정 쪽에 같이 실어 보낸다(차례가 곧 짝이다).
// 고른 모델의 이름표. 프로필이 알면 보기 좋은 이름이 있다.
const modelName = computed(() => fieldInfo.value.models.find((m) => m.modelId === draft.value.model)?.name || "");

// 값을 자르지는 않는다. 다만 얼마까지 받는다고 적혀 있는지는 보여 준다
function hintOf(field: ModelField) {
  const lo = field.min;
  const hi = field.max;
  if (lo === undefined && hi === undefined) return field.path;
  const range = lo !== undefined && hi !== undefined ? `${lo}~${hi}` : lo !== undefined ? T.atLeast(lo) : T.atMost(hi!);
  return `${field.path} · ${range}`;
}

const paramGroups = computed(() => {
  const all = fieldInfo.value.fields.filter((f) => (showAdvanced.value || f.visibility !== "advanced") && showIfOk(f));
  const known: ModelGroup[] = fieldInfo.value.groups || [];
  const by = new Map<string, { id: string; label: string; fields: ModelField[] }>();
  for (const field of all) {
    const id = field.group || "generation";
    const group = by.get(id) ?? { id, label: known.find((g) => g.id === id)?.label || id, fields: [] };
    by.set(id, group);
    group.fields.push(field);
  }
  for (const group of by.values()) group.fields.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const order = (id: string) => known.findIndex((g) => g.id === id);
  return [...by.values()].sort((a, b) => (order(a.id) + 1 || 99) - (order(b.id) + 1 || 99));
});

// 저쪽이 "이 칸이 켜져 있을 때만 보여라"를 적어 둔다(logprobs → top_logprobs 처럼).
// 가려진 칸은 서버도 안 보낸다(autoplayAssist.withParams). 판정 기준을 같게 둔다.
function showIfOk(field: ModelField) {
  const cond = field.showIf;
  if (!cond) return true;
  const owner = fieldInfo.value.fields.find((one) => one.key === cond.key);
  const value = [cond.key ? params.value[cond.key] : undefined, owner?.default].find((one) => one !== undefined && one !== "");
  return value === cond.equals;
}

const paramLimits = computed(() => {
  const m = fieldInfo.value.models.find((one) => one.modelId === draft.value.model);
  if (!m?.contextWindowTokens && !m?.maxOutputTokens) return "";
  const n = (x: number) => formatNumber(Number(x));
  return [m.contextWindowTokens ? T.contextTokens(n(m.contextWindowTokens)) : "", m.maxOutputTokens ? T.outputTokens(n(m.maxOutputTokens)) : ""].filter(Boolean).join(" · ");
});

// 저장하면 서버가 보낸 차례대로 파일을 줄 세운다. config/ai.example.yaml 과 같은 차례(schema/ai 의 AI_KEY_ORDER)로 보내야 새로 깐 파일이 뒤섞이지 않는다.
const payload = computed(() => {
  const all: Record<string, unknown> = { ...draft.value, params: cleanParams.value, list: { ...listCfg.value }, promptNames: sections.value.map((one) => one.name || "") };
  const out: Record<string, unknown> = {};
  for (const key of AI_KEY_ORDER) if (key in all) out[key] = all[key];
  // 모르는 키는 뒤에 그대로 둔다. 빠뜨리면 저장할 때 파일에서 지워진다
  for (const [key, value] of Object.entries(all)) if (!(key in out)) out[key] = value;
  return out;
});

// 빈 값은 "고르지 않음"이다(프로필 기본값으로 간다). 빈 모델 칸도 남기지 않는다.
const cleanParams = computed(() => {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [model, values] of Object.entries(allParams.value)) {
    const kept = Object.fromEntries(Object.entries(values || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined));
    if (Object.keys(kept).length) out[model] = kept;
  }
  return out;
});
const promptPayload = computed((): PromptSection[] => sections.value.map((one) => ({ role: one.role, text: one.text })));

// AI 에 보낼 요청을 만들 때 쓰는 것. 저장용(payload)과 갈리는 자리는 프롬프트 하나다.
// 프롬프트는 ai-prompt.chatml 에 따로 저장하므로 payload 에는 없고, 요청에는 있어야 한다.
// 미리보기·판정 요청처럼 "지금 화면에 있는 것"을 시험하는 곳은 전부 이쪽을 쓴다.
const aiRequestDraft = () => ({ ...payload.value, prompt: promptPayload.value });

// 저장할 때 서버가 보는 검사 그대로(schema/ai · schema/ai-prompt). 저장 버튼을 누르기 전에 알려 준다
// 꺼 두면(enabled: false) 나머지 칸 · 프롬프트를 따지지 않고 그대로 저장한다(틀린 것이 있어도)
const problems = computed(() => (aiSwitchedOff(payload.value) ? [...serverProblems.value] : [...aiProblems(payload.value), ...promptProblems(promptPayload.value, true), ...serverProblems.value]));

function addSection() {
  sections.value.push({ key: ++serial, role: sections.value.length ? "user" : "system", name: "", text: "" });
}

// 접힘은 자리로 기억한다. 지우면 그 아래의 기억이 한 칸씩 당겨진다
function removeSection(i: number) {
  reorderPrompts(sections.value.map((_, at) => at).filter((at) => at !== i));
  sections.value.splice(i, 1);
}

function loadDefaults() {
  sections.value = defaults.value.sections.map((one) => ({ key: ++serial, role: one.role, name: "", text: one.text }));
}

// 자리표시자 알약. 줄 형식 칸 끝에 붙인다
function insertMark(mark: string) {
  listCfg.value.lineFormat = `${listCfg.value.lineFormat || defaults.value.line}${mark}`;
}

// ── 순서 바꾸기. 접어 둔 기억도 그 섹션을 따라간다 ─────────────────────────
const { startDrag } = useDragReorder(sections, reorderPrompts);

// ── 주고받기 ──────────────────────────────────────────────────────────────

function apply(data: Record<string, unknown>) {
  const { list, prompt: _prompt, promptNames, params: saved, ...rest } = data || {};
  draft.value = { provider: "off", extra: "", hideModels: [], location: "", project: "", ...rest };
  allParams.value = { ...((saved as Record<string, Record<string, unknown>> | undefined) || {}) };
  // 설정에 저장돼 있는 모델도 사람이 고른 것이다. 기동 직후에도 기억이 비지 않게 둔다
  rememberModel(draft.value.provider, draft.value.model);
  picking = draft.value.model || "";
  params.value = { ...(allParams.value[picking] || {}) };
  listCfg.value = { lineFormat: "", unknownDuration: "hide", unknownText: "", ...((list as Partial<ListCfg> | undefined) || {}) };
  names = Array.isArray(promptNames) ? promptNames.map(String) : [];
  sections.value.forEach((one, i) => (one.name = names[i] || ""));
  savedBaseUrl.value = String(draft.value.baseUrl || ""); // 키를 붙일지 가르는 기준
}

function applyPrompt(list: PromptSection[] | null | undefined) {
  sections.value = (list || []).map((one, i) => ({ key: ++serial, role: one?.role || "system", name: names[i] || "", text: String(one?.text ?? "") }));
}

// 설정(ai.yaml)과 프롬프트(ai-prompt.chatml)는 딴 파일이지만 한 편집기다. 둘을 한 덩어리로 읽고, 한 요청으로 저장한다(둘 중 하나만 저장되지 않게).
// 이름(promptNames)이 설정 쪽에 실리므로 설정을 넣은 뒤에 프롬프트를 넣는다
const {
  dirty,
  saving,
  loadError,
  serverProblems,
  fetch: fetchAll,
  save,
  revert,
} = useConfigFile({
  tab: "ai",
  savedNote: T.savedNote,
  // 적어 두고 저장하지 않은 키도 떠날 때 묻는다
  alsoUnsaved: () => Boolean(keyInput.value.trim()),
  payload: () => ({ data: payload.value, sections: promptPayload.value }),
  apply: (both) => {
    apply(both.data as Record<string, unknown>);
    applyPrompt(both.sections as PromptSection[]);
  },
  read: async () => ({ data: (await axios.get<ConfigFile>("/api/admin/config/ai")).data.data, sections: (await axios.get<PromptReply>("/api/admin/ai/prompt")).data.sections }),
  write: async (both) => {
    const saved = (await axios.put<AiSaved>("/api/admin/ai/settings", both)).data;
    // 주소 · 리전을 바꿔 저장했으면 묶인 키의 상태도 바뀐다
    void refreshKeys();
    return saved;
  },
});

// 프로바이더나 모델이 바뀌면 받을 수 있는 칸도 달라진다.
watch(
  () => [draft.value.provider, draft.value.model],
  () => loadFields(),
  { immediate: true },
);

// 고른 값은 그때그때 모델 칸에 담는다
watch(
  params,
  (now) => {
    if (draft.value.model) allParams.value = { ...allParams.value, [draft.value.model]: { ...now } };
  },
  { deep: true },
);

watch(
  () => [sections.value.map((one) => one.text).join(String.fromCharCode(10)), draft.value.provider, draft.value.model],
  () => {
    clearTimeout(tokenTimer);
    tokenTimer = setTimeout(countTokens, 400);
  },
  { immediate: true },
);

async function countTokens() {
  const seq = ++tokensSeq;
  if (!sections.value.length) {
    tokenEach.value = [];
    tokenTotal.value = null;
    return;
  }
  try {
    const { data } = await axios.post<TokensReply>(
      "/api/admin/ai/tokens",
      {
        provider: draft.value.provider,
        model: draft.value.model,
        texts: sections.value.map((one) => one.text),
      },
      { timeout: LIMIT.none },
    );
    if (seq !== tokensSeq) return;
    tokenEach.value = data.each;
    tokenTotal.value = data.total;
    tokenExact.value = data.exact;
    tokenError.value = "";
  } catch (error) {
    if (seq !== tokensSeq) return;
    tokenEach.value = [];
    tokenTotal.value = null;
    tokenError.value = problemText(error, T.failed.tokens);
  }
}

// ── 판정 테스트 ────────────────────────────────────────────────────────────
// 보기 곡이 아니라 진짜 곡으로 시험한다. 링크 조회는 아무것도 보내지 않고,
// 판정 요청만 실제로 보낸다. 적어만 두고 조회를 안 했으면 보기 곡으로 나간다.
const judgeUrls = ref("");
const judgeGenre = ref(TJ.genrePlaceholder);
const judging = ref(false);
const judgeError = ref("");
const judgeCands = ref<TestCandidate[]>([]);
const judgeList = ref<string[]>([]);
const judgeVerdicts = ref<Array<NonNullable<JudgeResult["verdicts"]>[number] | null> | null>(null);
const judgeSent = ref<JudgeResult | null>(null);
const showJudgeRaw = ref(false);
const judgeLookedUp = ref("");

// 안전하지 않은 출처처럼 못 쓰는 자리면 복사만 안 될 뿐이다
function copy(text: unknown) {
  navigator.clipboard?.writeText(String(text ?? "")).catch(() => {
    /* 복사만 안 된다 */
  });
}

// 적어 두고 조회를 안 눌렀으면 알려 준다. 그대로 보내면 보기 곡으로 판정한다
// 조회 안 한 주소를 그대로 보내면 쓰이는 보기 곡(제목 · 길이)
const SAMPLE_LINES = AI_SAMPLE_CANDIDATES.map((one) => (one.durationSec ? `${one.title} (${formatDuration(one.durationSec)})` : one.title)).join(NL);
const judgeStale = computed(() => !!judgeUrls.value.trim() && judgeUrls.value.trim() !== judgeLookedUp.value);
const rendered = (one: TestCandidate) => Boolean(!one.error && one.title);
const judgeUsable = computed(() => (judgeStale.value ? [] : judgeCands.value.filter(rendered)));

const judgeBoxes = computed(() => {
  const one = judgeSent.value;
  if (!one) return [];
  // 미리보기 모달과 같은 것을 같은 차례로 보여준다. 같은 요청인데 보여주는 것이 다르면
  // 어느 쪽이 진짜인지 알 수 없다.
  return [
    { title: "URL", text: one.url },
    { title: T.boxes.headers, text: JSON.stringify(one.headers, null, 2) },
    { title: T.boxes.body, text: JSON.stringify(one.body, null, 2) },
    { title: T.boxes.response, text: one.response || T.boxes.empty },
  ];
});

// 못 읽은 줄이 섞여 있어 후보 차례와 줄 차례가 어긋난다. 멀쩡한 것만 세어 맞춘다
function lineFor(cand: TestCandidate) {
  const at = judgeCands.value.filter(rendered).indexOf(cand);
  return judgeList.value[at] ?? "";
}
type Verdict = { song: boolean | null; fits: boolean | null } | null | undefined;
const verdictOk = (one: Verdict) => Boolean(one && one.song && one.fits);
const verdictText = (one: Verdict) => (!one ? "?" : one.song && one.fits ? T.verdicts.pass : !one.song ? T.verdicts.notSong : T.verdicts.wrongGenre);

const judgeUrlList = () =>
  judgeUrls.value
    .split(NL)
    .map((one) => one.trim())
    .filter(Boolean);

async function lookupJudge() {
  judging.value = true;
  judgeError.value = "";
  judgeVerdicts.value = null;
  judgeSent.value = null;
  try {
    judgeCands.value = (await axios.post<CandidatesReply>("/api/admin/ai/judge/lookup", { urls: judgeUrlList() }, { timeout: LIMIT.none })).data.candidates;
    judgeLookedUp.value = judgeUrls.value.trim();
  } catch (error) {
    judgeError.value = problemText(error, T.failed.lookup);
  } finally {
    judging.value = false;
  }
}

// 줄 그리기는 서버 몫이다. 화면이 흉내 내면 실제로 나가는 줄과 어긋난다.
// 늦게 온 응답이 방금 그린 것을 덮지 않도록 차례를 센다.
let linesSeq = 0;
let linesTimer: ReturnType<typeof setTimeout> | undefined;
watch([judgeCands, judgeGenre, () => JSON.stringify(listCfg.value)], () => {
  clearTimeout(linesTimer);
  linesTimer = setTimeout(drawLines, 150);
});

async function drawLines() {
  const usable = judgeCands.value.filter(rendered);
  if (!usable.length) {
    judgeList.value = [];
    return;
  }
  const seq = ++linesSeq;
  try {
    const { data } = await axios.post<LinesReply>("/api/admin/ai/judge/lines", { candidates: usable, list: listCfg.value, genre: judgeGenre.value });
    if (seq === linesSeq) judgeList.value = data.lines;
  } catch (error) {
    if (seq !== linesSeq) return;
    judgeList.value = [];
    judgeError.value = problemText(error, T.failed.list);
  }
}

async function runJudge() {
  judging.value = true;
  judgeError.value = "";
  try {
    const usable = judgeUsable.value; // 조회를 안 했으면 비어 있다. 서버가 보기 곡으로 돌린다
    const { data } = await axios.post<JudgeResult>("/api/admin/ai/judge/run", { candidates: usable, genre: judgeGenre.value, data: aiRequestDraft() }, { timeout: LIMIT.none });
    judgeSent.value = data;
    judgeVerdicts.value = usable.length ? judgeCands.value.map((cand) => (cand.error ? null : (data.verdicts?.[usable.indexOf(cand)] ?? null))) : null;
  } catch (error) {
    judgeError.value = problemText(error, T.failed.judge);
  } finally {
    judging.value = false;
  }
}

async function loadFields() {
  const seq = ++fieldsSeq;
  const provider = draft.value.provider;
  const model = draft.value.model;
  if (!provider || provider === "off") {
    fieldInfo.value = { known: false, fields: [], groups: [], models: [] };
    return;
  }
  try {
    const { data } = await axios.get<AiFields>("/api/admin/ai/fields", { params: { provider, model: model || "" } });
    if (seq !== fieldsSeq) return;
    fieldInfo.value = data;
    if (model !== picking) {
      picking = model ?? "";
      params.value = { ...(allParams.value[picking] || {}) };
      jsonText.value = {};
      jsonBad.value = {};
    }
  } catch (error) {
    if (seq !== fieldsSeq) return;
    fieldInfo.value = { known: false, fields: [], groups: [], models: [] };
    loadError.value = problemText(error, T.failed.fields);
  }
}

// 키 상태만 다시 받는다(설정을 저장한 뒤)
async function refreshKeys() {
  try {
    const state = (await axios.get<AiState>("/api/admin/ai/state")).data;
    keyPresence.value = state.hasKey || {};
    keyStates.value = state.keyState || {};
  } catch {
    /* 다음에 탭을 열 때 다시 받는다 */
  }
}

// 키 유무와 기본 프롬프트. 둘 다 서버가 들고 있다.
// 화면이 프롬프트를 따로 베껴 두면 한쪽만 고치게 된다.
async function fetchState() {
  try {
    const state = (await axios.get<AiState>("/api/admin/ai/state")).data;
    keyPresence.value = state.hasKey || {};
    keyStates.value = state.keyState || {};
    if (state.providers?.length) providers.value = state.providers;
    pingText.value = state.pingText || "";
    defaults.value = { sections: state.defaultSections || [], line: state.defaultLine || "" };
    settingDefaults.value = state.settingDefaults || {};
  } catch (error) {
    keyPresence.value = {};
    keyStates.value = {};
    loadError.value = problemText(error, T.failed.state);
  }
}

// 만들어만 본다. 아무 데도 안 나간다.
async function openPreview() {
  try {
    shown.value = (await axios.post<Preview>("/api/admin/ai/preview", { data: aiRequestDraft() })).data;
  } catch (error) {
    loadError.value = problemText(error, T.failed.preview);
  }
}

// 고르기 칸(SingleSelect)의 선택지와 고른 뒤. 프로바이더는 로컬 · 클라우드 · 게이트웨이로 묶어 보인다(묶음 없는 것은 맨 위)
// "사용하지 않음"(off)은 빼고 켜고 끄기는 스위치가 맡는다
const providerOptions = computed<Option[]>(() => [...ungrouped.value.filter((one) => one.value !== "off").map((one) => ({ value: one.value, label: one.label })), ...grouped.value.flatMap((g) => g.items.map((one) => ({ value: one.value, label: one.label, group: g.name })))]);
function pickProvider(value: OptionValue) {
  draft.value.provider = String(value);
  onProvider();
}
function pickModel(value: OptionValue) {
  draft.value.model = String(value);
  rememberModel(draft.value.provider, draft.value.model);
}
// 모델 매개변수의 고르기: 값이 참 · 거짓 · 수일 수도 있어 고르기 칸에는 차례(문자열)로 넘기고 돌려받는다. 비어 있으면 기본값
const enumOptions = (list: Array<{ value: unknown; label: string }>): Option[] => list.map((one, i) => ({ value: String(i), label: one.label }));
const enumValue = (list: Array<{ value: unknown }>, value: unknown): OptionValue => {
  const at = list.findIndex((one) => one.value === value);
  return at < 0 ? "" : String(at);
};
const enumPick = (list: Array<{ value: unknown }>, picked: OptionValue): unknown => (picked === "" ? "" : list[Number(picked)]?.value);

function onProvider() {
  models.value = [];
  tested.value = null;
  keyInput.value = "";
  manualModel.value = false;

  // baseUrl 은 custom 전용이다. 다른 것을 골랐다고 적어 둔 주소를 지우지 않는다
  if (!on.value) return;
  void loadModels({ quiet: true }); // 고르면 알아서 불러온다. 무료라 누르게 할 이유가 없다
}

// 무료. 추론을 안 돌린다. 연결 확인이자 모델 목록 불러오기다(같은 한 번의 호출이다).
// quiet: 프로바이더를 고를 때 저절로 도는 것이라 실패를 빨갛게 띄우지 않는다.
// 받은 모델 목록을 넣는다. 목록을 받았으면 고르는 칸으로 돌아가고(못 받았을 때만 직접 적게 한다),
// 지금 값이 이 프로바이더의 목록에 없으면 기억해 둔 것으로 되돌린다
function takeModels(list: string[]) {
  models.value = list;
  manualModel.value = !list.length;
  if (list.includes(draft.value.model ?? "")) return;
  const remembered = rememberedModels()[draft.value.provider ?? ""];
  draft.value.model = list.includes(remembered) ? remembered : list[0] || "";
}

// 무료 테스트의 결과 칸
function modelsTested(got: ModelsCheck): Tested {
  const hidden = got.hiddenCount ? T.hiddenCount(got.hiddenCount) : "";
  return { kind: TT.free, ok: got.ok, status: got.status, tookMs: got.tookMs ?? 0, reason: got.reason, extra: got.ok ? `${T.modelCount(models.value.length)}${hidden}` : "", body: got.ok ? "" : got.response, raw: got.response };
}

async function loadModels({ quiet = false } = {}) {
  loadingModels.value = true;
  showRaw.value = false;
  if (!quiet) tested.value = null;

  try {
    const got = (await axios.post<ModelsCheck>("/api/admin/ai/models", { data: payload.value }, { timeout: LIMIT.none })).data;
    takeModels(got.models || []);
    if (quiet && !got.ok) return;
    tested.value = modelsTested(got);
  } catch (error) {
    if (!quiet) tested.value = { kind: TT.free, ok: false, status: null, tookMs: 0, reason: problemText(error, T.failed.models) };
  } finally {
    loadingModels.value = false;
  }
}

// 돈이 드는 것은 한 번 물어본다. 보안이 아니라 실수 방지다.
// 확인 대화상자를 열면서 진짜 주소를 받아 온다. 미리보기는 아무 데도 안 보내므로 토큰이 안 든다.
// 클라이언트가 주소를 흉내 내면 어긋난다(버텍스는 project·location 으로 조립하고,
// custom 은 끝 슬래시를 떼야 한다). 물어보는 편이 늘 맞다.
const askPaid = async (which: "ping" | "judge") => {
  paid.value = which;
  paidUrl.value = "";
  paidUrlError.value = "";
  try {
    const { url } = (await axios.post<Preview>("/api/admin/ai/preview", { data: aiRequestDraft() })).data;
    if (paid.value === which) paidUrl.value = url || "";
  } catch (error) {
    if (paid.value === which) paidUrlError.value = problemText(error, T.failed.endpoint);
  }
};

function runPaid() {
  const which = paid.value;
  paid.value = null;
  if (which === "ping") void runPing();
  else void runJudge();
}

// 키는 쓰기 전용이다. payload 에 안 싣는다(미리보기·테스트로 새어 나가면 안 된다)
async function putKey(value: string) {
  savingKey.value = true;
  try {
    // 키는 지금 적힌 주소 · 리전에 묶인다(data). 그 설정을 저장해야 쓰인다
    const reply = (await axios.put<KeysReply>("/api/admin/ai/keys", { keys: { [draft.value.provider ?? ""]: value }, data: draft.value })).data;
    keyPresence.value = reply.hasKey || {};
    keyStates.value = reply.keyState || {};
    keyInput.value = "";
    notifyDone(value ? T.keySaved : T.keyCleared);
  } catch (error) {
    notifyProblem(error, value ? T.keySaveFailed : T.keyClearFailed);
  } finally {
    savingKey.value = false;
  }
}

/**
 * 서비스 계정은 JSON 덩어리다. 받은 그대로 붙여넣으면 들여쓰기가 제각각이라,
 * 저장 전에 한 모양으로 정리한다. 파일에 블록 리터럴(`|-`)로 곱게 들어간다.
 */
function saveKey() {
  const text = keyInput.value.trim();
  if (!spec.value?.serviceAccount || !text.startsWith("{")) return putKey(text);
  try {
    return putKey(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    return putKey(text); // 못 읽으면 적힌 그대로. 조용히 버리지 않는다
  }
}
const clearKey = () => putKey("");

// 유료. 짧은 물음 하나를 실제로 생성시킨다(판정 프롬프트는 안 쓴다).
async function runPing() {
  pinging.value = true;
  tested.value = null;
  showRaw.value = false;
  try {
    const got = (await axios.post<PingCheck>("/api/admin/ai/ping", { data: payload.value }, { timeout: LIMIT.none })).data;
    tested.value = {
      kind: TT.paid,
      ok: got.ok,
      status: got.status,
      tookMs: got.tookMs ?? 0,
      reason: got.reason,
      asked: pingText.value,
      body: got.answer || got.response,
      raw: got.response,
    };
  } catch (error) {
    tested.value = { kind: TT.paid, ok: false, status: null, tookMs: 0, reason: problemText(error, T.failed.send) };
  } finally {
    pinging.value = false;
  }
}

onMounted(async () => {
  await fetchState();
  await fetchAll();
  // 켜져 있으면 열자마자 채워 둔다. 무료라 물어볼 것이 없다.
  if (on.value) void loadModels({ quiet: true });
});
</script>
