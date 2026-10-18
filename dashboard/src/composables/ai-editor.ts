// AI 보조 편집기의 상태와 주고받기. 편집기(ConfigAI)가 하나 만들어 내려 주고(provideAiEditor), 카드들이 같이 쓴다(useAiEditor).
// 모델 · 프롬프트 · 판정 테스트 · 고급 설정이 한 설정 문서("ai" · "ai-prompt")를 함께 고치므로 상태는 하나(editorState)이고,
// 그 위의 셈 · 동작을 그룹마다 나눠 둔다(프로바이더 · 모델 매개변수 · 고급 · 프롬프트 · 토큰 · 주고받기 · 서버 읽기 · 판정 테스트 · 모델 목록 · 유료 확인).

import { provide, inject, ref, computed, watch, onMounted, type InjectionKey, type Ref } from "vue";
import axios from "axios";
import { problemText } from "../utils/problem.ts";
import { LIMIT } from "../utils/request.ts";
import type { Option, OptionValue } from "../utils/options.ts";
import { readStored, writeStored } from "../utils/storage.ts";
import { formatNumber } from "../utils/locale.ts";
import { reorderPrompts } from "./config-folds.ts";
import { useConfigFile } from "./config-file.ts";
import { useSaveTarget } from "./save-targets.ts";
import { notifyDone, notifyProblem } from "./toasts.ts";
import { useDragReorder } from "./drag-reorder.ts";
import { vertexChatUrl } from "../../../src/rules/vertex-url.ts";
import { AI_ROLES, hasListMark, promptProblems, type PromptSection } from "../../../src/config/schema/ai-prompt.ts";
import { LINE_NAMES, formatDuration as lineDuration, parseFormat, renderNodes } from "../../../src/rules/line-format.ts";
import { AI_KEY_ORDER, aiProblems, aiSwitchedOff, lineFormatProblems } from "../../../src/config/schema/ai.ts";
import type { ModelField, ModelGroup, RefreshResult } from "../../../src/config/ai-model-types.ts";
import type { AiDefaults, ModelsCheck, PingCheck, Preview, JudgeResult, TestCandidate } from "../../../src/autoplay/assist/types.ts";
import type { AiFields, AiKeyState, AiSaved, AiState, CandidatesReply, ConfigFile, KeysReply, LinesReply, PromptReply, TokensReply } from "../../../src/dashboard/contract/admin.ts";
import { AI_SAMPLE_CANDIDATES } from "../../../src/dashboard/contract/admin.ts";
import { formatDuration } from "../../../src/ui/format.ts";
import { text } from "../text/index.ts";
const TJ = text.ai.judge;
const TR = text.ai.prompt;
const TL = text.ai.list;
const TT = text.ai.test;
const T = text.ai;

