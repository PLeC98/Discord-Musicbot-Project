<!--
  AI 보조 설정 (운영자 패널).

  설정은 config/ai.yaml, **프롬프트는 config/ai-prompt.chatml** 로 따로 산다.
  둘 다 파일로도 고칠 수 있다 — 대시보드는 선택 기능이다.

  **키는 쓰기 전용이다.** config/ai-keys.yaml 에 프로바이더마다 따로 있고, 넣을 수는 있어도
  화면으로 되읽지는 못한다 — 값을 내려보내면 XSS 하나로 새어 나간다.

  미리보기는 **보내지 않고 만들기만** 한다. 테스트는 설정한 엔드포인트로 **실제로 보낸다**.
  조립은 봇이 쓰는 코드를 그대로 부르므로, 보이는 것과 나가는 것이 어긋날 수 없다.
-->
<template>
  <div>
    <BaseCard icon="wrench" title="자동재생 AI 보조" class="mb-3">
      <p class="text-muted text-[0.82rem] mt-1 mb-3">곡 이름만 아는 출처(키워드 · Last.fm)에서 고른 후보를 모델에게 한 번 더 물어봅니다. 주소를 직접 받아오는 출처는 묻지 않습니다. 모델을 못 부르면 규칙으로 넘어가므로 재생이 멈추지는 않습니다.</p>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="block">
          <span :class="labelCls">프로바이더</span>
          <div class="relative">
            <select v-model="draft.provider" :class="[inputCls, selectCls]" @change="onProvider">
              <option v-for="one in ungrouped" :key="one.value" :value="one.value" :class="optionCls">{{ one.label }}</option>
              <optgroup v-for="group in grouped" :key="group.name" :label="group.name" :class="optionCls">
                <option v-for="one in group.items" :key="one.value" :value="one.value" :class="optionCls">{{ one.label }}</option>
              </optgroup>
            </select>
            <svg :class="arrowCls" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
          </div>
        </label>

        <!-- 주소를 직접 적는 것은 custom 뿐이다. 나머지는 그 서비스의 주소로 간다.
             버텍스는 아예 없다 — 프로젝트·리전·모델로 조립한 것을 보여 준다. -->
        <label v-if="on" class="block">
          <span :class="labelCls">엔드포인트 주소</span>
          <input v-if="spec?.editable" v-model="draft.baseUrl" placeholder="https://example.com/v1" :class="inputCls" />
          <p v-else class="text-muted text-[0.82rem] font-mono break-all py-2">{{ shownEndpoint }}</p>
        </label>
      </div>

      <template v-if="on">
        <span :class="[labelCls, 'mt-3']">모델</span>
        <div class="flex items-center gap-2 flex-wrap">
          <button :class="iconBtn" :disabled="loadingModels" v-tooltip="'모델 목록 새로고침'" @click="loadModels()">
            <Icon name="repeat" :size="15" :class="loadingModels ? 'opacity-40' : ''" />
          </button>

          <div v-if="models.length && !manualModel" class="relative flex-1 min-w-40">
            <select v-model="draft.model" :class="[inputCls, selectCls]" @change="rememberModel(draft.provider, draft.model)">
              <option v-for="one in modelChoices" :key="one.id" :value="one.id" :class="optionCls">{{ one.label }}</option>
            </select>
            <svg :class="arrowCls" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
          </div>
          <input v-else v-model="draft.model" placeholder="모델 이름" :class="[inputCls, 'flex-1 min-w-40']" @change="rememberModel(draft.provider, draft.model)" />

          <label class="flex items-center gap-2 cursor-pointer shrink-0" v-tooltip="models.length ? '' : '목록을 못 받았으면 직접 적어야 합니다'">
            <input v-model="manualModel" type="checkbox" class="size-4 accent-accent shrink-0" :disabled="!models.length" />
            <span class="text-[0.82rem]" :class="models.length ? '' : 'text-muted'">직접 입력하기</span>
          </label>
        </div>

        <div v-if="models.length || hideModels.length" class="mt-3">
          <button type="button" class="w-full flex items-center justify-between text-left py-1.5 cursor-pointer group" @click="showHide = !showHide">
            <span class="text-[0.8rem] text-muted group-hover:text-fg-soft transition-colors"
              >모델 목록에서 가릴 것<span v-if="hideModels.length" class="ml-1.5 text-muted/70">{{ hideModels.length }}</span></span
            >
            <svg class="text-muted transition-transform duration-200" :class="showHide ? 'rotate-180' : ''" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
          </button>
          <div v-if="showHide" class="pt-1 pb-1">
            <p class="text-muted text-[0.78rem] mb-2">받아 온 목록에서 제외합니다. <code class="text-fg-soft">*</code> 만 와일드카드 패턴으로 판정하며 대소문자를 가리지 않습니다. 영상·이미지 모델이나 구식 모델을 제외하는 용도입니다.</p>
            <ChipInput v-model="hideModels" lowercase placeholder="*sora* 처럼 적고 Enter" />
          </div>
        </div>

        <!-- 버텍스는 주소를 이 둘로 조립한다. 모델까지 정해야 주소가 완성되므로 아래에 둔다. -->
        <div v-if="spec?.needsProject" class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <label class="block">
            <span :class="labelCls" v-tooltip="'global 도 됩니다. 공개된 값이라 주소에 그대로 보입니다'">리전</span>
            <input v-model="draft.location" placeholder="global" :class="inputCls" />
          </label>
          <label class="block">
            <span :class="labelCls" v-tooltip="'위 주소에서는 가려 둡니다'">프로젝트 ID</span>
            <input v-model="draft.project" placeholder="비우면 서비스 계정 JSON 의 project_id" :class="inputCls" />
          </label>
        </div>

        <!-- 키는 쓰기 전용이다. 값은 내려오지 않고 있는지 없는지만 온다. -->
        <template v-if="needsKey">
          <span :class="[labelCls, 'mt-3']">{{ spec?.serviceAccount ? "서비스 계정 JSON" : "API 키" }}</span>

          <!-- 서비스 계정은 JSON 덩어리다. 파일로 따로 두면 그 파일이 어디 있는지 또 관리해야 한다 —
               다른 키와 같은 자리에 같은 방식으로 둔다. -->
          <template v-if="spec?.serviceAccount">
            <textarea v-model="keyInput" rows="4" autocomplete="off" :placeholder="keyPlaceholder" :class="[inputCls, 'font-mono text-[0.75rem] leading-relaxed resize-y']"></textarea>
            <div class="flex items-center gap-2 mt-2">
              <BaseButton :disabled="!keyInput.trim() || savingKey" @click="saveKey">{{ savingKey ? "저장 중…" : "저장" }}</BaseButton>
              <button v-if="hasKey" :class="iconBtn" :disabled="savingKey" v-tooltip="'저장된 값 지우기'" @click="clearKey"><Icon name="trash" :size="15" /></button>
              <span v-if="keyInput.trim() && !looksLikeAccount" class="text-[0.78rem] text-[#fbbf24]">client_email 과 private_key 가 있는 JSON 이어야 합니다.</span>
            </div>
          </template>

          <div v-else class="flex items-center gap-2">
            <input v-model="keyInput" type="password" autocomplete="off" :placeholder="keyPlaceholder" :class="[inputCls, 'flex-1']" />
            <BaseButton :disabled="!keyInput.trim() || savingKey" @click="saveKey">{{ savingKey ? "저장 중…" : "저장" }}</BaseButton>
            <button v-if="hasKey" :class="iconBtn" :disabled="savingKey" v-tooltip="'저장된 키 지우기'" @click="clearKey"><Icon name="trash" :size="15" /></button>
          </div>

          <p class="mt-1.5 text-[0.78rem]">
            <span :class="keyCls">{{ hasKey ? "저장됨" : "저장된 값 없음" }}</span>
            <span v-if="spec?.serviceAccount" class="text-muted"> · 받은 JSON 을 그대로 붙여넣으세요. 프로젝트를 비우면 그 안의 project_id 를 씁니다.</span>
            <span v-else class="text-muted"> · 보안을 위해 저장된 값은 출력하지 않습니다. 확인을 원하면 설정 파일을 직접 열어 주세요.</span>
          </p>
          <p v-if="!secureOrigin" class="mt-1 text-[0.78rem] text-[#fbbf24]">지금 평문(HTTP)으로 접속 중입니다. 키가 그대로 네트워크를 지나갑니다.</p>
        </template>

        <p v-if="staleCustomUrl" class="mt-3 text-[0.78rem] text-[#fbbf24]">주소를 고쳤지만 아직 저장하지 않았습니다. 저장 전에는 키를 붙이지 않고 보냅니다.</p>

        <p class="text-muted text-[0.78rem] mt-4 mb-2">무료 테스트는 현재 API 키와 URL로 모델 목록·토큰 수 확인 API만 호출하며, 유료 테스트는 짧은 질문을 실제로 전송합니다.</p>
        <div class="flex items-center gap-2.5 flex-wrap">
          <BaseButton variant="ghost" :disabled="loadingModels" @click="loadModels()">{{ loadingModels ? "확인 중…" : "무료 테스트" }}</BaseButton>
          <BaseButton variant="warning" :disabled="pinging" @click="askPaid('ping')">{{ pinging ? "보내는 중…" : "유료 테스트" }}</BaseButton>
        </div>

        <!-- 둘 다 테스트 결과다. 나눠 둘 이유가 없어 한 자리에 쓴다. -->
        <template v-if="tested">
          <p class="mt-3 text-[0.82rem]" :class="tested.ok ? 'text-[#4ade80]' : 'text-[#f87171]'">
            <span class="font-semibold">{{ tested.kind }}</span>
            · {{ tested.status ? `HTTP ${tested.status}` : "보내지 못함" }} · {{ tested.tookMs }}ms
            <span v-if="tested.extra" class="text-muted">· {{ tested.extra }}</span>
          </p>
          <p v-if="tested.reason && !tested.status" class="mt-1 text-[0.82rem] text-[#f87171]">{{ tested.reason }}</p>
          <pre v-if="tested.body" :class="[preCls, 'mt-2']">{{ tested.body }}</pre>
          <button v-if="tested.raw && tested.raw !== tested.body" :class="[addLine, 'mt-2']" @click="showRaw = !showRaw">{{ showRaw ? "원문 접기" : "원문 보기" }}</button>
          <pre v-if="showRaw && tested.raw" :class="[preCls, 'mt-1']">{{ tested.raw }}</pre>
        </template>
      </template>
    </BaseCard>

    <template v-if="on">
      <BaseCard icon="gear" title="모델 설정" class="mb-3">
        <div v-if="fieldInfo.fields.length" class="flex items-baseline justify-between mb-3">
          <span :class="labelCls + ' mb-0'">{{ modelName || draft.model }}</span>
          <span class="flex items-baseline gap-3">
            <button type="button" class="text-[0.78rem] text-muted hover:text-fg-soft" :disabled="refreshing" v-tooltip="'모델 정보를 다시 받습니다'" @click="refreshModels">{{ refreshing ? "받는 중…" : refreshNote || "모델 정보 갱신" }}</button>
            <button type="button" class="text-[0.78rem] text-accent hover:underline" @click="showAdvanced = !showAdvanced">{{ showAdvanced ? "기본만 보기" : "고급까지 보기" }}</button>
          </span>
        </div>

        <div v-if="paramGroups.length">
          <div v-for="group in paramGroups" :key="group.id" class="mb-4 last:mb-0">
            <span class="text-[0.78rem] text-fg-soft font-medium">{{ group.label }}</span>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mt-1.5">
              <label v-for="field in group.fields" :key="field.key" class="block">
                <span class="text-[0.78rem] text-muted block mb-1.5" v-tooltip="hintOf(field)">{{ field.label || field.key }}</span>

                <div v-if="field.enum" class="relative">
                  <select v-model="params[field.key]" :class="[inputCls, selectCls]">
                    <option value="" :class="optionCls">{{ field.default ? `기본값 (${field.default})` : "기본값" }}</option>
                    <option v-for="opt in field.enum" :key="opt.value" :value="opt.value" :class="optionCls">{{ opt.label }}</option>
                  </select>
                  <svg :class="arrowCls" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
                </div>

                <label v-else-if="field.type === 'boolean'" class="flex items-center gap-2 cursor-pointer h-9">
                  <input v-model="params[field.key]" type="checkbox" class="size-4 accent-accent shrink-0" />
                  <span class="text-[0.82rem] text-muted">{{ params[field.key] ? "켬" : "끔" }}</span>
                </label>

                <NumberInput v-else-if="field.type === 'integer' || field.type === 'number'" v-model="params[field.key]" :decimal="field.type === 'number'" :negative="(field.min ?? 0) < 0" :placeholder="String(field.default ?? '')" :class="inputCls" />

                <ChipInput v-else-if="field.type === 'stringArray'" :model-value="params[field.key] || []" placeholder="적고 Enter" @update:model-value="(v) => (params[field.key] = v.length ? v : undefined)" />

                <template v-else-if="field.type === 'json'">
                  <textarea :value="jsonText[field.key] ?? (params[field.key] ? JSON.stringify(params[field.key], null, 2) : '')" rows="3" placeholder="{ }" :class="[inputCls, 'font-mono text-[0.78rem] resize-y']" @input="(e) => onJson(field.key, e.target.value)"></textarea>
                  <span v-if="jsonBad[field.key]" class="text-danger text-[0.75rem] mt-1 block">JSON 으로 읽지 못했습니다</span>
                </template>

                <input v-else v-model="params[field.key]" :placeholder="String(field.default ?? '')" :class="inputCls" />
              </label>
            </div>
          </div>

          <p v-if="paramLimits" class="text-muted text-[0.75rem]">{{ paramLimits }}</p>
        </div>

        <div class="mt-4">
          <span :class="labelCls">추가 파라미터</span>
          <p class="text-muted text-[0.78rem] mb-2">
            한 줄에 하나씩. <code class="text-fg-soft">key=value</code> / <code class="text-fg-soft">key=json::{...}</code> / <code class="text-fg-soft">header::Name=value</code> / <code class="text-fg-soft">key={{ NONE_MARK }}</code> 지원.
          </p>
          <textarea v-model="extraText" rows="4" :placeholder="EXTRA_SAMPLE" :class="[inputCls, 'font-mono text-[0.78rem] leading-relaxed resize-y']"></textarea>
        </div>
      </BaseCard>

      <BaseCard icon="list" title="후보 목록 형식" class="mb-3">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4 pb-4 border-b border-white/8">
          <label class="block">
            <span :class="labelCls" v-tooltip="'이 시간을 넘기면 포기하고 규칙으로 고릅니다'">타임아웃(초)</span>
            <NumberInput v-model="timeoutSec" :class="inputCls" />
          </label>
          <label class="block">
            <span :class="labelCls" v-tooltip="'곡마다 따로 물으면 느립니다'">리퀘스트당 판정을 맡길 곡 수</span>
            <NumberInput v-model="draft.batchSize" :class="inputCls" />
          </label>
          <label class="flex items-center gap-2 cursor-pointer self-end pb-2.5">
            <input v-model="draft.skipConfident" type="checkbox" class="size-4 accent-accent shrink-0" />
            <span class="text-[0.82rem]" v-tooltip="'채널 이름이나 길이가 일치하면 생략'">확신할 땐 생략</span>
          </label>
        </div>

        <p class="text-muted text-[0.82rem] mb-3">
          판정할 후보를 줄 마다 어떻게 적을지. 이 설정을 따라 아래 프롬프트의 <code class="text-fg-soft">{{ LIST_MARK }}</code> 자리에 곡 목록이 들어갑니다.
        </p>

        <label class="block mb-2">
          <span :class="labelCls">줄 형식</span>
          <input v-model="listCfg.lineFormat" :placeholder="defaults.line" :class="[inputCls, 'font-mono text-[0.82rem]']" />
        </label>

        <div class="flex flex-wrap gap-1.5 mb-4">
          <button v-for="one in MARKS" :key="one.mark" type="button" :class="markBtn" v-tooltip="one.hint" @click="insertMark(one.mark)">{{ one.mark }}</button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block">
            <span :class="labelCls">길이를 모르는 후보</span>
            <div class="relative">
              <select v-model="listCfg.unknownDuration" :class="[inputCls, selectCls]">
                <option v-for="one in UNKNOWN" :key="one.value" :value="one.value" :class="optionCls">{{ one.label }}</option>
              </select>
              <svg :class="arrowCls" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
            </div>
          </label>
          <label v-if="listCfg.unknownDuration === 'text'" class="block">
            <span :class="labelCls">대신 적을 글자</span>
            <input v-model="listCfg.unknownText" placeholder="모름" :class="inputCls" />
          </label>
        </div>
        <p class="text-muted text-[0.78rem] mt-2">{{ UNKNOWN.find((u) => u.value === listCfg.unknownDuration)?.hint }}</p>

        <p class="text-muted text-[0.78rem] mt-3">업로더 이름은 넣을 수 없습니다. 실험 결과, Vevo나 Radio Mix 등의 명칭으로 인해 판정 정답률이 오히려 하락하여 제외하였습니다.</p>
      </BaseCard>

      <BaseCard class="mb-3">
        <div class="flex items-start gap-3 mb-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] mb-2">
              <Icon name="terminal" :size="15" />
              <span>판정 프롬프트 ({{ sections.length }})</span>
              <span v-if="tokenTotal != null" class="normal-case tracking-normal font-normal text-muted" v-tooltip="tokenExact ? '' : '추산치'">{{ tokenTotal.toLocaleString("ko-KR") }} 토큰</span>
            </div>
            <p class="text-muted text-[0.82rem]">섹션마다 역할을 정해 적은 차례대로 보냅니다. 답은 반드시 <code class="text-fg-soft">[{"n":1,"song":true,"fits":false}]</code> 꼴의 JSON 배열이어야 합니다.</p>
          </div>
          <button :class="addBtn" v-tooltip="'섹션 추가'" @click="addSection"><Icon name="add" :size="18" /></button>
        </div>

        <p v-if="!sections.length" class="text-muted text-[0.82rem] mb-3">비어 있어 기본 프롬프트를 씁니다.</p>
        <p v-else-if="!hasListMark" class="text-[0.82rem] text-[#f87171] mb-3">
          어느 섹션에도 <code class="text-fg-soft">{{ LIST_MARK }}</code> 이 없습니다.
        </p>

        <div
          v-for="(section, i) in sections"
          :key="section.key"
          class="border border-white/8 rounded-xl p-3 mb-2.5 bg-white/3 transition-[border-color,opacity] duration-150"
          :class="{
            'opacity-35': draggedIndex === i,
            'border-t-2 border-t-accent': dragOverIndex === i && draggedIndex !== i,
            'border-b-2 border-b-accent': dragOverIndex === sections.length && i === sections.length - 1,
          }"
          :draggable="dragReady"
          @dragstart="onDragStart($event, i)"
          @dragover="onDragOver($event, i)"
          @drop="onDrop"
          @dragend="onDragEnd"
        >
          <div class="flex items-center gap-2">
            <span class="text-muted cursor-grab active:cursor-grabbing opacity-35 hover:opacity-75 shrink-0 flex items-center px-0.5 transition-opacity duration-150 select-none" v-tooltip="'드래그하여 순서 변경'" @mousedown="armDrag">
              <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                <circle cx="2" cy="3" r="1.5" />
                <circle cx="2" cy="8" r="1.5" />
                <circle cx="2" cy="13" r="1.5" />
                <circle cx="8" cy="3" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="8" cy="13" r="1.5" />
              </svg>
            </span>

            <button :class="foldBtn" v-tooltip="isFolded(promptFoldId(i)) ? '펼치기' : '접기'" @click="toggleFold(promptFoldId(i))">
              <svg width="11" height="7" viewBox="0 0 9 6" fill="currentColor" class="transition-transform duration-150" :class="{ '-rotate-90': isFolded(promptFoldId(i)) }"><path d="M0 0h9L4.5 6z" /></svg>
            </button>

            <input v-model="section.name" :placeholder="`섹션 ${i + 1}`" :class="[inputCls, 'flex-1']" v-tooltip="'대시보드에서만 쓰이며, 전송되지 않습니다.'" />
            <span class="text-muted text-[0.75rem] shrink-0 w-12 text-right">{{ section.role }}</span>

            <button :class="removeBtn" v-tooltip="'이 섹션 삭제'" @click="removeSection(i)"><Icon name="trash" :size="15" /></button>
          </div>

          <div v-show="!isFolded(promptFoldId(i))" class="mt-2">
            <label class="block mb-2">
              <span :class="labelCls">역할</span>
              <div class="relative">
                <select v-model="section.role" :class="[inputCls, selectCls]">
                  <option v-for="one in ROLES" :key="one" :value="one" :class="optionCls">{{ one }}</option>
                </select>
                <svg :class="arrowCls" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
              </div>
            </label>

            <div class="flex items-baseline justify-between">
              <span :class="labelCls">프롬프트</span>
              <span v-if="tokenEach[i] != null" class="text-muted text-[0.75rem]" v-tooltip="tokenExact ? '' : '추산치'">{{ tokenEach[i].toLocaleString("ko-KR") }} 토큰</span>
            </div>
            <textarea v-model="section.text" rows="8" :class="[inputCls, 'font-mono text-[0.78rem] leading-relaxed resize-y']"></textarea>
          </div>
        </div>

        <div class="flex items-center gap-2.5 flex-wrap">
          <button :class="addLine" @click="loadDefaults">기본값으로</button>
          <div class="flex items-center gap-2.5 flex-wrap ml-auto">
            <BaseButton @click="openPreview">리퀘스트 미리보기</BaseButton>
          </div>
        </div>
      </BaseCard>

      <!--
        판정 테스트 — 보기 곡이 아니라 진짜 곡으로 시험한다.
        링크 조회는 아무것도 보내지 않는다. 판정 요청만 실제로 보낸다.
      -->
      <BaseCard icon="check" title="판정 테스트" class="mb-3">
        <div class="flex flex-col md:flex-row gap-3 items-start">
          <label class="block flex-1 min-w-0 w-full">
            <span :class="labelCls">유튜브 주소</span>
            <textarea v-model="judgeUrls" rows="3" wrap="off" placeholder="https://www.youtube.com/watch?v=... (한 줄에 하나)" :class="[inputCls, 'font-mono text-[0.8rem] leading-relaxed resize-y']"></textarea>
          </label>

          <div class="w-full md:w-60 lg:w-72 xl:w-88 shrink-0">
            <label class="block">
              <span :class="labelCls">장르</span>
              <input v-model="judgeGenre" placeholder="록" :class="inputCls" />
            </label>
            <div class="grid grid-cols-2 gap-2 mt-3">
              <BaseButton variant="ghost" class="w-full justify-center" :disabled="judging || !judgeUrls.trim()" @click="lookupJudge">{{ judging ? "조회 중…" : "링크 조회" }}</BaseButton>
              <BaseButton variant="warning" class="w-full justify-center" :disabled="judging" @click="askPaid('judge')">{{ judging ? "보내는 중…" : "판정 요청" }}</BaseButton>
            </div>
          </div>
        </div>

        <p v-if="judgeStale" class="text-[0.78rem] text-[#f87171] mt-2">작성한 주소를 아직 조회하지 않았습니다. 그대로 전송하면 예제 프리셋을 이용합니다.</p>

        <p v-if="judgeError" class="text-danger text-[0.78rem] mt-2">{{ judgeError }}</p>

        <div v-if="judgeCands.length" class="mt-3">
          <div class="flex items-baseline justify-between mb-1.5">
            <span :class="labelCls + ' mb-0'">모델에게 갈 목록</span>
            <button type="button" :class="copyBtn" @click="copy(judgeList.join(String.fromCharCode(10)))">복사</button>
          </div>
          <div v-for="(cand, i) in judgeCands" :key="cand.url" class="flex items-start gap-2 py-1.5 border-b border-white/6 last:border-0">
            <span v-if="judgeVerdicts" class="shrink-0 text-[0.78rem] mt-0.5 w-16" :class="verdictOk(judgeVerdicts[i]) ? 'text-[#4ade80]' : 'text-[#f87171]'">{{ verdictText(judgeVerdicts[i]) }}</span>
            <div class="min-w-0 flex-1">
              <p v-if="cand.error" class="text-danger text-[0.78rem] break-all">{{ cand.url }} — {{ cand.error }}</p>
              <p v-else class="font-mono text-[0.75rem] text-fg-soft break-all">{{ lineFor(cand) }}</p>
            </div>
          </div>
        </div>

        <template v-if="judgeSent">
          <button type="button" class="text-[0.78rem] text-muted hover:text-fg-soft cursor-pointer mt-3" @click="showJudgeRaw = !showJudgeRaw">
            {{ showJudgeRaw ? "리퀘스트 로그 접기" : "리퀘스트 로그 보기" }}
          </button>
          <div v-if="showJudgeRaw" class="mt-2">
            <div v-for="box in judgeBoxes" :key="box.title" class="mb-3">
              <div class="flex items-baseline justify-between mb-1">
                <span class="text-[0.75rem] font-semibold text-[rgba(196,181,253,0.8)]">{{ box.title }}</span>
                <button type="button" :class="copyBtn" @click="copy(box.text)">복사</button>
              </div>
              <pre :class="preCls">{{ box.text }}</pre>
            </div>
          </div>
        </template>
      </BaseCard>
    </template>

    <div v-if="problems.length" class="mt-3 text-[0.82rem] text-[#f87171]">
      <div v-for="p in problems" :key="p">· {{ p }}</div>
    </div>
    <p v-if="savedAt" class="mt-3 text-muted text-[0.8rem]">저장 완료. 다음 자동재생부터 반영됩니다</p>
    <p v-if="loadError" class="mt-3 text-[0.82rem] text-[#f87171]">{{ loadError }}</p>

    <SaveDock :dirty="dirty" :saving="saving" :blocked="problems.length > 0" @save="save" @revert="revert" />

    <!-- 유료 확인 — 보안이 아니라 돈 때문이다. 실수로 눌러 토큰을 태우는 것을 막는다. -->
    <div v-if="paid" class="fixed inset-0 bg-black/65 backdrop-blur-[6px] flex items-center justify-center z-200 p-4" @click.self="paid = null">
      <!-- 주소가 길면 늘어나고 짧으면 줄어든다. 다만 너무 좁아지지는 않게 바닥을 둔다. -->
      <div class="bg-[rgba(12,16,36,0.88)] backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/12 rounded-[20px] p-8 w-fit min-w-[min(26rem,90vw)] max-w-[min(60rem,92vw)] shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <p class="mb-2 text-[0.95rem] text-fg-soft">실제로 보냅니다. 토큰이 듭니다.</p>
        <dl class="mb-5 text-[0.82rem] grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt class="text-muted">보낼 곳</dt>
          <dd class="font-mono break-all">{{ spec?.editable ? draft.baseUrl : spec?.baseUrl }}</dd>
          <dt class="text-muted">모델</dt>
          <dd class="font-mono break-all">{{ draft.model || "(비어 있음)" }}</dd>
          <dt class="text-muted">보낼 것</dt>
          <dd v-if="paid === 'ping'">한 문장으로 인사하고 17 + 25 의 값을 알려 주세요.</dd>
          <dd v-else>판정 프롬프트 전체 (섹션 {{ sections.length || "기본" }}개 · {{ judgeUsable.length ? `고른 곡 ${judgeUsable.length}개` : "보기 곡 3개" }})</dd>
        </dl>
        <div class="flex gap-2.5 justify-end">
          <BaseButton variant="ghost" @click="paid = null">그만두기</BaseButton>
          <BaseButton variant="secondary" @click="runPaid">보내기</BaseButton>
        </div>
      </div>
    </div>

    <!-- 나간 것과 온 것을 그대로 본다. 다듬지 않는다. -->
    <div v-if="shown" class="fixed inset-0 bg-black/65 backdrop-blur-[6px] flex items-center justify-center z-200 p-4" @click.self="shown = null">
      <div class="bg-[rgba(12,16,36,0.92)] backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/12 rounded-[20px] w-[min(56rem,100%)] max-h-[88vh] overflow-auto p-6 shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div class="flex items-center gap-3 mb-4">
          <div class="text-2xl font-semibold flex-1">{{ shown.sent ? "테스트" : "리퀘스트 미리보기" }}</div>
          <span v-if="shown.sent" class="text-[0.8rem]" :class="shown.status && shown.status < 400 ? 'text-[#4ade80]' : 'text-[#f87171]'"> {{ shown.status ? `HTTP ${shown.status}` : "보내지 못함" }} · {{ (shown.tookMs / 1000).toFixed(1) }}초 </span>
          <span v-else class="text-muted text-[0.8rem]">보내지 않았습니다</span>
          <span v-if="shown.usage" class="text-muted text-[0.8rem]" v-tooltip="'저쪽이 알려 준 값입니다'">
            입력 {{ shown.usage.input.toLocaleString("ko-KR") }}
            <template v-if="shown.usage.output != null"> · 출력 {{ shown.usage.output.toLocaleString("ko-KR") }}</template>
            <template v-if="shown.usage.thoughts"> · 사고 {{ shown.usage.thoughts.toLocaleString("ko-KR") }}</template>
          </span>
          <span v-else-if="shown.tokens" class="text-muted text-[0.8rem]" v-tooltip="shown.tokens.exact ? '' : '추산치'">{{ shown.tokens.total.toLocaleString("ko-KR") }} 토큰</span>
          <button :class="removeBtn" v-tooltip="'닫기'" @click="shown = null"><Icon name="close" :size="15" /></button>
        </div>

        <div v-for="(part, i) in shownSections" :key="i" class="mb-3">
          <div class="flex items-baseline justify-between mb-1">
            <span class="text-[0.95rem] font-semibold text-[rgba(196,181,253,0.9)]">{{ part.name }}</span>
            <span class="flex items-baseline gap-3">
              <span class="text-[0.72rem] text-muted font-mono">{{ part.role }}</span>
              <button type="button" :class="copyBtn" @click="copy(part.text)">복사</button>
            </span>
          </div>
          <pre :class="preCls">{{ part.text }}</pre>
        </div>

        <button type="button" class="text-[0.78rem] text-muted hover:text-fg-soft cursor-pointer mt-1" @click="showRawRequest = !showRawRequest">
          {{ showRawRequest ? "날것 접기" : "날것 보기 (URL · 헤더 · 본문)" }}
        </button>
        <div v-if="showRawRequest" class="mt-2">
          <div v-for="box in boxes" :key="box.title" class="mb-3">
            <div class="flex items-baseline justify-between mb-1">
              <span class="text-[0.75rem] font-semibold text-[rgba(196,181,253,0.8)]">{{ box.title }}</span>
              <button type="button" :class="copyBtn" @click="copy(box.text)">복사</button>
            </div>
            <pre :class="preCls">{{ box.text }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import axios from "axios";
import BaseCard from "./BaseCard.vue";
import BaseButton from "./BaseButton.vue";
import Icon from "./BaseIcon.vue";
import NumberInput from "./NumberInput.vue";
import ChipInput from "./ChipInput.vue";
import SaveDock from "./SaveDock.vue";
import { isFolded, toggleFold, promptFoldId } from "../composables/configFolds";

const inputCls = "w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2 text-[0.9rem] outline-none font-[inherit] [color-scheme:dark] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7";
const selectCls = "appearance-none cursor-pointer pr-9!";
const arrowCls = "absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted";
const optionCls = "bg-[#141833] text-[#e7e9f3]";
const labelCls = "block text-[0.8rem] text-muted mb-1.5";
const preCls = "bg-black/30 border border-white/8 rounded-xl p-3 text-[0.75rem] leading-relaxed font-mono whitespace-pre-wrap break-words max-h-72 overflow-auto text-fg-soft";
const removeBtn = "h-[38px] w-[38px] rounded-xl border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color,border-color] duration-150 hover:bg-danger/15 hover:text-danger hover:border-danger/30";
const foldBtn = "size-7 mb-0.5 rounded-lg text-muted cursor-pointer flex items-center justify-center shrink-0 transition-colors duration-150 hover:text-fg hover:bg-white/8";
const addBtn = "size-9 rounded-xl border border-white/9 bg-white/5 text-fg-soft cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color] duration-150 hover:bg-white/10";
const addLine = "flex items-center gap-1.5 text-muted text-[0.82rem] px-2 py-1.5 rounded-lg cursor-pointer transition-colors duration-150 hover:text-fg-soft hover:bg-white/6";
const iconBtn = "h-[38px] w-[38px] rounded-xl border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color] duration-150 hover:bg-white/10 hover:text-fg disabled:opacity-35 disabled:cursor-not-allowed";
const markBtn = "px-2 py-1 rounded-md text-[0.75rem] font-mono border border-white/10 bg-white/4 text-muted cursor-pointer transition-colors duration-150 hover:bg-white/8 hover:text-fg";

// 템플릿에 그대로 적으면 Vue 가 보간으로 읽는다 — 값으로 둔다
const LIST_MARK = "{{목록}}";
const NONE_MARK = "{{none}}";
const EXTRA_SAMPLE = `think=false\nreasoning_effort=low\nresponse_format=json::{"type":"json_object"}\nheader::X-Title=Discord Musicbot\nmax_tokens=${NONE_MARK}`;

const ROLES = ["system", "user", "assistant"];

// 프로바이더 목록은 **서버가 준다**(주소·키 필요 여부까지). 화면이 베껴 두면 한쪽만 고치게 된다.

const MARKS = [
  { mark: "{{번호}}", hint: "1부터" },
  { mark: "{{장르}}", hint: "자동재생 장르 이름. 없으면 랜덤" },
  { mark: "{{제목}}", hint: "영상 제목 — 반드시 넣어야 합니다" },
  { mark: "{{길이분}}", hint: "길이(분)" },
  { mark: "{{길이초}}", hint: "길이(초)" },
];

const UNKNOWN = [
  { value: "hide", label: "그 칸을 뺀다", hint: '자리표시자가 든 낱말째 빠집니다. 기본 형식이면 "길이=3분"이 통째로 사라집니다.' },
  { value: "text", label: "글자로 적는다", hint: "형식이 일정해 모델이 자리를 헷갈리지 않습니다." },
  { value: "zero", label: "0으로 적는다", hint: "모르는 것을 0분이라고 알려 주는 셈이라 권하지 않습니다." },
];

const draft = ref({ provider: "off" });
// 모델이 받는 칸 — 서버가 프로필(data/ai-models.json)을 보고 알려 준다
const fieldInfo = ref({ known: false, fields: [], groups: [], models: [] });
const showAdvanced = ref(false);
const showHide = ref(false);
const refreshing = ref(false);
const refreshNote = ref("");

async function refreshModels() {
  refreshing.value = true;
  refreshNote.value = "";
  try {
    const { data } = await axios.post("/api/admin/ai/models/refresh");
    refreshNote.value = data.changed ? `모델 ${data.count}개로 갱신` : "이미 최신";
    if (data.changed) await loadFields();
  } catch (error) {
    refreshNote.value = error.response?.data?.error || "받지 못했습니다";
  } finally {
    refreshing.value = false;
    setTimeout(() => (refreshNote.value = ""), 4000);
  }
}
// 값은 모델별로 따로 든다 — 모델을 갈아타도 앞 모델에서 고른 값이 따라오지 않는다.
const allParams = ref({});
const params = ref({});
const jsonText = ref({});
// 토큰은 어림수다 — 어느 기준으로 셌는지 같이 밝힌다
const tokenEach = ref([]);
const tokenTotal = ref(null);
const tokenExact = ref(true);
let tokenTimer = null;
const jsonBad = ref({});

function onJson(key, text) {
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
const listCfg = ref({ lineFormat: "", unknownDuration: "hide", unknownText: "" });
const sections = ref([]);
const snapshot = ref("");
const promptSnapshot = ref("");
const saving = ref(false);
const savedAt = ref(null);
const loadError = ref("");
const serverProblems = ref([]);

const keyPresence = ref({});
const keyInput = ref("");
const savingKey = ref(false);
const paid = ref(null); // "ping" | "judge" — 확인 대화상자
const providers = ref([{ value: "off", label: "사용하지 않음" }]);
const pingText = ref("");
const loadingModels = ref(false);
// 프로바이더를 바꾸면 모델 칸이 빈다. **사람이 고른 것만** 브라우저에 적어 둔다 —
// 저절로 고른 첫 모델까지 적으면 "마지막에 고른 것"이 그것으로 덮인다.
// 접기 상태와 같은 화면 편의라 설정 파일에 넣지 않는다.
const PICK_KEY = "configAI.model.picked";
function rememberedModels() {
  try {
    return JSON.parse(localStorage.getItem(PICK_KEY) || "{}");
  } catch {
    return {};
  }
}
function rememberModel(provider, model) {
  if (!provider || provider === "off" || !model) return;
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify({ ...rememberedModels(), [provider]: model }));
  } catch {
    // 사생활 보호 모드처럼 못 쓰는 브라우저 — 기억을 못 할 뿐이다
  }
}

