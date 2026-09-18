<!--
  AI 보조 설정 (운영자 패널).

  설정은 config/ai.yaml, **프롬프트는 config/ai-prompt.chatml** 로 따로 산다.
  둘 다 파일로도 고칠 수 있다 — 대시보드는 선택 기능이다.

  **API 키는 여기서 다루지 않는다.** .env 에 있고, 화면에는 있는지 없는지만 내려온다 —
  값을 브라우저로 보내면 XSS 하나로 새어 나간다.

  미리보기는 **서버가 실제로 한 번 보낸다**. 봇이 쓰는 조립 코드를 그대로 부르므로,
  화면에 보이는 것과 실제로 나가는 것이 어긋날 수 없다.
-->
<template>
  <div>
    <BaseCard icon="wrench" title="자동재생 AI 보조" class="mb-3">
      <p class="text-muted text-[0.82rem] mt-1 mb-3">곡 이름만 아는 출처(키워드 · Last.fm)에서 고른 후보를 모델에게 한 번 더 물어봅니다. 1시간짜리 믹스나 장르가 다른 곡을 걸러냅니다. 주소를 직접 받아오는 출처는 묻지 않습니다.</p>

      <label class="flex items-center gap-2.5 mb-4 cursor-pointer w-fit">
        <input v-model="draft.enabled" type="checkbox" class="size-4 accent-accent shrink-0" />
        <span class="text-[0.9rem]">AI 보조 사용</span>
      </label>

      <p class="text-muted text-[0.78rem] mb-4 -mt-2">끄면 규칙만으로 고릅니다. 켜 두어도 모델을 못 부르면 규칙으로 넘어가므로 재생이 멈추지는 않습니다.</p>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <label class="block">
          <span :class="labelCls">엔드포인트 주소</span>
          <input v-model="draft.baseUrl" placeholder="http://127.0.0.1:11434/v1" :class="inputCls" />
        </label>
        <label class="block">
          <span :class="labelCls">모델 이름</span>
          <input v-model="draft.model" placeholder="gemma3n:e2b" :class="inputCls" />
        </label>
      </div>

      <p class="text-muted text-[0.78rem] mb-4">OpenAI 호환 주소면 무엇이든 됩니다. Ollama는 <code class="text-fg-soft">http://127.0.0.1:11434/v1</code>, LM Studio는 <code class="text-fg-soft">http://127.0.0.1:1234/v1</code> 입니다.</p>

      <div class="flex items-center gap-2.5 flex-wrap">
        <BaseButton :disabled="checking" @click="check">{{ checking ? "물어보는 중…" : "연결 확인" }}</BaseButton>
        <span class="text-[0.82rem]" :class="keyCls">API 키 {{ hasKey ? "있음" : "없음" }}</span>
        <span class="text-muted text-[0.78rem]">{{ hasKey ? ".env 의 AI_API_KEY" : "로컬 모델이면 없어도 됩니다" }}</span>
      </div>

      <p v-if="result" class="mt-3 text-[0.82rem]" :class="result.ok ? 'text-[#4ade80]' : 'text-[#f87171]'">
        {{ result.ok ? `정상입니다. 한 곡 판정에 ${(result.tookMs / 1000).toFixed(1)}초 걸렸습니다.` : `부르지 못했습니다 — ${result.reason}` }}
      </p>
      <p v-if="result?.ok && result.tookMs > 30000" class="mt-1 text-[0.78rem] text-[#fbbf24]">한 곡에 이만큼 걸리면 자동재생이 다음 곡을 늦게 준비합니다. 더 작은 모델을 쓰거나 확인 제한 시간을 넉넉히 두세요.</p>
    </BaseCard>

    <BaseCard icon="gear" title="세부 설정" class="mb-3">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label class="block">
          <span :class="labelCls" v-tooltip="'0이면 같은 질문에 같은 답을 합니다'">온도</span>
          <input v-model="temperatureText" inputmode="decimal" placeholder="0" :class="inputCls" />
        </label>
        <label class="block">
          <span :class="labelCls" v-tooltip="'이 시간을 넘기면 포기하고 규칙으로 고릅니다'">타임아웃(초)</span>
          <NumberInput v-model="timeoutSec" :class="inputCls" />
        </label>
        <label class="block">
          <span :class="labelCls" v-tooltip="'곡마다 따로 물으면 느립니다'">한 리퀘스트마다 판정을 맡길 곡 수</span>
          <NumberInput v-model="draft.batchSize" :class="inputCls" />
        </label>
        <label class="flex items-center gap-2 cursor-pointer self-end pb-2.5">
          <input v-model="draft.skipConfident" type="checkbox" class="size-4 accent-accent shrink-0" />
          <span class="text-[0.82rem]" v-tooltip="'채널 이름이나 길이가 일치하면 생략'">확신할 땐 생략</span>
        </label>
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
      <p class="text-muted text-[0.82rem] mb-3">
        판정할 후보를 한 줄에 어떻게 적을지. 이렇게 만든 줄들이 아래 프롬프트의 <code class="text-fg-soft">{{ LIST_MARK }}</code> 자리에 들어갑니다.
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

      <p class="text-muted text-[0.78rem] mt-3">업로더 이름은 넣을 수 없습니다. 넣어 봤더니 장르 판정이 94% → 88%로 떨어졌습니다 — 유튜브의 그 칸은 대개 진짜 아티스트가 아니라 채널 이름입니다(Vevo · Radio Mix).</p>
    </BaseCard>

    <BaseCard class="mb-3">
      <div class="flex items-start gap-3 mb-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] mb-2">
            <Icon name="terminal" :size="15" />
            <span>판정 프롬프트 ({{ sections.length }})</span>
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
        <div class="flex items-end gap-2">
          <span class="text-muted cursor-grab active:cursor-grabbing opacity-35 hover:opacity-75 shrink-0 flex items-center px-0.5 pb-2.5 transition-opacity duration-150 select-none" v-tooltip="'드래그하여 순서 변경'" @mousedown="armDrag">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
              <circle cx="2" cy="3" r="1.5" />
              <circle cx="2" cy="8" r="1.5" />
              <circle cx="2" cy="13" r="1.5" />
              <circle cx="8" cy="3" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="8" cy="13" r="1.5" />
            </svg>
          </span>

          <button :class="foldBtn" v-tooltip="folded.has(section.key) ? '펼치기' : '접기'" @click="toggleFold(section.key)">
            <svg width="11" height="7" viewBox="0 0 9 6" fill="currentColor" class="transition-transform duration-150" :class="{ '-rotate-90': folded.has(section.key) }"><path d="M0 0h9L4.5 6z" /></svg>
          </button>

          <label class="block w-32 shrink-0">
            <span :class="labelCls">역할</span>
            <div class="relative">
              <select v-model="section.role" :class="[inputCls, selectCls]">
                <option v-for="one in ROLES" :key="one" :value="one" :class="optionCls">{{ one }}</option>
              </select>
              <svg :class="arrowCls" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
            </div>
          </label>

          <span v-if="folded.has(section.key)" class="text-muted text-[0.78rem] flex-1 min-w-0 truncate pb-2.5">{{ oneLine(section.text) }}</span>
          <span v-else class="flex-1"></span>

          <button :class="removeBtn" v-tooltip="'이 섹션 삭제'" @click="sections.splice(i, 1)"><Icon name="trash" :size="15" /></button>
        </div>

        <div v-show="!folded.has(section.key)" class="mt-2">
          <span :class="labelCls">프롬프트</span>
          <textarea v-model="section.text" rows="8" :class="[inputCls, 'font-mono text-[0.78rem] leading-relaxed resize-y']"></textarea>
        </div>
      </div>

      <div class="flex items-center gap-2.5 flex-wrap">
        <button :class="addLine" @click="loadDefaults">기본값으로</button>
        <BaseButton :disabled="previewing" @click="loadPreview">{{ previewing ? "보내는 중…" : "리퀘스트 미리보기" }}</BaseButton>
      </div>
    </BaseCard>

    <div v-if="problems.length" class="mt-3 text-[0.82rem] text-[#f87171]">
      <div v-for="p in problems" :key="p">· {{ p }}</div>
    </div>
    <p v-if="savedAt" class="mt-3 text-muted text-[0.8rem]">저장 완료. 다음 자동재생부터 반영됩니다</p>
    <p v-if="loadError" class="mt-3 text-[0.82rem] text-[#f87171]">{{ loadError }}</p>

    <SaveDock :dirty="dirty" :saving="saving" :blocked="problems.length > 0" @save="save" @revert="revert" />

    <!-- 리퀘스트 미리보기 — 다듬지 않는다. 나간 것과 온 것을 그대로 본다. -->
    <div v-if="preview" class="fixed inset-0 bg-black/65 backdrop-blur-[6px] flex items-center justify-center z-200 p-4" @click.self="preview = null">
      <div class="bg-[rgba(12,16,36,0.92)] backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/12 rounded-[20px] w-[min(56rem,100%)] max-h-[88vh] overflow-auto p-6 shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div class="flex items-center gap-3 mb-4">
          <h3 class="text-[0.95rem] font-semibold flex-1">리퀘스트 미리보기</h3>
          <span v-if="preview.status" class="text-[0.8rem]" :class="preview.status < 400 ? 'text-[#4ade80]' : 'text-[#f87171]'">HTTP {{ preview.status }} · {{ (preview.tookMs / 1000).toFixed(1) }}초</span>
          <button :class="removeBtn" v-tooltip="'닫기'" @click="preview = null"><Icon name="close" :size="15" /></button>
        </div>

        <div v-for="box in previewBoxes" :key="box.title" class="mb-3">
          <div class="text-[0.75rem] font-semibold text-[rgba(196,181,253,0.8)] mb-1">{{ box.title }}</div>
          <pre :class="preCls">{{ box.text }}</pre>
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
import SaveDock from "./SaveDock.vue";

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
const markBtn = "px-2 py-1 rounded-md text-[0.75rem] font-mono border border-white/10 bg-white/4 text-muted cursor-pointer transition-colors duration-150 hover:bg-white/8 hover:text-fg";

