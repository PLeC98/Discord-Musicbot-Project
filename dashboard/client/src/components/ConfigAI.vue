<!--
  AI 보조 설정 (운영자 패널).

  이 설정은 파일(config/ai.yaml)로도 고칠 수 있다 — 대시보드는 선택 기능이다.
  그래서 저장은 파일을 통째로 덮지 않고 바뀐 자리만 고치며, 손으로 적은 주석은 그대로 남는다.

  **API 키는 여기서 다루지 않는다.** .env 에 있고, 화면에는 있는지 없는지만 내려온다 —
  값을 브라우저로 보내면 XSS 하나로 새어 나간다.
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
          <span :class="labelCls" v-tooltip="'이 시간을 넘기면 포기하고 규칙으로 고릅니다'">제한 시간(초)</span>
          <NumberInput v-model="timeoutSec" :class="inputCls" />
        </label>
        <label class="block">
          <span :class="labelCls" v-tooltip="'곡마다 따로 물으면 느립니다'">한 번에 묻는 곡 수</span>
          <NumberInput v-model="draft.batchSize" :class="inputCls" />
        </label>
        <label class="flex items-center gap-2 cursor-pointer self-end pb-2.5">
          <input v-model="draft.skipConfident" type="checkbox" class="size-4 accent-accent shrink-0" />
          <span class="text-[0.82rem]" v-tooltip="'채널 이름이나 길이가 딱 맞아떨어진 후보는 묻지 않습니다'">확신할 땐 생략</span>
        </label>
      </div>

      <div class="mt-4">
        <span :class="labelCls">요청에 더 얹을 값</span>
        <p class="text-muted text-[0.78rem] mb-2">사고 조절처럼 서비스마다 이름이 다른 것을 그대로 보냅니다. Ollama 계열은 <code class="text-fg-soft">think</code> / <code class="text-fg-soft">false</code>, OpenAI 계열은 <code class="text-fg-soft">reasoning_effort</code> / <code class="text-fg-soft">low</code>.</p>

        <div v-for="(row, i) in extraRows" :key="row.key" class="flex items-center gap-2 mb-2">
          <input v-model="row.name" placeholder="이름" :class="[inputCls, 'flex-1']" />
          <input v-model="row.value" placeholder="값" :class="[inputCls, 'flex-1']" />
          <button :class="removeBtn" v-tooltip="'이 값 삭제'" @click="extraRows.splice(i, 1)"><Icon name="trash" :size="15" /></button>
        </div>
        <button :class="addLine" @click="extraRows.push({ key: ++serial, name: '', value: '' })"><Icon name="add" :size="14" /><span>값 추가</span></button>
      </div>
    </BaseCard>

    <BaseCard icon="terminal" title="판정 기준">
      <p class="text-muted text-[0.82rem] mt-1 mb-1"><strong class="text-fg-soft">이 글이 성능의 거의 전부입니다.</strong> 같은 모델·같은 표본에서 이 글만 고쳐 맞춘 비율이 77% → 95%로 움직였습니다. 부정 목록을 길게 늘어놓는 것보다 "곡 하나냐 여러 곡이냐"로 묻고 예를 붙이는 쪽이 훨씬 나았습니다.</p>
      <p class="text-muted text-[0.82rem] mb-3">답은 반드시 <code class="text-fg-soft">[{"n":1,"song":true,"fits":false}]</code> 꼴의 JSON 배열이어야 합니다.</p>

      <textarea v-model="promptText" rows="14" :placeholder="defaultPrompt" :class="[inputCls, 'font-mono text-[0.78rem] leading-relaxed resize-y']"></textarea>
      <div class="flex items-center gap-2.5 mt-2">
        <button :class="addLine" @click="promptText = ''">기본값으로</button>
        <span class="text-muted text-[0.78rem]">{{ promptText.trim() ? "직접 적은 기준을 씁니다" : "비어 있어 기본 기준을 씁니다" }}</span>
      </div>
    </BaseCard>

    <div v-if="problems.length" class="mt-3 text-[0.82rem] text-[#f87171]">
      <div v-for="p in problems" :key="p">· {{ p }}</div>
    </div>
    <p v-if="savedAt" class="mt-3 text-muted text-[0.8rem]">저장 완료. 다음 자동재생부터 반영됩니다</p>
    <p v-if="loadError" class="mt-3 text-[0.82rem] text-[#f87171]">{{ loadError }}</p>

    <SaveDock :dirty="dirty" :saving="saving" :blocked="problems.length > 0" @save="save" @revert="revert" />
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