/** 편집 중인 AI 설정. 화면이 모르는 필드도 들고 있다가 그대로 돌려보낸다 */
export type Draft = Record<string, unknown> & {
  /** 켜고 끄기. 끄면 선택한 것은 두고 부르지만 않는다(없으면 provider 로 판단: off 면 꺼짐) */
  enabled?: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  location?: string;
  project?: string;
  extra?: string;
  hideModels?: string[];
  retryStatus?: number[] | null;
  // 수 필드. 비우면 null(서버의 기본값을 쓴다). 손으로 고친 파일에는 글자로 적힌 수가 있을 수 있다
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
export type Section = PromptSection & { key: number; name: string };
/** 목록 줄 형식(AI 설정의 list) */
export type ListCfg = { lineFormat: string };
/** 확인 결과 하나(무료 · 유료 테스트) */
export type Tested = { kind: string; ok: boolean; status: number | null | undefined; tookMs: number; reason?: string; extra?: string; asked?: string; body?: string; raw?: string };

// ── 화면에 그대로 쓰는 값 ─────────────────────────────────────────────────────
const NL = String.fromCharCode(10);
// 템플릿에 그대로 적으면 Vue 가 보간으로 읽는다. 값으로 둔다(LIST_MARK 는 봇과 같이 쓰는 config/schema/ai-prompt)
const NONE_MARK = "{{none}}";
const EXTRA_SAMPLE = `think=false\nreasoning_effort=low\nresponse_format=json::{"type":"json_object"}\nheader::X-Title=Discord Musicbot\nmax_tokens=${NONE_MARK}`;
const ROLES = AI_ROLES;
// 줄 형식의 이름(봇과 같이 쓰는 rules/line-format)
const MARKS = Object.keys(LINE_NAMES).map((name) => ({ mark: `{{${name}}}`, hint: T.markHints[name] }));
// 길이가 있을 때만 적는 구간(넣기 칩)
const BLOCK_MARK = "{{#if-exist {{duration}}}}{{duration}} {{/}}";
// 조회 안 한 주소를 그대로 보내면 쓰이는 보기 곡(제목 · 길이)
const SAMPLE_LINES = AI_SAMPLE_CANDIDATES.map((one) => (one.durationSec ? `${one.title} (${formatDuration(one.durationSec)})` : one.title)).join(NL);
const CONSTS = { NL, NONE_MARK, EXTRA_SAMPLE, ROLES, MARKS, BLOCK_MARK, SAMPLE_LINES };

// 프로바이더를 바꾸면 모델 필드가 빈다. 사람이 선택한 것만 브라우저에 적어 둔다.
// 저절로 선택한 첫 모델까지 적으면 "마지막에 선택한 것"이 그것으로 덮인다. 접기 상태와 같은 화면 편의라 설정 파일에 넣지 않는다.
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

// 모델 매개변수의 선택: 값이 참 · 거짓 · 수일 수도 있어 드롭다운에는 순번(문자열)으로 넘기고 돌려받는다. 비어 있으면 기본값
const enumOptions = (list: Array<{ value: unknown; label: string }>): Option[] => list.map((one, i) => ({ value: String(i), label: one.label }));
const enumValue = (list: Array<{ value: unknown }>, value: unknown): OptionValue => {
  const at = list.findIndex((one) => one.value === value);
  return at < 0 ? "" : String(at);
};
const enumPick = (list: Array<{ value: unknown }>, picked: OptionValue): unknown => (picked === "" ? "" : list[Number(picked)]?.value);

// 안전하지 않은 출처처럼 못 쓰는 환경이면 복사만 안 될 뿐이다
function copy(textValue: unknown) {
  navigator.clipboard?.writeText(String(textValue ?? "")).catch(() => {
    /* 복사만 안 된다 */
  });
}

// ── 상태 ─────────────────────────────────────────────────────────────────────
function editorState() {
  return {
    draft: ref<Draft>({ provider: "off" }),
    // 모델이 받는 필드. 서버가 프로필(config/ai-models)을 보고 알려 준다
    fieldInfo: ref<AiFields>({ known: false, fields: [], groups: [], models: [] }),
    showAdvanced: ref(false),
    showHide: ref(false),
    refreshing: ref(false),
    // 값은 모델별로 따로 든다. 모델을 갈아타도 앞 모델에서 선택한 값이 따라오지 않는다.
    allParams: ref<Record<string, Record<string, unknown>>>({}),
    params: ref<Record<string, unknown>>({}),
    jsonText: ref<Record<string, string>>({}),
    jsonBad: ref<Record<string, boolean>>({}),
    listCfg: ref<ListCfg>({ lineFormat: "" }),
    sections: ref<Section[]>([]),
    keyPresence: ref<Record<string, boolean>>({}),
    keyStates: ref<Record<string, AiKeyState>>({}),
    keyInput: ref(""),
    savingKey: ref(false),
    paid: ref<"ping" | "judge" | null>(null), // 확인 대화상자
    paidUrl: ref(""), // 그 대화상자에 표시할 진짜 주소. 서버에 물어서 채운다
    paidUrlError: ref(""), // 못 물어봤으면 까닭. 틀린 주소를 지어 보여 주지 않는다
    providers: ref<AiState["providers"]>([{ value: "off", label: T.providerOff, group: "" }]),
    pingText: ref(""),
    loadingModels: ref(false),
    models: ref<string[]>([]),
    manualModel: ref(false),
    pinging: ref(false),
    // 무료·유료 둘 다 테스트 결과다. 나눠 두면 어느 것이 방금 것인지 헷갈린다.
    tested: ref<Tested | null>(null),
    showRaw: ref(false),
    // 미리보기: 나갈 것을 만들어만 본 것
    shown: ref<Preview | null>(null),
    showRawRequest: ref(false),
    defaults: ref<{ sections: PromptSection[]; line: string }>({ sections: [], line: "" }),
    // 비운 필드가 쓰는 값(서버의 기본값). 흐린 글로 보여 준다
    settingDefaults: ref<Partial<AiDefaults>>({}),
    // custom 은 저장된 주소와 같을 때만 키가 붙는다(autoplayAssist.authOf)
    savedBaseUrl: ref(""),
    syntaxOpen: ref(false),
    // 판정 테스트의 장르(줄 형식 미리보기도 쓴다)
    judgeGenre: ref(TJ.genrePlaceholder),
    // 화면이 읽지 않는 것: 섹션 번호 · 지금 필드를 보여 주는 모델 · 설정 쪽의 섹션 이름(내용은 프롬프트 문서에 있어 순서로 짝짓는다)
    inner: { serial: 0, picking: "", names: [] as string[] },
  };
}
type State = ReturnType<typeof editorState>;

// ── 프로바이더 · 키 · 모델 드롭다운 ─────────────────────────────────────────
function providerView(s: State) {
  const { draft, providers, keyStates, keyPresence, keyInput, models, fieldInfo, savedBaseUrl } = s;
  // 키는 프로바이더마다 따로다(비밀 테이블). 값은 안 내려오고 상태만 온다.
  // 저장된 키가 있는가(지금 주소로 쓸 수 없어도 있다. 그때는 keyTrouble 이 까닭을 보인다)
  const hasKey = computed(() => (keyStates.value[draft.value.provider ?? ""] ?? (keyPresence.value[draft.value.provider ?? ""] ? "ok" : "none")) !== "none");
  // 키가 있는데 지금 쓸 수 없는 까닭: moved(주소 · 리전이 바뀜) · again(풀 수 없음). 없거나 쓸 수 있으면 null
  const keyTrouble = computed(() => {
    const state = keyStates.value[draft.value.provider ?? ""];
    return state === "moved" || state === "again" ? state : null;
  });
  const spec = computed(() => providers.value.find((one) => one.value === draft.value.provider) || null);
  // 로컬 · 클라우드 · 게이트웨이로 묶어 보여 준다. 그룹 없는 것("사용하지 않음")은 맨 위에.
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
  // 드롭다운의 선택지. "사용하지 않음"(off)은 빼고 켜고 끄기는 스위치가 맡는다
  const providerOptions = computed<Option[]>(() => [...ungrouped.value.filter((one) => one.value !== "off").map((one) => ({ value: one.value, label: one.label })), ...grouped.value.flatMap((g) => g.items.map((one) => ({ value: one.value, label: one.label, group: g.name })))]);
  // 프로바이더를 선택했는지(모델 말고 나머지 필드를 쓸 수 있는지). 실제로 켜졌는지는 aiOn
  const on = computed(() => !!draft.value.provider && draft.value.provider !== "off");
  // 켜고 끄기 스위치. 파일에 enabled 가 없으면 provider 로 판단한다(옛 파일: off 면 꺼짐)
  const aiOn = computed({
    get: () => draft.value.enabled ?? on.value,
    set: (v: boolean) => (draft.value.enabled = v),
  });
  // 로컬 모델은 키를 안 받는다. 있으나 마나 한 표시를 보이지 않는다
  const needsKey = computed(() => !!spec.value?.key);
  /**
   * 어디로 나가는지 보여 준다. 버텍스는 주소가 없어 봇과 같은 규칙(rules/vertex-url)으로 조립한다.
   *
   * 프로젝트 ID 만 가린다. 리전은 공개된 값이고, 가려 두면 정작 주소가 맞는지 못 본다.
   * 조립은 입력값을 인코딩하므로 보일 때는 풀어 쓴다(자리표시자 글 · 한글). 주소를 바꾸는 글자(# / ? @)는 decodeURI 가 풀지 않아 그대로 드러난다
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
    const textValue = keyInput.value.trim();
    if (!textValue.startsWith("{")) return true; // 경로로 적는 옛 방식도 받는다
    try {
      const one = JSON.parse(textValue);
      return !!(one?.client_email && one?.private_key);
    } catch {
      return false;
    }
  });
  // 평문으로 열어 두었으면 키가 그대로 네트워크를 지난다. 파일을 고칠 때는 없는 일이다
  const secureOrigin = computed(() => window.isSecureContext);
  const staleCustomUrl = computed(() => !!spec.value?.editable && String(draft.value.baseUrl || "") !== savedBaseUrl.value);
  // 프로필이 아는 모델은 보기 좋은 이름으로 보여준다. 모르는 것은 원본 ID 그대로.
  // 키로 실제로 쓸 수 있는 것은 /models 만 안다(로컬·신모델은 프로필에 없다).
  const modelChoices = computed(() =>
    models.value.map((id) => {
      const known = fieldInfo.value.models.find((one) => one.modelId === id);
      return { id, label: known ? `${known.name} (${id})` : id };
    }),
  );
  return { hasKey, keyTrouble, spec, ungrouped, grouped, providerOptions, on, aiOn, needsKey, shownEndpoint, keyPlaceholder, looksLikeAccount, secureOrigin, staleCustomUrl, modelChoices };
}

// ── 모델 매개변수(프로필이 정한 필드) ──────────────────────────────────────────
function paramsView(s: State) {
  const { draft, fieldInfo, params, allParams, jsonText, jsonBad, showAdvanced } = s;
  // 모델 필드의 값. 선택한 것은 모양이 정해져 있지 않아(프로필이 정한다) 그리는 필드에 맞춰 읽는다
  function numberParam(key: string): number | string | null {
    const v = params.value[key];
    return typeof v === "number" || typeof v === "string" ? v : null;
  }
  const listParam = (key: string): string[] => {
    const v = params.value[key];
    return Array.isArray(v) ? v.map(String) : [];
  };
  function onJson(key: string, textValue: string) {
    jsonText.value = { ...jsonText.value, [key]: textValue };
    if (!textValue.trim()) {
      params.value = { ...params.value, [key]: undefined };
      jsonBad.value = { ...jsonBad.value, [key]: false };
      return;
    }
    try {
      params.value = { ...params.value, [key]: JSON.parse(textValue) };
      jsonBad.value = { ...jsonBad.value, [key]: false };
    } catch {
      jsonBad.value = { ...jsonBad.value, [key]: true };
    }
  }
  // 선택한 모델의 라벨. 프로필이 알면 보기 좋은 이름이 있다.
  const modelName = computed(() => fieldInfo.value.models.find((m) => m.modelId === draft.value.model)?.name || "");
  // 값을 자르지는 않는다. 다만 얼마까지 받는다고 적혀 있는지는 보여 준다
  function hintOf(field: ModelField) {
    const lo = field.min;
    const hi = field.max;
    if (lo === undefined && hi === undefined) return field.path;
    const range = lo !== undefined && hi !== undefined ? `${lo}~${hi}` : lo !== undefined ? T.atLeast(lo) : T.atMost(hi!);
    return `${field.path} · ${range}`;
  }
  // 저쪽이 "이 필드가 켜져 있을 때만 보여라"를 적어 둔다(logprobs → top_logprobs 처럼).
  // 가려진 필드는 서버도 안 보낸다(autoplayAssist.withParams). 판정 기준을 같게 둔다.
  function showIfOk(field: ModelField) {
    const cond = field.showIf;
    if (!cond) return true;
    const owner = fieldInfo.value.fields.find((one) => one.key === cond.key);
    const value = [cond.key ? params.value[cond.key] : undefined, owner?.default].find((one) => one !== undefined && one !== "");
    return value === cond.equals;
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
  const paramLimits = computed(() => {
    const m = fieldInfo.value.models.find((one) => one.modelId === draft.value.model);
    if (!m?.contextWindowTokens && !m?.maxOutputTokens) return "";
    const n = (x: number) => formatNumber(Number(x));
    return [m.contextWindowTokens ? T.contextTokens(n(m.contextWindowTokens)) : "", m.maxOutputTokens ? T.outputTokens(n(m.maxOutputTokens)) : ""].filter(Boolean).join(" · ");
  });
  // 빈 값은 "선택하지 않음"이다(프로필 기본값으로 간다). 빈 모델 필드도 남기지 않는다.
  const cleanParams = computed(() => {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [model, values] of Object.entries(allParams.value)) {
      const kept = Object.fromEntries(Object.entries(values || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined));
      if (Object.keys(kept).length) out[model] = kept;
    }
    return out;
  });
  // 선택한 값은 그때그때 모델 필드에 담는다
  watch(
    params,
    (now) => {
      if (draft.value.model) allParams.value = { ...allParams.value, [draft.value.model]: { ...now } };
    },
    { deep: true },
  );
  return { numberParam, listParam, onJson, modelName, hintOf, showIfOk, paramGroups, paramLimits, cleanParams, enumOptions, enumValue, enumPick };
}

// ── 고급 설정(요청 · 재시도) ─────────────────────────────────────────────────
// 파일은 밀리초로 적히지만 사람에게는 초가 낫다
function secondsOf(draft: Ref<Draft>, key: string, round = true) {
  return computed({
    get: () => {
      const ms = draft.value[key];
      return ms == null ? null : round ? Math.round(Number(ms) / 1000) : Number(ms) / 1000;
    },
    set: (v: number | null) => {
      draft.value[key] = v == null ? null : Math.round(v * 1000);
    },
  });
}
function advancedView(s: State) {
  const { draft, settingDefaults } = s;
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
  const defaultOf = (key: keyof AiDefaults) => {
    const value = settingDefaults.value[key];
    return value == null ? "" : Array.isArray(value) ? value.join(" · ") : String(value);
  };
  const defaultSec = (key: keyof AiDefaults) => {
    const ms = settingDefaults.value[key];
    return ms == null ? "" : String(Number(ms) / 1000);
  };
  // 상태 코드는 수로 적는다. 수가 아닌 것은 버린다. 다 지우면 필드를 비운다(기본값)
  function setRetryStatus(values: string[]) {
    const codes = values.map(Number).filter((n) => Number.isInteger(n));
    draft.value.retryStatus = codes.length ? codes : null;
  }
  return { hideModels, extraText, timeoutSec: secondsOf(draft, "timeoutMs"), totalSec: secondsOf(draft, "totalTimeoutMs"), delaySec: secondsOf(draft, "retryDelayMs", false), delayMaxSec: secondsOf(draft, "retryDelayMaxMs", false), defaultOf, defaultSec, setRetryStatus };
}

// ── 프롬프트: 섹션 · 줄 형식 안내 · 요청 미리보기 ────────────────────────────
// 줄 형식 문제 하나의 앞뒤 몇 글자
const AROUND = 12;
// 줄 형식 미리보기의 보기 후보 둘: 길이를 아는 것 · 모르는 것
const PREVIEW_CANDS = [
  { label: TL.previewKnown, title: "System Of A Down - Toxicity (Official HD Video)", seconds: 223 },
  { label: TL.previewUnknown, title: "Pop Hits 2021 - Ariana Grande, Maroon 5, Taylor Swift", seconds: null },
];
function promptView(s: State) {
  const { sections, listCfg, defaults, shown, judgeGenre, inner } = s;
  const listMarked = computed(() => hasListMark(sections.value));
  function addSection() {
    sections.value.push({ key: ++inner.serial, role: sections.value.length ? "user" : "system", name: "", text: "" });
  }
  // 접힘은 위치로 기억한다. 삭제하면 그 아래의 기억이 하나씩 당겨진다
  function removeSection(i: number) {
    reorderPrompts(sections.value.map((_, at) => at).filter((at) => at !== i));
    sections.value.splice(i, 1);
  }
  function loadDefaults() {
    sections.value = defaults.value.sections.map((one) => ({ key: ++inner.serial, role: one.role, name: "", text: one.text }));
  }
  // 자리표시자 알약. 줄 형식 입력란 끝에 붙인다
  function insertMark(mark: string) {
    listCfg.value.lineFormat = `${listCfg.value.lineFormat || defaults.value.line}${mark}`;
  }
  // 줄 형식 안내: 문제마다 앞뒤 몇 글자와 틀린 구간(봇과 같은 검사)
  const lineProblems = computed(() => {
    const format = listCfg.value.lineFormat;
    return lineFormatProblems(format).map((one) => {
      const from = Math.max(0, one.at - AROUND);
      const to = Math.min(format.length, one.end + AROUND);
      return { ...one, before: `${from > 0 ? "…" : ""}${format.slice(from, one.at)}`, part: format.slice(one.at, one.end), after: `${format.slice(one.end, to)}${to < format.length ? "…" : ""}` };
    });
  });
  // 봇과 같은 해석기로 그린 미리보기. 장르는 판정 테스트에 적은 것
  const linePreview = computed(() => {
    const nodes = parseFormat(listCfg.value.lineFormat || defaults.value.line, LINE_NAMES).nodes;
    return PREVIEW_CANDS.map((cand, i) => ({
      label: cand.label,
      line: renderNodes(nodes, { index: () => String(i + 1), genre: () => judgeGenre.value || TJ.genrePlaceholder, title: () => cand.title, duration: (arg) => lineDuration(cand.seconds, arg) }).trim(),
    }));
  });
  // 순서 바꾸기. 접어 둔 기억도 그 섹션을 따라간다
  const { startDrag } = useDragReorder(sections, reorderPrompts);
  // 다듬지 않는다. 무엇이 나갈지 그대로 봐야 한다. 보낼 글을 섹션별로(규격에 따라 본문 모양이 달라 JSON 으로는 읽기 어렵다).
  // 빈 섹션은 요청에서 빠진다. 서버가 달아 준 `at`(원래 섹션 번호)으로 라벨을 찾아야 밀리지 않는다
  const shownSections = computed(() =>
    (shown.value?.messages || []).map((one, i) => {
      const at = Number.isInteger(one.at) ? one.at : i;
      return { name: sections.value[at]?.name || TR.sectionName(at + 1), role: one.role, text: one.content };
    }),
  );
  // 원본 그대로도 볼 수 있게 남겨 둔다(접어 둔다)
  const boxes = computed(() => {
    const one = shown.value;
    if (!one) return [];
    return [
      { title: "URL", text: one.url },
      { title: T.boxes.headers, text: JSON.stringify(one.headers, null, 2) },
      { title: T.boxes.body, text: JSON.stringify(one.body, null, 2) },
    ];
  });
  return { listMarked, addSection, removeSection, loadDefaults, insertMark, lineProblems, linePreview, startDrag, shownSections, boxes };
}

// ── 토큰 세기(어림수, 어느 기준으로 셌는지 같이 밝힌다) ──────────────────────
function tokenCount(s: State) {
  const { sections, draft } = s;
  const tokenEach = ref<number[]>([]);
  const tokenTotal = ref<number | null>(null);
  const tokenExact = ref(true);
  const tokenError = ref("");
  // 고치는 대로 다시 요청한다. 늦게 온 앞 요청의 답이 새 답을 덮지 않게 순서를 맞춘다
  let seqNow = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function countTokens() {
    const seq = ++seqNow;
    if (!sections.value.length) {
      tokenEach.value = [];
      tokenTotal.value = null;
      return;
    }
    try {
      const { data } = await axios.post<TokensReply>("/api/admin/ai/tokens", { provider: draft.value.provider, model: draft.value.model, texts: sections.value.map((one) => one.text) }, { timeout: LIMIT.none });
      if (seq !== seqNow) return;
      tokenEach.value = data.each;
      tokenTotal.value = data.total;
      tokenExact.value = data.exact;
      tokenError.value = "";
    } catch (error) {
      if (seq !== seqNow) return;
      tokenEach.value = [];
      tokenTotal.value = null;
      tokenError.value = problemText(error, T.failed.tokens);
    }
  }
  watch(
    () => [sections.value.map((one) => one.text).join(NL), draft.value.provider, draft.value.model],
    () => {
      clearTimeout(timer);
      timer = setTimeout(countTokens, 400);
    },
    { immediate: true },
  );
  return { tokenEach, tokenTotal, tokenExact, tokenError, countTokens };
}

// ── 주고받기: 보낼 모양 · 받은 것 넣기 · 저장 막대 ───────────────────────────
function exchange(s: State, cleanParams: Ref<Record<string, Record<string, unknown>>>) {
  const { draft, listCfg, sections, allParams, params, savedBaseUrl, keyInput, keyPresence, keyStates, inner } = s;
  // 저장은 보낸 순서대로 둔다. 기본 설정 문서와 같은 순서(schema/ai 의 AI_KEY_ORDER)로 보내 내보내기 글이 읽기 좋게 한다.
  const payload = computed(() => {
    const all: Record<string, unknown> = { ...draft.value, params: cleanParams.value, list: { ...listCfg.value }, promptNames: sections.value.map((one) => one.name || "") };
    const out: Record<string, unknown> = {};
    for (const key of AI_KEY_ORDER) if (key in all) out[key] = all[key];
    // 모르는 키는 뒤에 그대로 둔다. 빠뜨리면 저장할 때 파일에서 삭제된다
    for (const [key, value] of Object.entries(all)) if (!(key in out)) out[key] = value;
    return out;
  });
  const promptPayload = computed((): PromptSection[] => sections.value.map((one) => ({ role: one.role, text: one.text })));
  // AI 에 보낼 요청을 만들 때 쓰는 것. 저장용(payload)과 달라지는 곳은 프롬프트 하나다(딴 문서로 저장한다).
  // 미리보기 · 판정 요청처럼 "지금 화면에 있는 것"을 테스트하는 곳은 전부 이쪽을 쓴다.
  const aiRequestDraft = () => ({ ...payload.value, prompt: promptPayload.value });
  function apply(data: Record<string, unknown>) {
    const { list, prompt: _prompt, promptNames, params: saved, ...rest } = data || {};
    draft.value = { provider: "off", extra: "", hideModels: [], location: "", project: "", ...rest };
    allParams.value = { ...((saved as Record<string, Record<string, unknown>> | undefined) || {}) };
    // 설정에 저장돼 있는 모델도 사람이 선택한 것이다. 시작 직후에도 기억이 비지 않게 둔다
    rememberModel(draft.value.provider, draft.value.model);
    inner.picking = draft.value.model || "";
    params.value = { ...(allParams.value[inner.picking] || {}) };
    // 옛 필드(길이를 모르는 후보)는 읽지 않는다. 저장하면 빠진다(이제 줄 형식 안의 {{#if-exist}} 로 정한다)
    listCfg.value = { lineFormat: String((list as Partial<ListCfg> | undefined)?.lineFormat ?? "") };
    inner.names = Array.isArray(promptNames) ? promptNames.map(String) : [];
    sections.value.forEach((one, i) => (one.name = inner.names[i] || ""));
    savedBaseUrl.value = String(draft.value.baseUrl || ""); // 키를 붙일지 정하는 기준
  }
  function applyPrompt(list: PromptSection[] | null | undefined) {
    sections.value = (list || []).map((one, i) => ({ key: ++inner.serial, role: one?.role || "system", name: inner.names[i] || "", text: String(one?.text ?? "") }));
  }
  // 키 상태만 다시 불러온다(설정을 저장한 뒤: 주소 · 리전을 바꿔 저장했으면 묶인 키의 상태도 바뀐다)
  async function refreshKeys() {
    try {
      const state = (await axios.get<AiState>("/api/admin/ai/state")).data;
      keyPresence.value = state.hasKey || {};
      keyStates.value = state.keyState || {};
    } catch {
      /* 다음에 탭을 열 때 다시 불러온다 */
    }
  }
  // 설정과 프롬프트는 딴 문서지만 한 편집기다. 둘을 한 번에 읽고, 한 요청으로 저장한다(둘 중 하나만 저장되지 않게).
  // 이름(promptNames)이 설정 쪽에 실리므로 설정을 넣은 뒤에 프롬프트를 넣는다. 저장 번호는 설정 문서의 것을 들고 있다가 돌려보낸다
  let aiRevision = 0;
  const file = useConfigFile({
    tab: "ai",
    savedNote: T.savedNote,
    // 입력해 두고 저장하지 않은 키도 떠날 때 묻는다
    alsoUnsaved: () => Boolean(keyInput.value.trim()),
    payload: () => ({ data: payload.value, sections: promptPayload.value }),
    apply: (both) => {
      apply(both.data as Record<string, unknown>);
      applyPrompt(both.sections as PromptSection[]);
    },
    read: async () => {
      const got = (await axios.get<ConfigFile>("/api/admin/config/ai")).data;
      aiRevision = got.revision;
      return { data: got.data, sections: (await axios.get<PromptReply>("/api/admin/ai/prompt")).data.sections };
    },
    write: async (both) => {
      const saved = (await axios.put<AiSaved>("/api/admin/ai/settings", { ...(both as object), revision: aiRevision })).data;
      aiRevision = saved.revision;
      void refreshKeys();
      return saved;
    },
  });
  // 저장할 때 서버가 보는 검사 그대로(schema/ai · schema/ai-prompt). 꺼 두면(enabled: false) 나머지 필드 · 프롬프트를 따지지 않는다. 불러오기 전에는 문제가 없다
  const problems = computed(() => {
    if (!file.loaded.value) return [];
    return aiSwitchedOff(payload.value) ? [...file.serverProblems.value] : [...aiProblems(payload.value), ...promptProblems(promptPayload.value, true), ...file.serverProblems.value];
  });
  // 운영자 패널의 저장 막대에 올린다(검사에 걸린 값이 있으면 막대가 저장을 막는다)
  useSaveTarget({ tab: "ai", dirty: file.dirty, saving: file.saving, blocked: computed(() => problems.value.length > 0), save: () => file.save(), revert: file.revert });
  return { payload, promptPayload, aiRequestDraft, apply, applyPrompt, refreshKeys, problems, loaded: file.loaded, dirty: file.dirty, saving: file.saving, loadError: file.loadError, serverProblems: file.serverProblems, fetchAll: file.fetch, save: file.save, revert: file.revert };
}
type Exchange = ReturnType<typeof exchange>;