// 템플릿에 그대로 적으면 Vue 가 보간으로 읽는다 — 값으로 둔다
const LIST_MARK = "{{목록}}";
const NONE_MARK = "{{none}}";
const EXTRA_SAMPLE = `think=false\nreasoning_effort=low\nresponse_format=json::{"type":"json_object"}\nheader::X-Title=Discord Musicbot\ntemperature=${NONE_MARK}`;

const ROLES = ["system", "user", "assistant"];

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

const draft = ref({ enabled: false });
const listCfg = ref({ lineFormat: "", unknownDuration: "hide", unknownText: "" });
const sections = ref([]);
const folded = ref(new Set());
const snapshot = ref("");
const promptSnapshot = ref("");
const saving = ref(false);
const savedAt = ref(null);
const loadError = ref("");
const serverProblems = ref([]);

const hasKey = ref(false);
const checking = ref(false);
const result = ref(null);
const previewing = ref(false);
const preview = ref(null);
const defaults = ref({ sections: [], line: "" });

let serial = 0;

const keyCls = computed(() => (hasKey.value ? "text-[#4ade80]" : "text-muted"));
const hasListMark = computed(() => sections.value.some((one) => /\{\{\s*목록\s*\}\}/.test(one.text)));

// 다듬지 않는다 — 무엇이 나갔고 무엇이 왔는지 그대로 봐야 한다
const previewBoxes = computed(() => {
  const one = preview.value;
  if (!one) return [];
  return [
    { title: "URL", text: one.url },
    { title: "요청 헤더", text: JSON.stringify(one.headers, null, 2) },
    { title: "요청 본문", text: JSON.stringify(one.body, null, 2) },
    { title: "응답", text: one.response || "(비어 있음)" },
  ];
});