const models = ref([]);
// 프로필이 아는 모델은 보기 좋은 이름으로 보여준다. 모르는 것은 원본 ID 그대로 —
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
const tested = ref(null);
const showRaw = ref(false);
const shown = ref(null);
const defaults = ref({ sections: [], line: "" });

let serial = 0;

// 키는 프로바이더마다 따로다(config/ai-keys.yaml). 값은 안 내려오고 있는지 없는지만 온다.
const hasKey = computed(() => !!keyPresence.value[draft.value.provider]);
const keyCls = computed(() => (hasKey.value ? "text-[#4ade80]" : "text-muted"));
const spec = computed(() => providers.value.find((one) => one.value === draft.value.provider) || null);

// 로컬 · 클라우드 · 게이트웨이로 묶어 보여 준다. 묶음 없는 것("사용하지 않음")은 맨 위에.
const ungrouped = computed(() => providers.value.filter((one) => !one.group));
const grouped = computed(() => {
  const out = [];
  for (const one of providers.value.filter((x) => x.group)) {
    const found = out.find((g) => g.name === one.group);
    if (found) found.items.push(one);
    else out.push({ name: one.group, items: [one] });
  }
  return out;
});
const on = computed(() => !!draft.value.provider && draft.value.provider !== "off");
// 로컬 모델은 키를 안 받는다 — 있으나 마나 한 표시를 띄우지 않는다
const needsKey = computed(() => !!spec.value?.key);