const inputCls = "w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-2 text-[0.9rem] outline-none font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7";
const labelCls = "block text-[0.8rem] text-muted mb-1.5";
const removeBtn = "h-[38px] w-[38px] rounded-xl border border-white/9 text-muted cursor-pointer flex items-center justify-center shrink-0 transition-[background-color,color,border-color] duration-150 hover:bg-danger/15 hover:text-danger hover:border-danger/30";
const addLine = "flex items-center gap-1.5 text-muted text-[0.82rem] px-2 py-1.5 rounded-lg cursor-pointer transition-colors duration-150 hover:text-fg-soft hover:bg-white/6";

const draft = ref({ enabled: false });
const snapshot = ref("");
const saving = ref(false);
const savedAt = ref(null);
const loadError = ref("");
const serverProblems = ref([]);

const hasKey = ref(false);
const checking = ref(false);
const result = ref(null);
const defaultPrompt = ref("");

const keyCls = computed(() => (hasKey.value ? "text-[#4ade80]" : "text-muted"));

// extra 는 순서가 없는 이름:값이지만 편집 중에는 줄로 다룬다 — 맵으로 두면 이름을 고치는 순간 키가 바뀐다
let serial = 0;
const extraRows = ref([]);
const toRows = (extra) => Object.entries(extra || {}).map(([name, value]) => ({ key: ++serial, name, value: String(value) }));

// YAML 에 true/false/숫자로 남아야 할 것이 글자로 굳으면 저쪽이 안 받는다
function parseValue(raw) {
  const text = String(raw).trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text !== "" && !Number.isNaN(Number(text))) return Number(text);
  return text;
}

const extra = computed(() => Object.fromEntries(extraRows.value.filter((r) => r.name.trim()).map((r) => [r.name.trim(), parseValue(r.value)])));

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

const promptText = computed({
  get: () => draft.value.prompt || "",
  set: (v) => {
    draft.value.prompt = v;
  },
});

const payload = computed(() => ({ ...draft.value, extra: extra.value }));
const dirty = computed(() => JSON.stringify(payload.value) !== snapshot.value);

// 서버도 같은 것을 검사하지만, 저장 버튼을 누르기 전에 알려 주는 편이 낫다.
const problems = computed(() => {
  const found = [];
  const d = draft.value;

  if (d.enabled) {
    if (!String(d.baseUrl || "").trim()) found.push("엔드포인트 주소를 적어야 합니다.");
    else if (!/^https?:\/\//.test(String(d.baseUrl).trim())) found.push("엔드포인트 주소는 http:// 또는 https:// 로 시작해야 합니다.");
    if (!String(d.model || "").trim()) found.push("모델 이름을 적어야 합니다.");
  }

  if (d.temperature != null && !(Number(d.temperature) >= 0 && Number(d.temperature) <= 2)) found.push("온도는 0~2 사이여야 합니다.");
  if (d.timeoutMs != null && !(Number(d.timeoutMs) >= 1000 && Number(d.timeoutMs) <= 600000)) found.push("제한 시간은 1~600초 사이여야 합니다.");
  if (d.batchSize != null && !(Number(d.batchSize) >= 1 && Number(d.batchSize) <= 50)) found.push("한 번에 묻는 곡 수는 1~50 사이여야 합니다.");

  const names = extraRows.value.map((r) => r.name.trim()).filter(Boolean);
  if (new Set(names).size !== names.length) found.push("더 얹을 값의 이름이 겹칩니다.");

  return [...found, ...serverProblems.value];
});

watch(payload, () => {
  savedAt.value = null;
  serverProblems.value = [];
});

function apply(data) {
  const { extra: got, ...rest } = data || {};
  draft.value = { enabled: false, ...rest };
  extraRows.value = toRows(got);
  snapshot.value = JSON.stringify(payload.value);
}

async function fetchConfig() {
  loadError.value = "";
  try {
    apply((await axios.get("/api/admin/config/ai")).data.data);
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
    defaultPrompt.value = state.defaultPrompt || "";
  } catch {
    hasKey.value = false;
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
    savedAt.value = Date.now();
  } catch (error) {
    serverProblems.value = error.response?.data?.problems || [error.response?.data?.error || "저장하지 못했습니다."];
  } finally {
    saving.value = false;
  }
}

function revert() {
  apply(JSON.parse(snapshot.value));
}

onMounted(() => {
  fetchState();
  fetchConfig();
});
</script>