const oneLine = (text) => String(text || "").split("\n")[0] || "(비어 있음)";

// 추가 파라미터는 한 줄에 하나씩 적는 글이다 — 뜯어 읽는 것은 서버가 한다(autoplayAssist)
const extraText = computed({
  get: () => draft.value.extra || "",
  set: (v) => {
    draft.value.extra = v;
  },
});

// 온도는 0.4 처럼 소수라 숫자 칸을 못 쓴다. 빈 칸과 0 을 가르려고 글자로 다룬다.
const temperatureText = computed({
  get: () => (draft.value.temperature == null ? "" : String(draft.value.temperature)),
  set: (v) => {
    const text = String(v).trim();
    draft.value.temperature = text === "" ? null : Number(text);
  },
});

// 파일은 밀리초로 적히지만 사람에게는 초가 낫다
const timeoutSec = computed({
  get: () => (draft.value.timeoutMs == null ? null : Math.round(draft.value.timeoutMs / 1000)),
  set: (v) => {
    draft.value.timeoutMs = v == null ? null : v * 1000;
  },
});

// 설정과 프롬프트는 딴 파일이라 저장도 따로 간다
const payload = computed(() => ({ ...draft.value, list: { ...listCfg.value } }));
const promptPayload = computed(() => sections.value.map((one) => ({ role: one.role, text: one.text })));
const dirty = computed(() => JSON.stringify(payload.value) !== snapshot.value || JSON.stringify(promptPayload.value) !== promptSnapshot.value);