/**
 * 어디로 나가는지 보여 준다. 버텍스는 주소가 없어 프로젝트·리전·모델로 조립한다.
 *
 * **프로젝트 ID 만 가린다.** 리전은 공개된 값이고, 가려 두면 정작 주소가 맞는지 못 본다.
 */
const shownEndpoint = computed(() => {
  if (!spec.value?.needsProject) return spec.value?.baseUrl;
  const location = String(draft.value.location || "").trim() || "global";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const model = String(draft.value.model || "").trim() || "{모델}";
  return `https://${host}/v1/projects/[프로젝트 ID]/locations/${location}/publishers/google/models/${model}:generateContent`;
});
const keyPlaceholder = computed(() => {
  if (spec.value?.serviceAccount) return hasKey.value ? "저장돼 있습니다. 바꾸려면 새 JSON 을 붙여넣으세요" : '{\n  "type": "service_account",\n  "project_id": "…",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n…",\n  "client_email": "…@….iam.gserviceaccount.com"\n}';
  return hasKey.value ? "저장 되어 있습니다. 새로 저장하여 수정할 수 있습니다." : "키를 입력하세요";
});

// 붙여넣기 전에 알려 준다 — 엉뚱한 것을 저장해 두고 나중에 401 만 보는 것보다 낫다
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
// 평문으로 열어 두었으면 키가 그대로 네트워크를 지난다 — 파일을 고칠 때는 없는 일이다
const secureOrigin = computed(() => window.isSecureContext);
// custom 은 저장된 주소와 같을 때만 키가 붙는다(autoplayAssist.authOf).
// **ref 를 computed 보다 먼저 선언한다** — 아래에 두면 TDZ 이고, Vue 가 그 예외를 삼켜
// 화면만 조용히 비는 종류의 버그가 된다(SourceEditor 에서 한 번 당했다).
const savedBaseUrl = ref("");
const staleCustomUrl = computed(() => !!spec.value?.editable && String(draft.value.baseUrl || "") !== savedBaseUrl.value);
const hasListMark = computed(() => sections.value.some((one) => /\{\{\s*목록\s*\}\}/.test(one.text)));