// ── 서버에서 읽기: 모델 필드 · 키 상태와 기본값 · 요청 미리보기 ────────────────
function serverReads(s: State, io: Exchange) {
  const { draft, fieldInfo, params, allParams, jsonText, jsonBad, keyPresence, keyStates, providers, pingText, defaults, settingDefaults, shown, inner } = s;
  // 읽기는 고치는 대로 다시 요청한다. 늦게 온 앞 요청의 답이 새 답을 덮지 않게 순서를 맞춘다
  let fieldsSeq = 0;
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
      if (model !== inner.picking) {
        inner.picking = model ?? "";
        params.value = { ...(allParams.value[inner.picking] || {}) };
        jsonText.value = {};
        jsonBad.value = {};
      }
    } catch (error) {
      if (seq !== fieldsSeq) return;
      fieldInfo.value = { known: false, fields: [], groups: [], models: [] };
      io.loadError.value = problemText(error, T.failed.fields);
    }
  }
  // 키 유무와 기본 프롬프트. 둘 다 서버가 들고 있다(화면이 프롬프트를 따로 베껴 두면 한쪽만 고치게 된다)
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
      io.loadError.value = problemText(error, T.failed.state);
    }
  }
  // 만들어만 본다. 아무 데도 안 나간다.
  async function openPreview() {
    try {
      shown.value = (await axios.post<Preview>("/api/admin/ai/preview", { data: io.aiRequestDraft() })).data;
    } catch (error) {
      io.loadError.value = problemText(error, T.failed.preview);
    }
  }
  // 프로바이더나 모델이 바뀌면 받을 수 있는 필드도 달라진다.
  watch(
    () => [draft.value.provider, draft.value.model],
    () => loadFields(),
    { immediate: true },
  );
  return { loadFields, fetchState, openPreview };
}

