<!--
  AI 보조 설정 (운영자 패널).

  설정과 **프롬프트**는 settings.db 의 딴 문서("ai" · "ai-prompt")다. 저장은 한 요청으로 둘을 함께 한다.

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
                <textarea v-if="spec?.serviceAccount" :value="keyInput" rows="4" autocomplete="off" :placeholder="keyPlaceholder" :class="[AREA, 'font-mono text-xs', hasKey && 'placeholder:font-sans']" @input="keyInput = valueOf($event)"></textarea>
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
                  <h3 class="flex items-center gap-1 text-sm font-semibold text-on-surface">
                    {{ TL.lineFormat }}<button type="button" :class="[ICON_BTN, 'size-6']" v-tooltip="TL.help" :aria-label="TL.help" aria-haspopup="dialog" @click="syntaxOpen = true"><Icon name="info" :size="16" /></button>
                  </h3>
                  <p class="mt-1 text-xs text-on-surface-variant">
                    {{ TL.lineFormatBefore }}<code class="font-mono">{{ LIST_MARK }}</code
                    >{{ TL.lineFormatAfter }}
                  </p>
                </div>
                <input :value="listCfg.lineFormat" :placeholder="defaults.line" :class="[FIELD, 'w-full font-mono']" @input="listCfg.lineFormat = valueOf($event)" />
                <!-- 문제는 칸 아래에 그 구간을 짚어 보인다(입력칸 안은 색을 칠할 수 없다): 앞뒤 몇 글자와 틀린 구간 · 몇 번째 글자 · 까닭 -->
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
import NumberInput from "./NumberInput.vue";
import ChipInput from "./ChipInput.vue";
import SingleSelect from "./SingleSelect.vue";
import NoticeBox from "./NoticeBox.vue";
import { FIELD, FIELD_LABEL, AREA, CODE_BOX } from "../utils/field.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF } from "../utils/filter-chip.ts";
import BaseSwitch from "./BaseSwitch.vue";
import { isFolded, toggleFold, promptFoldId } from "../composables/config-folds.ts";
import { reportSinglePane, useListDetailLayout, LIST_ROW } from "../composables/list-detail.ts";
import { pushDown } from "../utils/up-nav.ts";
import { SELECT_ROW_ON } from "../utils/select-row.ts";
import { valueOf } from "../utils/dom.ts";
import { LIST_MARK, type PromptSection } from "../../../src/config/schema/ai-prompt.ts";
import InfoDialog from "./InfoDialog.vue";
import { text } from "../text/index.ts";
import { provideAiEditor } from "../composables/ai-editor.ts";
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

// 상태 · 주고받기는 composables/ai-editor(카드들이 같이 쓴다)
const {
  startDrag,
  loadError,
  NL,
  NONE_MARK,
  EXTRA_SAMPLE,
  ROLES,
  MARKS,
  BLOCK_MARK,
  syntaxOpen,
  draft,
  fieldInfo,
  showAdvanced,
  showHide,
  refreshing,
  refreshModels,
  params,
  jsonText,
  tokenEach,
  tokenTotal,
  tokenExact,
  tokenError,
  jsonBad,
  numberParam,
  listParam,
  onJson,
  listCfg,
  sections,
  keyInput,
  savingKey,
  paid,
  paidUrl,
  paidUrlError,
  pingText,
  loadingModels,
  rememberModel,
  models,
  modelChoices,
  manualModel,
  pinging,
  tested,
  showRaw,
  shown,
  defaults,
  hasKey,
  keyTrouble,
  spec,
  on,
  aiOn,
  needsKey,
  shownEndpoint,
  keyPlaceholder,
  looksLikeAccount,
  secureOrigin,
  staleCustomUrl,
  listMarked,
  shownSections,
  boxes,
  showRawRequest,
  hideModels,
  extraText,
  timeoutSec,
  totalSec,
  delaySec,
  delayMaxSec,
  defaultOf,
  defaultSec,
  setRetryStatus,
  modelName,
  hintOf,
  paramGroups,
  paramLimits,
  problems,
  addSection,
  removeSection,
  loadDefaults,
  insertMark,
  lineProblems,
  linePreview,
  judgeUrls,
  judgeGenre,
  judging,
  judgeError,
  judgeCands,
  judgeList,
  judgeVerdicts,
  judgeSent,
  showJudgeRaw,
  copy,
  SAMPLE_LINES,
  judgeStale,
  judgeUsable,
  judgeBoxes,
  lineFor,
  verdictOk,
  verdictText,
  lookupJudge,
  openPreview,
  providerOptions,
  pickProvider,
  pickModel,
  enumOptions,
  enumValue,
  enumPick,
  loadModels,
  askPaid,
  runPaid,
  saveKey,
  clearKey,
} = provideAiEditor();

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
</script>