// 다듬지 않는다 — 무엇이 나갔고 무엇이 왔는지 그대로 봐야 한다.
// 응답 칸은 실제로 보냈을 때만 있다(미리보기는 만들기만 한다).
// 보낼 글을 섹션별로 — 규격에 따라 본문 모양이 달라 JSON 으로는 읽기 어렵다.
// 이름은 프롬프트 칸에 적어 둔 것을 쓴다.
const shownSections = computed(() =>
  (shown.value?.messages || []).map((one, i) => ({
    name: sections.value[i]?.name || `섹션 ${i + 1}`,
    role: one.role,
    text: one.content,
  })),
);

// 날것 그대로도 볼 수 있게 남겨 둔다(접어 둔다)
const boxes = computed(() => {
  const one = shown.value;
  if (!one) return [];
  return [{ title: "URL", text: one.url }, { title: "요청 헤더", text: JSON.stringify(one.headers, null, 2) }, { title: "요청 본문", text: JSON.stringify(one.body, null, 2) }, ...(one.sent ? [{ title: "응답", text: one.response || "(비어 있음)" }] : [])];
});
const showRawRequest = ref(false);

const hideModels = computed({
  get: () => draft.value.hideModels || [],
  set: (v) => {
    draft.value.hideModels = v;
  },
});