// ── 판정 테스트: 보기 곡이 아니라 진짜 곡으로 테스트한다. 링크 조회는 아무것도 보내지 않고 판정 요청만 실제로 보낸다 ──
type Verdict = { song: boolean | null; fits: boolean | null } | null | undefined;
const verdictOk = (one: Verdict) => Boolean(one && one.song && one.fits);
const verdictText = (one: Verdict) => (!one ? "?" : one.song && one.fits ? T.verdicts.pass : !one.song ? T.verdicts.notSong : T.verdicts.wrongGenre);
const rendered = (one: TestCandidate) => Boolean(!one.error && one.title);
function judgeTest(s: State, io: Exchange) {
  const { listCfg, judgeGenre } = s;
  const judgeUrls = ref("");
  const judging = ref(false);
  const judgeError = ref("");
  const judgeCands = ref<TestCandidate[]>([]);
  const judgeList = ref<string[]>([]);
  const judgeVerdicts = ref<Array<NonNullable<JudgeResult["verdicts"]>[number] | null> | null>(null);
  const judgeSent = ref<JudgeResult | null>(null);
  const showJudgeRaw = ref(false);
  const judgeLookedUp = ref("");
  // 입력해 두고 조회를 안 눌렀으면 알려 준다. 그대로 보내면 보기 곡으로 판정한다
  const judgeStale = computed(() => !!judgeUrls.value.trim() && judgeUrls.value.trim() !== judgeLookedUp.value);
  const judgeUsable = computed(() => (judgeStale.value ? [] : judgeCands.value.filter(rendered)));
  // 미리보기 창과 같은 것을 같은 순서로 보여준다. 같은 요청인데 보여주는 것이 다르면 어느 쪽이 진짜인지 알 수 없다
  const judgeBoxes = computed(() => {
    const one = judgeSent.value;
    if (!one) return [];
    return [
      { title: "URL", text: one.url },
      { title: T.boxes.headers, text: JSON.stringify(one.headers, null, 2) },
      { title: T.boxes.body, text: JSON.stringify(one.body, null, 2) },
      { title: T.boxes.response, text: one.response || T.boxes.empty },
    ];
  });
  // 못 읽은 줄이 섞여 있어 후보 순서와 줄 순서가 어긋난다. 멀쩡한 것만 세어 맞춘다
  function lineFor(cand: TestCandidate) {
    const at = judgeCands.value.filter(rendered).indexOf(cand);
    return judgeList.value[at] ?? "";
  }
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
  // 줄 그리기는 서버 몫이다(실제로 나가는 줄). 늦게 온 응답이 방금 그린 것을 덮지 않도록 순서를 센다.
  let linesSeq = 0;
  let linesTimer: ReturnType<typeof setTimeout> | undefined;
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
  watch([judgeCands, judgeGenre, () => JSON.stringify(listCfg.value)], () => {
    clearTimeout(linesTimer);
    linesTimer = setTimeout(drawLines, 150);
  });
  async function runJudge() {
    judging.value = true;
    judgeError.value = "";
    try {
      const usable = judgeUsable.value; // 조회를 안 했으면 비어 있다. 서버가 보기 곡으로 돌린다
      const { data } = await axios.post<JudgeResult>("/api/admin/ai/judge/run", { candidates: usable, genre: judgeGenre.value, data: io.aiRequestDraft() }, { timeout: LIMIT.none });
      judgeSent.value = data;
      judgeVerdicts.value = usable.length ? judgeCands.value.map((cand) => (cand.error ? null : (data.verdicts?.[usable.indexOf(cand)] ?? null))) : null;
    } catch (error) {
      judgeError.value = problemText(error, T.failed.judge);
    } finally {
      judging.value = false;
    }
  }
  return { judgeUrls, judging, judgeError, judgeCands, judgeList, judgeVerdicts, judgeSent, showJudgeRaw, judgeLookedUp, judgeStale, judgeUsable, judgeBoxes, lineFor, verdictOk, verdictText, copy, lookupJudge, drawLines, runJudge };
}
type Judge = ReturnType<typeof judgeTest>;