// 서버도 같은 것을 검사하지만, 저장 버튼을 누르기 전에 알려 주는 편이 낫다.
const problems = computed(() => {
  const found = [];
  const d = draft.value;

  if (d.enabled) {
    if (!String(d.baseUrl || "").trim()) found.push("엔드포인트 주소를 적어야 합니다.");
    else if (!/^https?:\/\//.test(String(d.baseUrl).trim())) found.push("엔드포인트 주소는 http:// 또는 https:// 로 시작해야 합니다.");
    if (!String(d.model || "").trim()) found.push("모델 이름을 적어야 합니다.");
    if (sections.value.length && !hasListMark.value) found.push(`프롬프트 어딘가에 ${LIST_MARK} 이 있어야 합니다.`);
  }

  if (d.temperature != null && !(Number(d.temperature) >= 0 && Number(d.temperature) <= 2)) found.push("온도는 0~2 사이여야 합니다.");
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
  sections.value.push({ key: ++serial, role: sections.value.length ? "user" : "system", text: "" });
}

function toggleFold(key) {
  const next = new Set(folded.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  folded.value = next;
}

function loadDefaults() {
  sections.value = defaults.value.sections.map((one) => ({ key: ++serial, role: one.role, text: one.text }));
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

function apply(data) {
  const { list, prompt, ...rest } = data || {};
  draft.value = { enabled: false, extra: "", ...rest };
  listCfg.value = { lineFormat: "", unknownDuration: "hide", unknownText: "", ...(list || {}) };
  snapshot.value = JSON.stringify(payload.value);
}

function applyPrompt(list) {
  sections.value = (list || []).map((one) => ({ key: ++serial, role: one?.role || "system", text: String(one?.text ?? "") }));
  promptSnapshot.value = JSON.stringify(promptPayload.value);
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
    hasKey.value = !!state.hasKey;
    defaults.value = { sections: state.defaultSections || [], line: state.defaultLine || "" };
  } catch {
    hasKey.value = false;
  }
}

async function loadPreview() {
  previewing.value = true;
  try {
    preview.value = (await axios.post("/api/admin/ai/preview", { data: { ...payload.value, prompt: promptPayload.value } })).data;
  } catch (error) {
    loadError.value = error.response?.data?.error || "미리보기를 만들지 못했습니다.";
  } finally {
    previewing.value = false;
  }
}

async function check() {
  checking.value = true;
  result.value = null;
  try {
    result.value = (await axios.post("/api/admin/ai/check")).data;
  } catch (error) {
    result.value = { ok: false, reason: error.response?.data?.error || "확인하지 못했습니다." };
  } finally {
    checking.value = false;
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

onMounted(() => {
  fetchState();
  fetchAll();
});
</script>