// 추가 파라미터는 한 줄에 하나씩 적는 글이다 — 뜯어 읽는 것은 서버가 한다(autoplayAssist)
const extraText = computed({
  get: () => draft.value.extra || "",
  set: (v) => {
    draft.value.extra = v;
  },
});

// 파일은 밀리초로 적히지만 사람에게는 초가 낫다
const timeoutSec = computed({
  get: () => (draft.value.timeoutMs == null ? null : Math.round(draft.value.timeoutMs / 1000)),
  set: (v) => {
    draft.value.timeoutMs = v == null ? null : v * 1000;
  },
});

// 설정과 프롬프트는 딴 파일이라 저장도 따로 간다.
// 섹션 이름은 ChatML 에 적을 자리가 없어 설정 쪽에 같이 실어 보낸다(차례가 곧 짝이다).
// 고른 모델의 이름표. 프로필이 알면 보기 좋은 이름이 있다.
const modelName = computed(() => fieldInfo.value.models.find((m) => m.modelId === draft.value.model)?.name || "");

// 값을 자르지는 않는다 — 다만 얼마까지 받는다고 적혀 있는지는 보여 준다
function hintOf(field) {
  const lo = field.min;
  const hi = field.max;
  if (lo === undefined && hi === undefined) return field.path;
  const range = lo !== undefined && hi !== undefined ? `${lo}~${hi}` : lo !== undefined ? `${lo} 이상` : `${hi} 이하`;
  return `${field.path} · ${range}`;
}