// ── 모델 목록(무료 확인) · 프로바이더 · 모델 선택 ───────────────────────────
function modelList(s: State, io: Exchange, reads: ReturnType<typeof serverReads>, on: Ref<boolean>) {
  const { draft, models, manualModel, tested, keyInput, loadingModels, showRaw, refreshing } = s;
  // 불러온 모델 목록을 넣는다. 목록을 불러왔으면 드롭다운으로 돌아가고(못 불러왔을 때만 직접 입력하게 한다),
  // 지금 값이 이 프로바이더의 목록에 없으면 기억해 둔 것으로 되돌린다
  function takeModels(list: string[]) {
    models.value = list;
    manualModel.value = !list.length;
    if (list.includes(draft.value.model ?? "")) return;
    const remembered = rememberedModels()[draft.value.provider ?? ""];
    draft.value.model = list.includes(remembered) ? remembered : list[0] || "";
  }
  // 무료 테스트의 결과 영역
  function modelsTested(got: ModelsCheck): Tested {
    const hidden = got.hiddenCount ? T.hiddenCount(got.hiddenCount) : "";
    const extra = got.ok ? `${T.modelCount(models.value.length)}${hidden}` : got.preset ? `${T.presetModels(models.value.length)}${hidden}` : "";
    return { kind: TT.free, ok: got.ok, status: got.status, tookMs: got.tookMs ?? 0, reason: got.reason, extra, body: got.ok ? "" : got.response, raw: got.response };
  }
  // 무료. 추론을 안 돌린다. 연결 확인이자 모델 목록 불러오기다(같은 한 번의 호출이다).
  // quiet: 프로바이더를 선택할 때 저절로 도는 것이라 실패를 빨갛게 표시하지 않는다.
  async function loadModels({ quiet = false } = {}) {
    loadingModels.value = true;
    showRaw.value = false;
    if (!quiet) tested.value = null;
    try {
      const got = (await axios.post<ModelsCheck>("/api/admin/ai/models", { data: io.payload.value }, { timeout: LIMIT.none })).data;
      takeModels(got.models || []);
      if (quiet && !got.ok) return;
      tested.value = modelsTested(got);
    } catch (error) {
      if (!quiet) tested.value = { kind: TT.free, ok: false, status: null, tookMs: 0, reason: problemText(error, T.failed.models) };
    } finally {
      loadingModels.value = false;
    }
  }
  function onProvider() {
    models.value = [];
    tested.value = null;
    keyInput.value = "";
    manualModel.value = false;
    // baseUrl 은 custom 전용이다. 다른 것을 선택했다고 입력해 둔 주소를 삭제하지 않는다
    if (!on.value) return;
    void loadModels({ quiet: true }); // 선택하면 알아서 불러온다. 무료라 누르게 할 이유가 없다
  }
  function pickProvider(value: OptionValue) {
    draft.value.provider = String(value);
    onProvider();
  }
  function pickModel(value: OptionValue) {
    draft.value.model = String(value);
    rememberModel(draft.value.provider, draft.value.model);
  }
  async function refreshModels() {
    refreshing.value = true;
    try {
      const { data } = await axios.post<RefreshResult>("/api/admin/ai/models/refresh", undefined, { timeout: LIMIT.none });
      if (data.changed) {
        notifyDone(T.modelsRefreshed, T.modelCount(data.count));
        await reads.loadFields();
      } else notifyDone(T.modelsCurrent);
    } catch (error) {
      notifyProblem(error, T.modelsRefreshFailed);
    } finally {
      refreshing.value = false;
    }
  }
  return { rememberModel, takeModels, loadModels, onProvider, pickProvider, pickModel, refreshModels };
}