const paramGroups = computed(() => {
  const all = fieldInfo.value.fields.filter((f) => (showAdvanced.value || f.visibility !== "advanced") && showIfOk(f));
  const known = fieldInfo.value.groups || [];
  const by = new Map();
  for (const field of all) {
    const id = field.group || "generation";
    if (!by.has(id)) by.set(id, { id, label: known.find((g) => g.id === id)?.label || id, fields: [] });
    by.get(id).fields.push(field);
  }
  for (const group of by.values()) group.fields.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const order = (id) => known.findIndex((g) => g.id === id);
  return [...by.values()].sort((a, b) => (order(a.id) + 1 || 99) - (order(b.id) + 1 || 99));
});

// 저쪽이 "이 칸이 켜져 있을 때만 보여라"를 적어 둔다(logprobs → top_logprobs 처럼).
// 가려진 칸은 서버도 안 보낸다(autoplayAssist.withParams) — 판정 기준을 같게 둔다.
function showIfOk(field) {
  if (!field.showIf) return true;
  const owner = fieldInfo.value.fields.find((one) => one.key === field.showIf.key);
  const value = [params.value[field.showIf.key], owner?.default].find((one) => one !== undefined && one !== "");
  return value === field.showIf.equals;
}

const paramLimits = computed(() => {
  const m = fieldInfo.value.models.find((one) => one.modelId === draft.value.model);
  if (!m?.contextWindowTokens && !m?.maxOutputTokens) return "";
  const n = (x) => Number(x).toLocaleString("ko-KR");
  return [m.contextWindowTokens ? `컨텍스트 ${n(m.contextWindowTokens)}토큰` : "", m.maxOutputTokens ? `최대 출력 ${n(m.maxOutputTokens)}토큰` : ""].filter(Boolean).join(" · ");
});

// 저장하면 서버가 **보낸 차례대로** 파일을 줄 세운다(configDataLoader.syncMap).
// config/ai.example.yaml 과 같은 차례로 보내야 새로 깐 파일이 뒤섞이지 않는다.
const KEY_ORDER = ["provider", "baseUrl", "location", "project", "timeoutMs", "batchSize", "skipConfident", "list", "model", "params", "extra", "hideModels", "promptNames"];

const payload = computed(() => {
  const all = { ...draft.value, params: cleanParams.value, list: { ...listCfg.value }, promptNames: sections.value.map((one) => one.name || "") };
  const out = {};
  for (const key of KEY_ORDER) if (key in all) out[key] = all[key];
  // 모르는 키는 뒤에 그대로 둔다 — 빠뜨리면 저장할 때 파일에서 지워진다
  for (const [key, value] of Object.entries(all)) if (!(key in out)) out[key] = value;
  return out;
});

// 빈 값은 "고르지 않음"이다(프로필 기본값으로 간다). 빈 모델 칸도 남기지 않는다.
const cleanParams = computed(() => {
  const out = {};
  for (const [model, values] of Object.entries(allParams.value)) {
    const kept = Object.fromEntries(Object.entries(values || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined));
    if (Object.keys(kept).length) out[model] = kept;
  }
  return out;
});
const promptPayload = computed(() => sections.value.map((one) => ({ role: one.role, text: one.text })));
const dirty = computed(() => JSON.stringify(payload.value) !== snapshot.value || JSON.stringify(promptPayload.value) !== promptSnapshot.value);