// ── 키 입력 · 유료 확인(짧은 생성 · 판정 테스트를 보내기 전에 한 번 묻는다) ────
function paidActions(s: State, io: Exchange, judge: Judge, serviceAccount: () => boolean) {
  const { draft, paid, paidUrl, paidUrlError, keyInput, keyPresence, keyStates, savingKey, pinging, tested, showRaw, pingText } = s;
  // 돈이 드는 것은 한 번 물어본다. 보안이 아니라 실수 방지다.
  // 확인 대화상자를 열면서 진짜 주소를 받아 온다. 미리보기는 아무 데도 안 보내므로 토큰이 안 든다.
  // 클라이언트가 주소를 흉내 내면 어긋난다(버텍스는 project·location 으로 조립하고,
  // custom 은 끝 슬래시를 떼야 한다). 물어보는 편이 늘 맞다.
  const askPaid = async (which: "ping" | "judge") => {
    paid.value = which;
    paidUrl.value = "";
    paidUrlError.value = "";
    try {
      const { url } = (await axios.post<Preview>("/api/admin/ai/preview", { data: io.aiRequestDraft() })).data;
      if (paid.value === which) paidUrl.value = url || "";
    } catch (error) {
      if (paid.value === which) paidUrlError.value = problemText(error, T.failed.endpoint);
    }
  };
  // 유료. 짧은 질문 하나를 실제로 생성시킨다(판정 프롬프트는 안 쓴다).
  async function runPing() {
    pinging.value = true;
    tested.value = null;
    showRaw.value = false;
    try {
      const got = (await axios.post<PingCheck>("/api/admin/ai/ping", { data: io.payload.value }, { timeout: LIMIT.none })).data;
      tested.value = { kind: TT.paid, ok: got.ok, status: got.status, tookMs: got.tookMs ?? 0, reason: got.reason, asked: pingText.value, body: got.answer || got.response, raw: got.response };
    } catch (error) {
      tested.value = { kind: TT.paid, ok: false, status: null, tookMs: 0, reason: problemText(error, T.failed.send) };
    } finally {
      pinging.value = false;
    }
  }
  function runPaid() {
    const which = paid.value;
    paid.value = null;
    if (which === "ping") void runPing();
    else void judge.runJudge();
  }
  // 키는 쓰기 전용이다. payload 에 안 싣는다(미리보기 · 테스트로 새어 나가면 안 된다). 키는 지금 입력된 주소 · 리전에 묶인다(data). 그 설정을 저장해야 쓰인다
  async function putKey(value: string) {
    savingKey.value = true;
    try {
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
   * 서비스 계정은 JSON 블록이다. 받은 그대로 붙여넣으면 들여쓰기가 제각각이라,
   * 저장 전에 한 모양으로 정리한다. 파일에 블록 리터럴(`|-`)로 곱게 들어간다.
   */
  function saveKey() {
    const typed = keyInput.value.trim();
    if (!serviceAccount() || !typed.startsWith("{")) return putKey(typed);
    try {
      return putKey(JSON.stringify(JSON.parse(typed), null, 2));
    } catch {
      return putKey(typed); // 못 읽으면 입력된 그대로. 조용히 버리지 않는다
    }
  }
  const clearKey = () => putKey("");
  return { askPaid, runPing, runPaid, putKey, saveKey, clearKey };
}

/** 편집기 하나의 상태 · 동작. 컴포넌트의 setup 안에서 부른다(감시 · 저장 막대 · 처음 읽기가 그 컴포넌트에 걸린다) */
function createAiEditor() {
  const s = editorState();
  const provider = providerView(s);
  const paramsPart = paramsView(s);
  const io = exchange(s, paramsPart.cleanParams);
  const reads = serverReads(s, io);
  const judge = judgeTest(s, io);
  const list = modelList(s, io, reads, provider.on);
  const paidPart = paidActions(s, io, judge, () => !!provider.spec.value?.serviceAccount);
  onMounted(async () => {
    await reads.fetchState();
    await io.fetchAll();
    // 켜져 있으면 열자마자 채워 둔다. 무료라 물어볼 것이 없다.
    if (provider.on.value) void list.loadModels({ quiet: true });
  });
  return { ...CONSTS, ...s, ...provider, ...paramsPart, ...advancedView(s), ...promptView(s), ...tokenCount(s), ...io, ...reads, ...judge, ...list, ...paidPart };
}

type AiEditor = ReturnType<typeof createAiEditor>;
const KEY: InjectionKey<AiEditor> = Symbol("ai-editor");

/** 편집기를 만들고 아래 카드에 내려 준다 */
function provideAiEditor(): AiEditor {
  const editor = createAiEditor();
  provide(KEY, editor);
  return editor;
}

/** 편집기 아래 카드가 상태를 받는다 */
function useAiEditor(): AiEditor {
  const editor = inject(KEY);
  if (!editor) throw new Error("useAiEditor: call inside ConfigAI");
  return editor;
}

export { provideAiEditor, useAiEditor };
export type { AiEditor };