// 서버도 같은 것을 검사하지만, 저장 버튼을 누르기 전에 알려 주는 편이 낫다.
const problems = computed(() => {
  const found = [];
  const d = draft.value;

  if (d.provider && d.provider !== "off") {
    if (spec.value?.editable) {
      if (!String(d.baseUrl || "").trim()) found.push("엔드포인트 주소를 적어야 합니다.");
      else if (!/^https?:\/\//.test(String(d.baseUrl).trim())) found.push("엔드포인트 주소는 http:// 또는 https:// 로 시작해야 합니다.");
    }
    if (!String(d.model || "").trim()) found.push("모델 이름을 적어야 합니다.");
    if (sections.value.length && !hasListMark.value) found.push(`프롬프트 어딘가에 ${LIST_MARK} 이 있어야 합니다.`);
  }

  if (d.timeoutMs != null && !(Number(d.timeoutMs) >= 1000 && Number(d.timeoutMs) <= 600000)) found.push("타임아웃은 1~600초 사이여야 합니다.");
  if (d.batchSize != null && !(Number(d.batchSize) >= 1 && Number(d.batchSize) <= 50)) found.push("한 리퀘스트의 곡 수는 1~50 사이여야 합니다.");

  const line = String(listCfg.value.lineFormat || "").trim();
  if (line && !/\{\{\s*제목\s*\}\}/.test(line)) found.push("줄 형식에 {{제목}} 이 있어야 합니다.");
  if (sections.value.some((one) => !one.text.trim())) found.push("내용이 빈 섹션이 있습니다.");
  // ChatML 은 블록 안에 끝 표시가 또 나오면 파일이 깨진다
  if (sections.value.some((one) => /<\|im_(start|end)\|>/.test(one.text))) found.push("프롬프트에 <|im_start|>·<|im_end|> 를 적을 수 없습니다.");

  return [...found, ...serverProblems.value];
});

watch([payload, promptPayload], () => {
  savedAt.value = null;
  serverProblems.value = [];
});

function addSection() {
  sections.value.push({ key: ++serial, role: sections.value.length ? "user" : "system", name: "", text: "" });
}

// 접힘은 자리로 기억한다 — 지우면 그 아래가 한 칸씩 당겨진다
function removeSection(i) {
  sections.value.splice(i, 1);
  for (let at = i; at < sections.value.length + 1; at++) {
    if (isFolded(promptFoldId(at))) toggleFold(promptFoldId(at));
  }
}

function loadDefaults() {
  sections.value = defaults.value.sections.map((one) => ({ key: ++serial, role: one.role, name: "", text: one.text }));
}

// 자리표시자 알약 — 줄 형식 칸 끝에 붙인다
function insertMark(mark) {
  listCfg.value.lineFormat = `${listCfg.value.lineFormat || defaults.value.line}${mark}`;
}

// ── 순서 바꾸기 — 장르·상태 설정과 같은 방식 ───────────────────────────────
const draggedIndex = ref(null);
const dragOverIndex = ref(null);
// 카드를 늘 draggable로 두면 입력칸의 글자를 끌어 고를 수 없다 — 손잡이를 누르는 동안만 켠다
const dragReady = ref(false);

function armDrag() {
  dragReady.value = true;
  window.addEventListener("mouseup", () => (dragReady.value = false), { once: true });
}

function onDragStart(e, i) {
  // dragstart는 위로 퍼진다 — 카드 자신이 끌리기 시작한 것만 받는다
  if (e.target !== e.currentTarget) return;
  draggedIndex.value = i;
  e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e, i) {
  if (draggedIndex.value == null) return;
  e.preventDefault();
  const rect = e.currentTarget.getBoundingClientRect();
  dragOverIndex.value = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
}

function onDrop(e) {
  if (draggedIndex.value == null) return;
  e.preventDefault();
  const from = draggedIndex.value;
  const to = dragOverIndex.value;
  if (from != null && to != null) {
    const [moved] = sections.value.splice(from, 1);
    // 앞에서 빼면 뒤쪽 자리가 하나씩 당겨진다
    sections.value.splice(to > from ? to - 1 : to, 0, moved);
  }
  onDragEnd();
}

function onDragEnd() {
  dragReady.value = false;
  draggedIndex.value = null;
  dragOverIndex.value = null;
}

// ── 주고받기 ──────────────────────────────────────────────────────────────

// 이름은 설정 쪽에 있고 내용은 프롬프트 파일에 있다 — 둘을 차례로 짝지어 합친다
let names = [];

function apply(data) {
  const { list, prompt, promptNames, params: saved, ...rest } = data || {};
  draft.value = { provider: "off", extra: "", hideModels: [], location: "", project: "", ...rest };
  allParams.value = { ...(saved || {}) };
  // 설정에 저장돼 있는 모델도 사람이 고른 것이다 — 기동 직후에도 기억이 비지 않게 둔다
  rememberModel(draft.value.provider, draft.value.model);
  picking = draft.value.model || "";
  params.value = { ...(allParams.value[picking] || {}) };
  listCfg.value = { lineFormat: "", unknownDuration: "hide", unknownText: "", ...(list || {}) };
  names = Array.isArray(promptNames) ? promptNames : [];
  sections.value.forEach((one, i) => (one.name = names[i] || ""));
  savedBaseUrl.value = String(draft.value.baseUrl || ""); // 키를 붙일지 가르는 기준
  snapshot.value = JSON.stringify(payload.value);
}

function applyPrompt(list) {
  sections.value = (list || []).map((one, i) => ({ key: ++serial, role: one?.role || "system", name: names[i] || "", text: String(one?.text ?? "") }));
  promptSnapshot.value = JSON.stringify(promptPayload.value);
  snapshot.value = JSON.stringify(payload.value); // 이름이 payload 에 실리므로 같이 굳힌다
}

// 프로바이더나 모델이 바뀌면 받을 수 있는 칸도 달라진다.
watch(
  () => [draft.value.provider, draft.value.model],
  () => loadFields(),
  { immediate: true },
);

// 고른 값은 그때그때 모델 칸에 담는다
let picking = "";
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
  if (!sections.value.length) {
    tokenEach.value = [];
    tokenTotal.value = null;
    return;
  }
  try {
    const { data } = await axios.post("/api/admin/ai/tokens", {
      provider: draft.value.provider,
      model: draft.value.model,
      texts: sections.value.map((one) => one.text),
    });
    tokenEach.value = data.each;
    tokenTotal.value = data.total;
    tokenExact.value = data.exact;
  } catch {
    tokenEach.value = [];
    tokenTotal.value = null;
  }
}

// ── 판정 테스트 ────────────────────────────────────────────────────────────
// 보기 곡이 아니라 진짜 곡으로 시험한다. 링크 조회는 아무것도 보내지 않고,
// 판정 요청만 실제로 보낸다. 적어만 두고 조회를 안 했으면 보기 곡으로 나간다.
const NL = String.fromCharCode(10);
const judgeUrls = ref("");
const judgeGenre = ref("록");
const judging = ref(false);
const judgeError = ref("");
const judgeCands = ref([]);
const judgeList = ref([]);
const judgeVerdicts = ref(null);
const judgeSent = ref(null);
const showJudgeRaw = ref(false);
const judgeLookedUp = ref("");

const copyBtn = "text-[0.75rem] text-muted hover:text-fg-soft cursor-pointer";
function copy(text) {
  try {
    navigator.clipboard.writeText(String(text ?? ""));
  } catch {
    // 안전하지 않은 출처처럼 못 쓰는 자리 — 복사만 안 될 뿐이다
  }
}

// 적어 두고 조회를 안 눌렀으면 알려 준다 — 그대로 보내면 보기 곡으로 판정한다
const judgeStale = computed(() => !!judgeUrls.value.trim() && judgeUrls.value.trim() !== judgeLookedUp.value);
const rendered = (one) => !one.error && one.title;
const judgeUsable = computed(() => (judgeStale.value ? [] : judgeCands.value.filter(rendered)));

const judgeBoxes = computed(() => {
  const one = judgeSent.value;
  if (!one) return [];
  return [
    { title: "요청 본문", text: JSON.stringify(one.body, null, 2) },
    { title: "응답", text: one.response || "(비어 있음)" },
  ];
});

// 못 읽은 줄이 섞여 있어 후보 차례와 줄 차례가 어긋난다 — 멀쩡한 것만 세어 맞춘다
function lineFor(cand) {
  const at = judgeCands.value.filter(rendered).indexOf(cand);
  return judgeList.value[at] ?? "";
}
const verdictOk = (one) => one && one.song && one.fits;
const verdictText = (one) => (!one ? "?" : one.song && one.fits ? "통과" : !one.song ? "곡 아님" : "장르 다름");

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
    judgeCands.value = (await axios.post("/api/admin/ai/judge/lookup", { urls: judgeUrlList() })).data.candidates;
    judgeLookedUp.value = judgeUrls.value.trim();
  } catch (error) {
    judgeError.value = error.response?.data?.error || "조회하지 못했습니다.";
  } finally {
    judging.value = false;
  }
}

// 줄 그리기는 서버 몫이다 — 화면이 흉내 내면 실제로 나가는 줄과 어긋난다.
// 늦게 온 응답이 방금 그린 것을 덮지 않도록 차례를 센다.
let linesSeq = 0;
let linesTimer = null;
watch([judgeCands, judgeGenre, () => JSON.stringify(listCfg.value)], () => {
  clearTimeout(linesTimer);
  linesTimer = setTimeout(drawLines, 150);
});

async function drawLines() {
  const usable = judgeCands.value.filter(rendered);
  if (!usable.length) return (judgeList.value = []);
  const seq = ++linesSeq;
  try {
    const { data } = await axios.post("/api/admin/ai/judge/lines", { candidates: usable, list: listCfg.value, genre: judgeGenre.value });
    if (seq === linesSeq) judgeList.value = data.lines;
  } catch {
    if (seq === linesSeq) judgeList.value = [];
  }
}

async function runJudge() {
  judging.value = true;
  judgeError.value = "";
  try {
    const usable = judgeUsable.value; // 조회를 안 했으면 비어 있다 — 서버가 보기 곡으로 돌린다
    const { data } = await axios.post("/api/admin/ai/judge/run", { candidates: usable, genre: judgeGenre.value, data: payload.value });
    judgeSent.value = data;
    judgeVerdicts.value = usable.length ? judgeCands.value.map((cand) => (cand.error ? null : (data.verdicts?.[usable.indexOf(cand)] ?? null))) : null;
  } catch (error) {
    judgeError.value = error.response?.data?.error || "판정을 받지 못했습니다.";
  } finally {
    judging.value = false;
  }
}

async function loadFields() {
  const provider = draft.value.provider;
  const model = draft.value.model;
  if (!provider || provider === "off") {
    fieldInfo.value = { known: false, fields: [], groups: [], models: [] };
    return;
  }
  try {
    const { data } = await axios.get("/api/admin/ai/fields", { params: { provider, model: model || "" } });
    fieldInfo.value = data;
    if (model !== picking) {
      picking = model;
      params.value = { ...(allParams.value[model] || {}) };
      jsonText.value = {};
      jsonBad.value = {};
    }
  } catch {
    fieldInfo.value = { known: false, fields: [], groups: [], models: [] };
  }
}

async function fetchAll() {
  loadError.value = "";
  try {
    apply((await axios.get("/api/admin/config/ai")).data.data);
    applyPrompt((await axios.get("/api/admin/ai/prompt")).data.sections);
  } catch (error) {
    loadError.value = error.response?.data?.error || "설정을 읽지 못했습니다.";
  }
}

// 키 유무와 기본 프롬프트. 둘 다 서버가 들고 있다 —
// 화면이 프롬프트를 따로 베껴 두면 한쪽만 고치게 된다.
async function fetchState() {
  try {
    const state = (await axios.get("/api/admin/ai/state")).data;
    keyPresence.value = state.hasKey || {};
    if (state.providers?.length) providers.value = state.providers;
    pingText.value = state.pingText || "";
    defaults.value = { sections: state.defaultSections || [], line: state.defaultLine || "" };
  } catch {
    keyPresence.value = {};
  }
}

const forServer = () => ({ ...payload.value, prompt: promptPayload.value });

// 만들어만 본다. 아무 데도 안 나간다.
async function openPreview() {
  try {
    shown.value = { ...(await axios.post("/api/admin/ai/preview", { data: forServer() })).data, sent: false };
  } catch (error) {
    loadError.value = error.response?.data?.error || "미리보기를 만들지 못했습니다.";
  }
}

function onProvider() {
  models.value = [];
  tested.value = null;
  keyInput.value = "";
  manualModel.value = false;

  // baseUrl 은 custom 전용이다 — 다른 것을 골랐다고 적어 둔 주소를 지우지 않는다
  if (!on.value) return;
  loadModels({ quiet: true }); // 고르면 알아서 불러온다 — 무료라 누르게 할 이유가 없다
}

// 무료 — 추론을 안 돌린다. 연결 확인이자 모델 목록 불러오기다(같은 한 번의 호출이다).
// quiet: 프로바이더를 고를 때 저절로 도는 것이라 실패를 빨갛게 띄우지 않는다.
async function loadModels({ quiet = false } = {}) {
  loadingModels.value = true;
  showRaw.value = false;
  if (!quiet) tested.value = null;

  try {
    const got = (await axios.post("/api/admin/ai/models", { data: payload.value })).data;
    models.value = got.models || [];
    // 목록을 받았으면 고르는 칸으로 돌아간다. 못 받았을 때만 직접 적게 한다.
    manualModel.value = !models.value.length;
    // 지금 값이 이 프로바이더의 목록에 없으면 기억해 둔 것으로 되돌린다
    if (!models.value.includes(draft.value.model)) {
      const remembered = rememberedModels()[draft.value.provider];
      draft.value.model = models.value.includes(remembered) ? remembered : models.value[0] || "";
    }
    if (quiet && !got.ok) return;
    const hidden = got.hiddenCount ? `, ${got.hiddenCount}개 가림` : "";
    tested.value = {
      kind: "무료 테스트",
      ok: got.ok,
      status: got.status,
      tookMs: got.tookMs ?? 0,
      reason: got.reason,
      extra: got.ok ? `모델 ${models.value.length}개${hidden}` : "",
      body: got.ok ? "" : got.response,
      raw: got.response,
    };
  } catch (error) {
    if (!quiet) tested.value = { kind: "무료 테스트", ok: false, status: null, tookMs: 0, reason: error.response?.data?.error || "불러오지 못했습니다." };
  } finally {
    loadingModels.value = false;
  }
}

// 돈이 드는 것은 한 번 물어본다. 보안이 아니라 실수 방지다.
const askPaid = (which) => (paid.value = which);

function runPaid() {
  const which = paid.value;
  paid.value = null;
  if (which === "ping") runPing();
  else runJudge();
}

// 키는 쓰기 전용이다 — payload 에 안 싣는다(미리보기·테스트로 새어 나가면 안 된다)
async function putKey(value) {
  savingKey.value = true;
  try {
    keyPresence.value = (await axios.put("/api/admin/ai/keys", { keys: { [draft.value.provider]: value } })).data.hasKey || {};
    keyInput.value = "";
  } catch (error) {
    loadError.value = error.response?.data?.error || "키를 저장하지 못했습니다.";
  } finally {
    savingKey.value = false;
  }
}

/**
 * 서비스 계정은 JSON 덩어리다. 받은 그대로 붙여넣으면 들여쓰기가 제각각이라,
 * 저장 전에 한 모양으로 정리한다 — 파일에 블록 리터럴(`|-`)로 곱게 들어간다.
 */
function saveKey() {
  const text = keyInput.value.trim();
  if (!spec.value?.serviceAccount || !text.startsWith("{")) return putKey(text);
  try {
    return putKey(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    return putKey(text); // 못 읽으면 적힌 그대로 — 조용히 버리지 않는다
  }
}
const clearKey = () => putKey("");

// 유료 — 짧은 물음 하나를 실제로 생성시킨다(판정 프롬프트는 안 쓴다).
async function runPing() {
  pinging.value = true;
  tested.value = null;
  showRaw.value = false;
  try {
    const got = (await axios.post("/api/admin/ai/ping", { data: payload.value })).data;
    tested.value = {
      kind: "유료 테스트",
      ok: got.ok,
      status: got.status,
      tookMs: got.tookMs ?? 0,
      reason: got.reason,
      asked: pingText.value,
      body: got.answer || got.response,
      raw: got.response,
    };
  } catch (error) {
    tested.value = { kind: "유료 테스트", ok: false, status: null, tookMs: 0, reason: error.response?.data?.error || "보내지 못했습니다." };
  } finally {
    pinging.value = false;
  }
}

async function save() {
  saving.value = true;
  serverProblems.value = [];
  try {
    apply((await axios.put("/api/admin/config/ai", { data: payload.value })).data.data);
    applyPrompt((await axios.put("/api/admin/ai/prompt", { sections: promptPayload.value })).data.sections);
    savedAt.value = Date.now();
  } catch (error) {
    serverProblems.value = error.response?.data?.problems || [error.response?.data?.error || "저장하지 못했습니다."];
  } finally {
    saving.value = false;
  }
}

function revert() {
  apply(JSON.parse(snapshot.value));
  applyPrompt(JSON.parse(promptSnapshot.value));
}

onMounted(async () => {
  await fetchState();
  await fetchAll();
  // 켜져 있으면 열자마자 채워 둔다. 무료라 물어볼 것이 없다.
  if (on.value) loadModels({ quiet: true });
});
</script>
