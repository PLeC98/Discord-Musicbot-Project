// 자동재생 AI 보조. 유튜브에서 찾아온 후보를 모델에게 한 번 더 물어본다.
//
// 소스가 아니라 뒷거름망이다. 곡 이름만 아는 소스(키워드·Last.fm)에서만 쓸 자리가 있고,
// 주소를 직접 주는 소스(VocaDB·AnimeThemes·재생목록)는 출처가 곧 정답이라 물을 것이 없다.
//
// 없어도 되는 기능이다. 못 부르면 규칙이 고른 것을 그대로 쓰고 재생은 멈추지 않는다.

import * as aiConfig from "../../config/ai.ts";
import * as links from "../../rules/links.ts";
import * as aiKeys from "../../store/ai-keys.ts";
import * as googleAuth from "./google-auth.ts";
import * as tokens from "./tokens.ts";
import * as models from "../../config/ai-models.ts";
import * as YouTube from "../../sources/youtube/index.ts";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "autoplay" });
import { PROVIDER_SPECS, PROVIDERS } from "../../config/schema/ai-providers.ts";
import { errorKind, messageOf } from "../../rules/error-kind.ts";
import { setTimeout as sleep } from "timers/promises";
import * as retry from "./retry.ts";
import type { PromptSection } from "../../config/schema/ai-prompt.ts";
import { LINE_NAMES, PROMPT_NAMES, formatDuration, parseFormat, renderNodes, type Names, type Node } from "../../rules/line-format.ts";
import type { AiDefaults, AiSettings, Body, Judged, JudgeResult, ListFormat, ModelsCheck, PingCheck, Preview, TestCandidate, TokenCount, Usage, Wire } from "./types.ts";
import { SAMPLE_CANDIDATES } from "./sample.ts";
import type { ModelField } from "../../config/ai-model-types.ts";
import { vertexBase as vertexBaseOf, vertexChatUrl, vertexHost } from "../../rules/vertex-url.ts";
import { httpFor } from "../../infra/http.ts";
import { REDACTED, mask, safeHeaders } from "./mask.ts";
import { sendLogged, type Call } from "./request-log.ts";

// 바깥으로 나가는 요청은 공유 HTTP 클라이언트로(부른 결과가 남는다). 시험은 useFetch 로 가짜를 넘긴다(null 이면 진짜 fetch)
const http = httpFor("ai");
const send = http.fetch;
const useFetch = http.useFetch;

type Draft = Partial<AiSettings> | null | undefined;
type Extra = { body: Body; headers: Record<string, string>; drop: string[]; dropHeaders: string[]; problems: string[] };
type Verdict = { song: boolean; fits: boolean };
/**
 * 자동재생 고르기 하나. 고르기는 출처마다 후보를 몇 번 판정하는데, 그중 하나가 재시도 끝에 실패하면
 * 나머지 판정은 한 번만 부른다. 미리 뽑은 곡이 없으면 사용자가 소리 없이 기다리는 동안이다
 */
type AiPick = { failed: boolean };
/** 판정에 딸려 오는 것 */
type About = { genre?: string; confident?: boolean; pick?: AiPick };
// 고르기 안에서 이미 실패했으면 다시 부르지 않는다(0). 아니면 설정대로
const retriesIn = (about: About) => (about.pick?.failed ? 0 : undefined);
const failedIn = (about: About) => {
  if (about.pick) about.pick.failed = true;
};
// 저쪽 응답에서 읽는 칸. 규격마다 다른 이름을 한 모양에 모았다. 검사하지 않으므로 모두 없을 수 있다
type Reply = {
  choices?: Array<{ message?: { content?: string } }>;
  content?: Array<{ text?: string }>;
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: { thinking_tokens?: number };
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
  data?: Array<{ id?: string }>;
  models?: Array<{ name?: string }>;
  publisherModels?: Array<{ name?: string }>;
} | null;

// 판정 기준을 그대로 글로 옮긴 것. 이 글이 정확도를 크게 좌우하므로 함부로 줄이지 말 것.
// 걸러낼 것을 부정 목록으로 늘어놓으면 "Avicii - Wake Me Up (Official Video)" 같은 정상 곡까지
// 걸린다. "곡 하나냐 여러 곡이냐"로 묻고 예를 붙이는 지금 모양이 낫다.
const DEFAULT_PROMPT = `유튜브 검색 결과가 디스코드 음악봇의 자동재생에 쓸 만한지 판정한다.

song — 이 영상이 **곡 하나**를 담고 있는가?
  true : 뮤직비디오 · 공식 오디오 · 라이브 한 곡 · 애니 오프닝 한 곡
         클래식 교향곡이나 소나타는 20~40분이어도 작품 하나이므로 true
  false: 여러 곡을 이어 붙인 것(믹스 · 플레이리스트 · 메들리 · 컴필레이션 · 앨범 전곡 · 라디오)
         음악이 아닌 것(강의 · 리뷰 · 예고편 PV · 랭킹영상 · 동요 모음)

fits — 요청한 장르가 맞는가?
  아티스트와 곡을 알고 판단한다. 제목에 장르 이름이 들어 있어도 실제 장르가 다르면 false.
  장르가 "random"이면 음악이기만 하면 true.

예)
  장르=rock 제목=System Of A Down - Toxicity (Official HD Video) → song=true, fits=true
  장르=rock 제목=LMFAO - Party Rock Anthem → song=true, fits=false (제목에 rock이 있지만 일렉트로닉이다)
  장르=pop 제목=Pop Hits 2021 - Ariana Grande, Maroon 5, Taylor Swift → song=false (여러 곡)
  장르=classical 제목=Beethoven: Symphony No. 7 (41분) → song=true, fits=true (작품 하나)
  장르=lo-fi 제목=Maroon 5 - Girls Like You → song=true, fits=false (lo-fi 가 아니다)

JSON 배열로만 답한다. 설명하지 않는다.
[{"n":1,"song":true,"fits":false}, ...]`;

// 기본 대화 구성. 섹션마다 역할이 따로 있고, {{list}} 자리에 후보가 들어간다.
// 이 둘이 곧 예전 모양(system=기준 · user=목록)이라 설정을 안 건드리면 지금까지와 같다.
const DEFAULT_SECTIONS: PromptSection[] = [
  { role: "system", text: DEFAULT_PROMPT },
  { role: "user", text: "{{list}}" },
];

// 업로더 이름은 일부러 안 넣는다. 도움이 될 줄 알고 넣어 봤더니 fits 가 94% → 88% 로 떨어졌다.
// 유튜브의 그 칸은 토픽 트랙에서만 진짜 아티스트고 나머지는 채널 이름이다(`Vevo`·`Radio Mix`).
// 길이를 모르면 "길이=" 구간째 뺀다("0분"이라고 적으면 거짓을 알려 주는 것이고, "길이=" 만 남으면 모델이 더 헷갈린다)
const DEFAULT_LINE = "{{index}}. 장르={{genre}} {{#if-exist {{duration}}}}길이={{duration::m}}분 {{/}}제목={{title}}";

const ROLES = new Set(["system", "user", "assistant"]);
// 읽은 형식(줄 형식 · 프롬프트 섹션). 같은 글을 후보마다 다시 읽지 않게
const parsed = new Map<string, Node[]>();
function nodesOf(text: string, names: Names): Node[] {
  const key = `${names === LINE_NAMES ? "line" : "prompt"}:${text}`;
  let nodes = parsed.get(key);
  if (!nodes) {
    nodes = parseFormat(text, names).nodes;
    if (parsed.size > 200) parsed.clear();
    parsed.set(key, nodes);
  }
  return nodes;
}
// 빠진 칸의 기본값. 기본 설정 문서(config/defaults/ai)와 같은 값이다
const DEFAULTS = {
  timeoutMs: 60000,
  batchSize: 10,
  skipConfident: true,
  retries: 2,
  totalTimeoutMs: 0,
  retryTimeouts: false,
  retryDelayMs: 1000,
  retryDelayMaxMs: 16000,
  retryStatus: [408, 409, 429, 500, 502, 503, 504, 529],
} satisfies AiDefaults;

/**
 * 기본값 위에 설정을 차례로 얹는다. 기본값이 있는 칸을 비워 두면(null · "") 앞의 값을 쓴다.
 * 그대로 얹으면 비운 timeoutMs 가 Number(null) = 0 이 되어 부르자마자 끊긴다
 */
function withDefaults(...layers: Array<Partial<AiSettings> | null | undefined>): AiSettings {
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer || {})) {
      if ((value === null || value === "") && key in DEFAULTS) continue;
      out[key] = value;
    }
  }
  return out as AiSettings;
}

const specOf = (provider: string | undefined) => (provider && PROVIDER_SPECS[provider]) || null;
const live = (one: Partial<AiSettings> | null | undefined) => !!one?.provider && one.provider !== "off" && !!specOf(one.provider);

// 끝의 슬래시를 뗀다. `/\/+$/`로 하면 끝에 없는 슬래시 더미에 역추적이 붙어 O(n²)가 된다.
function stripTrailingSlash(text: unknown) {
  const str = String(text || "");
  let end = str.length;
  while (end > 0 && str[end - 1] === "/") end--;
  return str.slice(0, end);
}

/**
 * 어디로 보낼지. custom일 때만 설정에 적힌 주소를 쓴다.
 * 프로바이더를 골랐으면 그곳의 주소로 간다. 설정에 남은 옛 주소로 조용히 나가지 않게.
 * 주소가 틀렸거나 프록시를 앞에 두고 싶으면 custom으로 간다.
 */
function endpointOf(one: Partial<AiSettings> | null | undefined) {
  const spec = specOf(one?.provider);
  if (!spec) return "";
  return stripTrailingSlash(spec.editable ? one?.baseUrl : spec.baseUrl);
}
// 로컬 모델은 키를 안 받는다. 보내 봐야 쓸데없고, 어디로 새는지도 모른다.
const wantsKey = (one: Partial<AiSettings> | null | undefined) => !!specOf(one?.provider)?.key;

/** 키를 묶는 주소. 요청이 실제로 가는 곳이다: 버텍스는 리전으로 만든 호스트, 나머지는 프로바이더 주소(custom 은 적은 주소) */
function keyBinding(one: Partial<AiSettings> | null | undefined): string {
  const spec = specOf(one?.provider);
  if (!spec) return "";
  if (spec.dialect?.startsWith("vertex")) return `https://${vertexHost(one)}`;
  return endpointOf(one);
}

/**
 * 키는 프로바이더마다 따로다(비밀 표, store/ai-keys). 로컬에는 안 붙인다.
 * 키는 넣을 때의 주소에 묶여 있어 지금 주소가 다르면 나오지 않는다(주소를 바꾸면 다시 넣어야 한다).
 *
 * custom은 저장된 주소와 같을 때만 붙인다. 대시보드 미리보기는 저장 안 한 초안을 그대로 받는데,
 * 그 주소로 키까지 보내면 운영자 세션을 쥔 쪽이 아무 데로나 키를 흘릴 수 있다.
 */
function storedKey(one: Partial<AiSettings>): string {
  if (!wantsKey(one) || !one.provider) return "";

  if (specOf(one.provider)?.editable) {
    const saved = stripTrailingSlash(aiConfig.ai()?.baseUrl);
    if (!saved || endpointOf(one) !== saved) return "";
  }
  return aiKeys.read(one.provider, keyBinding(one));
}

async function keyFor(one: Partial<AiSettings>): Promise<string> {
  return storedKey(one);
}

async function authOf(one: Partial<AiSettings>): Promise<Record<string, string>> {
  const key = await keyFor(one);
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** 지금 쓸 수 있나. 설정을 읽는 유일한 곳이다(파일을 고치면 곧바로 반영된다). */
function settings(): AiSettings | null {
  // 검사에 걸린 칸이 하나라도 있으면 enabled: false 가 얹혀 온다. 켜지 않는다(까닭은 ai() 가 알린다)
  const saved = aiConfig.ai();
  if (saved.enabled === false) return null;
  const one = withDefaults(saved as Partial<AiSettings>);
  // 버텍스는 주소를 프로젝트·리전으로 조립하므로 baseUrl 이 없다
  if (!live(one) || !one.model) return null;
  if (!specOf(one.provider)?.dialect?.startsWith("vertex") && !endpointOf(one)) return null;
  // 프롬프트는 딴 문서다("ai-prompt"). 설정 문서에는 안 섞는다
  return { ...one, prompt: aiConfig.aiPrompt() };
}

// `__proto__` 한 마디면 Object.prototype이 통째로 오염된다. 점 경로는 설정 글뿐 아니라
// 모델 레지스트리(받아 오는 남의 데이터)의 mapsTo.path로도 들어오므로 여기서 막는다.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const safeKeys = (path: string) => {
  const keys = String(path).split(".");
  return keys.some((one) => UNSAFE_KEYS.has(one)) ? null : keys;
};

function setPath(obj: Body, path: string, value: unknown): Body {
  const keys = safeKeys(path);
  if (!keys) return obj;
  let at = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    // safeKeys 가 이미 걸렀지만 여기서도 본다. 분석기가 알아보는 자리는 대입 바로 옆이다
    if (k === "__proto__" || k === "constructor" || k === "prototype") return obj;
    // 앞 줄이 같은 자리에 값을 넣어 뒀으면 덮어쓴다. 안쪽에 더 넣을 수 없는 모양이다
    if (!at[k] || typeof at[k] !== "object" || Array.isArray(at[k])) at[k] = {};
    at = at[k] as Body;
  }
  const last = keys[keys.length - 1];
  if (last === "__proto__" || last === "constructor" || last === "prototype") return obj;
  at[last] = value;
  return obj;
}

/** 점 경로로 지운다. 없는 길이면 아무 일도 안 한다. */
function delPath(obj: Body, path: string) {
  const keys = safeKeys(path);
  if (!keys) return;
  let at: Body | undefined = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (k === "__proto__" || k === "constructor" || k === "prototype") return;
    const next: unknown = at?.[k];
    if (!next || typeof next !== "object") return;
    at = next as Body;
  }
  const last = keys[keys.length - 1];
  if (last === "__proto__" || last === "constructor" || last === "prototype") return;
  delete at[last];
}

// 파이썬 꼴 키워드를 JSON 이 읽을 수 있게 바꾼다. 따옴표 안은 건드리지 않는다.
const RELAXED: Array<[string, string]> = [
  ["True", "true"],
  ["False", "false"],
  ["None", "null"],
];
function relaxJson(text: string) {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) out += text[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    // 낱말 경계에서만 바꾼다. Nonetype 같은 것을 건드리면 안 된다
    const edge = (c: string | undefined) => !c || !/[A-Za-z0-9_$]/.test(c);
    const hit = RELAXED.find(([word]) => text.startsWith(word, i) && edge(text[i - 1]) && edge(text[i + word.length]));
    if (hit) {
      out += hit[1];
      i += hit[0].length - 1;
    } else out += ch;
  }
  return out;
}

function readJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    /* 그대로는 JSON 이 아니다. 흔한 흠을 고쳐 다시 본다 */
  }
  const relaxed = relaxJson(text);
  if (relaxed !== text) {
    try {
      return { ok: true, value: JSON.parse(relaxed) };
    } catch {
      /* 고쳐도 JSON 이 아니다 */
    }
  }
  return { ok: false };
}

/**
 * 추가 파라미터. 한 줄에 하나씩. 서비스마다 이름도 자리도 달라 글로 받는다.
 *
 *   key=value            그대로 (true · false · null · 숫자는 알아서 바꾼다)
 *   key="value"          따옴표로 두르면 숫자처럼 보여도 글자다
 *   a.b.c=value          점으로 안쪽 칸에 넣는다 (thinking.budget_tokens 처럼)
 *   key=json::{...}      JSON 으로 읽어 넣는다 (객체·배열)
 *   header::Name=value   본문이 아니라 요청 헤더에 넣는다
 *   key={{none}}         그 값을 아예 안 보낸다 (header::Name={{none}} 이면 헤더를 뺀다)
 *   # 주석
 *
 * RisuAI와 같은 입력법이다. 못 읽은 줄은 조용히 버리지 않고 problems로 돌려준다.
 */
function parseExtra(text: unknown): Extra {
  const out: Extra = { body: {}, headers: {}, drop: [], dropHeaders: [], problems: [] };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) readExtraLine(line, out);
  }
  return out;
}

// 한 줄(이름=값)을 담는다. 못 읽으면 까닭을 problems 에
function readExtraLine(line: string, out: Extra) {
  const at = line.indexOf("=");
  if (at < 1) return out.problems.push(`이름이 없습니다: ${line}`);
  const name = line.slice(0, at).trim();
  const value = line.slice(at + 1).trim();
  const header = /^header::/i.test(name) ? name.slice(8).trim() : null;

  // {{none}} 을 header:: 보다 먼저 본다. 안 그러면 헤더에 "{{none}}" 을 넣게 된다
  if (value === "{{none}}") return header !== null ? out.dropHeaders.push(header) : out.drop.push(name);
  if (header !== null) {
    out.headers[header] = value;
    return;
  }
  if (value === "") return out.problems.push(`값이 없습니다: ${name}`);
  if (!safeKeys(name)) return out.problems.push(`쓸 수 없는 이름입니다: ${name}`);

  if (value.startsWith("json::")) {
    const got = readJson(value.slice(6));
    if (got.ok) setPath(out.body, name, got.value);
    else out.problems.push(`JSON 으로 못 읽었습니다: ${name}`);
    return;
  }
  setPath(out.body, name, scalarOf(value));
}

// 값 글 → 값. 따옴표로 싸면 글자, true · false · null · 수는 그 값, 나머지는 글자
function scalarOf(value: string): unknown {
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  if (quoted && value.length >= 2) return value.slice(1, -1);
  if (value === "true" || value === "false") return value === "true";
  if (value === "null") return null;
  return Number.isNaN(Number(value)) ? value : Number(value);
}

/**
 * 후보 한 줄(config/schema 의 검사 · 대시보드 미리보기와 같은 해석기 rules/line-format). 길이 칸 이름은 후보(durationSec)와 트랙(duration)이 다르다. 둘 다 받는다.
 * 모르는 이름은 적힌 그대로 둔다(오타를 조용히 지우면 왜 사라졌는지 알 길이 없다. 검사가 짚는다)
 */
function renderLine(list: ListFormat | undefined, cand: Judged, genre: string | undefined, i: number) {
  const seconds = Number(cand.durationSec ?? cand.duration);
  return renderNodes(nodesOf(String(list?.lineFormat || DEFAULT_LINE), LINE_NAMES), {
    index: () => String(i + 1),
    genre: () => genre ?? "",
    title: () => String(cand.title ?? ""),
    duration: (arg) => formatDuration(seconds, arg),
  }).trim();
}

/** 실제로 보낼 messages. 미리보기도 이것을 쓴다. 화면이 흉내 내면 어긋난다. */
function buildMessages(one: AiSettings, batch: Judged[], genre: string | undefined) {
  const list = batch.map((cand, i) => renderLine(one.list, cand, genre, i)).join("\n");
  const sections = Array.isArray(one.prompt) && one.prompt.length ? one.prompt : DEFAULT_SECTIONS;

  return sections
    .map((section, at) => ({
      // 모르는 역할은 system 으로 떨어뜨린다. 저쪽이 400을 주느니 낫다
      role: ROLES.has(section?.role) ? section.role : "system",
      // 장르는 한 요청에 하나다(모든 줄이 같은 값을 쓴다). 그래서 프롬프트에서도 쓸 수 있다
      content: renderNodes(nodesOf(String(section?.text ?? ""), PROMPT_NAMES), { list: () => list, genre: () => genre ?? "" }),
      // 빈 섹션은 아래에서 빠진다. 화면이 이름표를 붙일 때 번호로 짝지으면 밀리므로
      // 어느 섹션에서 나왔는지를 달고 나간다.
      at,
    }))
    .filter((message) => message.content.trim());
}

/**
 * 제미니 네이티브 본문. AI 스튜디오와 버텍스가 같은 모양을 쓰고 갈리는 것은 주소와 인증뿐이다.
 * messages가 아니라 contents/parts이고 assistant를 model이라 부른다. system은 systemInstruction,
 * 온도 같은 것은 generationConfig 안에 있다(추가 파라미터도 경로를 적어 넣는다).
 */
function geminiBody(_one: AiSettings, messages: Wire[]): Body {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  // systemInstruction 을 앞에 둔다. 저쪽은 이름 있는 칸이라 순서를 안 보지만,
  // 요청 로그는 사람이 읽는다. 지시가 목록 뒤에 오면 거꾸로 읽힌다.
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
  };
}
const geminiAnswer = (json: Reply) => (json?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join("");

/**
 * 저쪽 규격의 차이를 여기 한 곳에 모은다.
 * 갈래마다 이 여섯 가지만 답하면 나머지 코드(판정·미리보기·테스트)는 그대로 돈다.
 *
 *   chatUrl   생성 요청을 보낼 주소
 *   modelsUrl 모델 목록 주소 (없으면 목록을 못 받는 곳이다)
 *   headers   그 규격이 요구하는 헤더 + 인증 (토큰을 받아야 할 수 있어 async)
 *   body      우리 {role, content} 목록을 저쪽 본문으로
 *   answerOf  응답에서 모델이 쓴 글
 *   modelsOf  모델 목록 응답에서 이름들
 */
type Dialect = {
  chatUrl(one: AiSettings): string;
  modelsUrl(one: AiSettings): string;
  /** 앞 주소가 404 면 차례로 물을 주소 */
  modelsUrlFallbacks?(one: AiSettings): string[];
  /** live: false 면 밖으로 나가지 않는다(미리보기). 토큰을 받아야 하는 곳은 자리표시로 채운다 */
  headers(one: AiSettings, opts?: { live?: boolean }): Promise<Record<string, string>>;
  body(one: AiSettings, messages: Wire[]): Body;
  answerOf(json: Reply): string;
  modelsOf(json: Reply): Array<string | undefined>;
  usageOf?(json: Reply): Usage | null;
};

const DIALECTS: Record<string, Dialect> = {
  openai: {
    chatUrl: (one) => `${endpointOf(one)}/chat/completions`,
    modelsUrl: (one) => `${endpointOf(one)}/models`,
    headers: async (one) => ({ "Content-Type": "application/json", ...(specOf(one.provider)?.headers || {}), ...(await authOf(one)) }),
    body: (one, messages) => ({ model: one.model, messages }),
    answerOf: (json) => json?.choices?.[0]?.message?.content || "",
    modelsOf: (json) => (json?.data || []).map((m) => m?.id),
    usageOf: (json) => pickUsage(json?.usage?.prompt_tokens, json?.usage?.completion_tokens, json?.usage?.completion_tokens_details?.reasoning_tokens, { cached: json?.usage?.prompt_tokens_details?.cached_tokens }),
  },

  /**
   * 앤트로픽 네이티브(/v1/messages). OpenAI와 다른 것 셋:
   * system이 메시지가 아니라 본문 맨 위 칸, max_tokens가 필수(없으면 400),
   * 인증이 Authorization이 아니라 x-api-key.
   */
  anthropic: {
    chatUrl: (one) => `${endpointOf(one)}/messages`,
    modelsUrl: (one) => `${endpointOf(one)}/models`,
    headers: async (one) => {
      const key = await keyFor(one);
      return { "Content-Type": "application/json", "anthropic-version": ANTHROPIC_VERSION, ...(key ? { "x-api-key": key } : {}) };
    },
    body: (one, messages) => {
      // system 은 여럿일 수 있다(섹션을 나눠 적었을 수 있다). 붙여서 한 칸에 넣는다
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      return {
        model: one.model,
        // 저쪽에서 필수라 늘 붙인다. 프로필이 아는 모델이면 그쪽 값이 이긴다.
        max_tokens: ANTHROPIC_MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      };
    },
    answerOf: (json) => (json?.content || []).map((part) => part?.text || "").join(""),
    modelsOf: (json) => (json?.data || []).map((m) => m?.id),
    usageOf: (json) => pickUsage(anthropicInput(json?.usage), json?.usage?.output_tokens, json?.usage?.output_tokens_details?.thinking_tokens, { cached: json?.usage?.cache_read_input_tokens }),
  },

  /**
   * 구글 AI 스튜디오. 제미니 네이티브를 쓴다.
   * 호환층(/v1beta/openai)으로는 추론 설정이 어긋나고, 모델 프로필의 경로도 네이티브 기준이다.
   */
  gemini: {
    chatUrl: (one) => `${endpointOf(one)}/models/${one.model || ""}:generateContent`,
    modelsUrl: (one) => `${endpointOf(one)}/models`,
    headers: async (one) => {
      const key = await keyFor(one);
      return { "Content-Type": "application/json", ...(key ? { "x-goog-api-key": key } : {}) };
    },
    body: geminiBody,
    answerOf: geminiAnswer,
    usageOf: (json) => pickUsage(json?.usageMetadata?.promptTokenCount, json?.usageMetadata?.candidatesTokenCount, json?.usageMetadata?.thoughtsTokenCount, { thoughtsInOutput: false, cached: json?.usageMetadata?.cachedContentTokenCount }),
    // { models: [{ name: "models/gemini-3.7-flash" }] }
    modelsOf: (json) =>
      (json?.models || []).map((m) =>
        String(m?.name || "")
          .split("/")
          .pop(),
      ),
  },

  /**
   * 버텍스 AI. 제미니 네이티브이되 주소를 프로젝트·리전·모델로 조립한다(baseUrl이 없다).
   * 인증도 API 키가 아니라 서비스 계정에서 받은 액세스 토큰이다(googleAuth).
   */
  vertex: {
    chatUrl: (one) => vertexChatUrl(one, vertexProject(one), one.model || ""),
    // 모델 목록은 생성과 주소 체계가 다르다. 프로젝트·리전이 붙지 않는 쪽이라
    // 생성 주소를 그대로 쓰면 404 다. API 버전이 갈려 있어 차례로 물어본다.
    modelsUrl: (one) => `https://${vertexHost(one)}/v1beta1/publishers/google/models`,
    modelsUrlFallbacks: (one) => [`https://${vertexHost(one)}/v1/publishers/google/models`, `${vertexBase(one)}/publishers/google/models`],
    headers: async (one, { live = true } = {}) => {
      if (!live) return { "Content-Type": "application/json", Authorization: `Bearer ${REDACTED}` };
      const token = await googleAuth.accessToken(storedKey(one), { timeoutMs: Number(one.timeoutMs), fetch: send });
      return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    },
    body: geminiBody,
    answerOf: geminiAnswer,
    usageOf: (json) => pickUsage(json?.usageMetadata?.promptTokenCount, json?.usageMetadata?.candidatesTokenCount, json?.usageMetadata?.thoughtsTokenCount, { thoughtsInOutput: false, cached: json?.usageMetadata?.cachedContentTokenCount }),
    // { publisherModels: [{ name: "publishers/google/models/gemini-3-pro" }] }
    modelsOf: (json) =>
      (json?.publisherModels || []).map((m) =>
        String(m?.name || "")
          .split("/")
          .pop(),
      ),
  },
};

// 주소 조립은 rules/vertex-url(대시보드가 보여 주는 주소와 같은 규칙). 프로젝트는 설정에 없으면 서비스 계정 키에서
const vertexProject = (one: AiSettings) => String(one?.project || "").trim() || googleAuth.projectOf(storedKey(one));
const vertexBase = (one: AiSettings) => vertexBaseOf(one, vertexProject(one));

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 1024;

/**
 * 응답이 알려 준 실제 토큰 수. 없으면 null. 추산으로 메우지 않는다.
 *
 * 사고 토큰을 어디에 넣는지가 회사마다 다르다(OpenAI·앤트로픽은 출력 안, 제미니는 따로).
 * 출력은 늘 사고까지 합친 값으로 맞춰 둔다. 화면이 규격을 알 필요가 없게. 입력은 캐시에서 읽은 것(cached)까지 합친 값이다
 */
const pickUsage = (input: unknown, output: unknown, thoughts: unknown, { thoughtsInOutput = true, cached }: { thoughtsInOutput?: boolean; cached?: unknown } = {}): Usage | null => {
  if (typeof input !== "number") return null;
  const think = typeof thoughts === "number" ? thoughts : null;
  let out = typeof output === "number" ? output : null;
  if (out !== null && think !== null && !thoughtsInOutput) out += think;
  return { input, output: out, thoughts: think, cached: typeof cached === "number" ? cached : null };
};

/** 앤트로픽의 입력은 캐시 읽기 · 쓰기를 빼고 센다. 다른 곳처럼 합친 값으로 */
function anthropicInput(usage: NonNullable<Reply>["usage"]): number | undefined {
  if (typeof usage?.input_tokens !== "number") return undefined;
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

const dialectOf = (one: Partial<AiSettings> | null | undefined): Dialect => DIALECTS[specOf(one?.provider)?.dialect || "openai"] || DIALECTS.openai;

// 배열을 바라는 칸에 글자를 보내면 400이다. 설정을 손으로 고쳤거나 프로필이 바뀌었을 수 있어 한 번 본다.
function typeOk(type: string | undefined, value: unknown) {
  if (type === "stringArray") return Array.isArray(value);
  if (type === "json") return value !== null && typeof value === "object";
  if (type === "integer" || type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string") return typeof value === "string";
  return true;
}

const usable = (field: ModelField, value: unknown) => {
  if (value === undefined || value === "") return false;
  if (field.enum && !field.enum.some((e) => e.value === value)) return false;
  return typeOk(field.type, value);
};

/**
 * 이 요청이 몇 토큰짜리인지. 클로드는 공개 토크나이저가 없어 저쪽에 물어본다.
 * 무료이고, tik 로 어림하면 한국어에서 35% 가 모자란다.
 */
async function countTokens(one: AiSettings, messages: Wire[]): Promise<TokenCount | null> {
  try {
    const spec = specOf(one.provider);
    const by = tokens.tokenizerFor(spec?.registry, one.model);

    // 저쪽에 묻는 것은 앤트로픽에 직접 붙을 때뿐이다. 게이트웨이(OpenRouter 등)의 키를 앤트로픽으로 보내지 않는다
    if (by === "claude" && spec?.dialect === "anthropic") {
      const exact = await tokens.countByAnthropic(messages, { model: one.model, apiKey: await keyFor(one), timeoutMs: Number(one.timeoutMs), fetch: send });
      if (exact !== null) return { total: exact, body: exact - tokens.FRAMING.anthropic.perRequest, by: "claude", exact: true };
    }
    return await tokens.countMessages(messages, by, spec?.dialect || "openai");
  } catch {
    return null; // 못 세도 요청은 나가야 한다
  }
}

/** 모델이 받는다고 적혀 있는 칸만 싣는다. 안 받는 칸을 보내면 400이므로 모델을 바꾸면 저절로 빠져야 한다. */
function withParams(body: Body, one: AiSettings): Body {
  const registry = specOf(one.provider)?.registry;
  if (!registry || !one.model) return body;

  const out = deepMerge(body, models.defaultsOf(registry, one.model));
  // 사용자가 안 고른 칸은 프로필이 적어 둔 기본값으로 간다. 값은 모델별로 따로 저장된다.
  // 모델을 바꿨는데 앞 모델에서 고른 값이 따라오면 안 된다.
  const picked = one.params?.[one.model] || {};
  const fields = models.fieldsOf(registry, one.model);
  const valueOf = (field: ModelField) => [picked[field.key], field.default].find((one) => usable(field, one));

  for (const field of fields) {
    // 화면에서 가려진 칸은 보내지 않는다. 켰다 끈 값이 남아 있으면 저쪽이 거절한다.
    // top_logprobs 는 logprobs 가 꺼져 있으면 400 이다.
    const cond = field.showIf;
    if (cond) {
      const owner = fields.find((one) => one.key === cond.key);
      if (!owner || valueOf(owner) !== cond.equals) continue;
    }
    // 고른 값이 못 쓸 것이면(종류가 틀리거나 그 모델이 안 받는 값) 프로필 기본값으로 떨어진다
    const value = valueOf(field);
    if (value !== undefined) setPath(out, field.path, value);
  }
  return out;
}

/** 보낼 것 한 벌. 미리보기도 이것을 쓴다. */
// 판정 요청은 토큰을 세지 않는다. 판정은 그 수를 안 쓰고, 세기가 이벤트 루프를 멈춘다(gemma 세기가 요청마다 수백 ms)
async function buildRequest(one: AiSettings, batch: Judged[], genre: string | undefined, { live = true }: { live?: boolean } = {}) {
  const dialect = dialectOf(one);
  const extra = parseExtra(one.extra);
  const messages = buildMessages(one, batch, genre);
  // `at`(원래 섹션 번호)은 화면이 이름표를 붙이는 데만 쓴다. 저쪽에 보낼 것에는 들어가면 안 된다.
  const wire = messages.map(({ role, content }) => ({ role, content }));

  // 추가 파라미터가 맨 나중이다. 프로필이 모르는 것을 넣는 비상구이므로 마지막 말을 갖는다
  const body = withExtra(withParams(dialect.body(one, wire), one), extra);
  return { url: dialect.chatUrl(one), headers: headersWith(await dialect.headers(one, { live }), extra), body, messages, wire, problems: extra.problems };
}

/** 안쪽 칸까지 합친다. 점 표기로 만든 중첩을 통째로 덮어쓰지 않게. */
function deepMerge(base: Body, add: Body): Body {
  const out: Body = { ...base };
  for (const [key, value] of Object.entries(add)) {
    if (UNSAFE_KEYS.has(key)) continue; // setPath 와 같은 이유
    const mine = out[key];
    const both = (v: unknown): v is Body => !!v && typeof v === "object" && !Array.isArray(v);
    out[key] = both(mine) && both(value) ? deepMerge(mine, value) : value;
  }
  return out;
}

/** 헤더를 얹고, header::Name={{none}} 으로 지우라고 한 것을 뺀다. 이름의 대소문자는 안 가린다. */
function headersWith(base: Record<string, string>, extra: Extra) {
  const out: Record<string, string> = { ...base, ...extra.headers };
  for (const name of extra.dropHeaders || []) {
    for (const key of Object.keys(out)) if (key.toLowerCase() === String(name).toLowerCase()) delete out[key];
  }
  return out;
}

/**
 * 경로는 언제나 본문 맨 위부터다. 다이얼렉트마다 다른 자리로 넣어 주지 않는다.
 * 버텍스처럼 안쪽 칸을 쓰는 곳은 `generationConfig.topP=0.9` 로 적는다.
 * 모델 프로필의 mapsTo.path 도 같은 규칙이라, 두 길이 어긋나지 않는다.
 */
function withExtra(body: Body, extra: Extra) {
  const out = deepMerge(body, extra.body);
  // {{none}} 은 얹은 뒤에 지워야 앤트로픽 max_tokens 처럼 늘 붙는 것도 뺄 수 있다
  for (const path of extra.drop) delPath(out, path);
  return out;
}

// gemma 계열은 토크나이저의 공백 표시(U+2581 ▁)를 답에 그대로 흘리는 일이 있다.
// JSON.parse 가 `Unexpected token '▁'` 로 죽으므로 들여쓰기 자리의 그것만 공백으로 되돌린다.
// 같은 자리에 오는 다른 폭의 공백(U+00A0 · U+3000)도 함께 본다.
const ODD_SPACE = new RegExp("[\u2581\u00a0\u3000]", "g");
const despace = (text: string) => text.replace(ODD_SPACE, " ");

/**
 * 답에서 곡별 판정을 읽는다. 작은 모델은 ```json 울타리나 앞말 · 뒷말을 곧잘 붙이므로
 * 대괄호로 싼 덩어리 중 판정 모양(`n` 이 있는 표의 배열)인 마지막 것을 집는다. 설명 속 `[1]` 같은 것은 건너뛴다.
 * 못 읽으면 null. 부르는 쪽이 원문을 그대로 보여 준다.
 */
function readVerdicts(text: unknown, count: number): Array<Verdict | null> | null {
  const verdicts = arraysIn(despace(String(text || "")))
    .map(parseArray)
    .filter((arr): arr is Array<Record<string, unknown>> => !!arr && arr.some((v) => v && typeof v === "object" && "n" in v))
    .at(-1);
  if (!verdicts) return null;
  const out: Array<Verdict | null> = new Array(count).fill(null);
  for (const verdict of verdicts) {
    const at = Number(verdict?.n) - 1;
    if (at >= 0 && at < count) out[at] = { song: yes(verdict.song), fits: yes(verdict.fits) };
  }
  return out;
}

// 참은 true 와 글자 "true" 뿐이다. "false" 를 !! 로 읽으면 참이 된다
const yes = (value: unknown) => value === true || value === "true";

function parseArray(text: string): Array<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null; // 설명 속 대괄호다
  }
}

// 맨 바깥 대괄호 덩어리들. 따옴표 안의 괄호는 세지 않는다
function arraysIn(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\\") i++;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = depth > 0;
    else if (ch === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "]" && depth > 0) {
      depth--;
      if (depth === 0) out.push(text.slice(start, i + 1));
    }
  }
  return out;
}

/**
 * 판정 하나를 못 해 규칙만으로 고른다. 재시도까지 모두 실패한 판정마다 한 줄(재시도 하나하나는 debug).
 * 켜 둔 기능이 한도 · 서버 오류로 죽어 있으면 평소 로그 수준에서 보여야 한다
 */
function skipped(error: unknown) {
  const calls = error instanceof AskFailure && error.calls > 1 ? `(${error.calls}번 불러 모두 실패)` : "";
  log.warn(`AI 보조 실패${calls}: ${messageOf(error)}. 이번 판정은 규칙만으로 고릅니다`);
}

/** 판정 하나(재시도 · 다시 묻기까지 끝낸 것)의 실패. reason 은 까닭, detail 은 저쪽 문구, calls 는 부른 수 */
class AskFailure extends Error {
  reason: string;
  detail: string;
  calls: number;
  constructor(reason: string, detail: string, calls: number) {
    super(detail ? `${reason} (${detail})` : reason);
    this.reason = reason;
    this.detail = detail;
    this.calls = calls;
  }
}

/** 부르기 한 번의 결과. 실패면 다시 해도 되는지와 저쪽이 기다리라고 한 시간 */
type Attempt = { ok: true; verdicts: Array<Verdict | null> } | { ok: false; reason: string; detail: string; retry: boolean; adviceMs?: number | null; unreadable?: boolean };

// 판정 하나의 상한(totalTimeoutMs)으로 끊었을 때의 까닭. 부르기 한 번의 시간 초과와 가른다
const OVER_TOTAL = new Error("판정 상한");

/** 리퀘스트 로그에 적을 것: 응답의 토큰 · 2xx 인데 판정을 읽지 못한 까닭 */
function judgeCall(one: AiSettings, size: number): Pick<Call, "provider" | "model" | "tokensOf" | "explain"> {
  return {
    provider: String(one.provider),
    model: String(one.model ?? ""),
    tokensOf: (json) => dialectOf(one).usageOf?.(json as Reply) ?? null,
    explain: (raw) => {
      try {
        return readVerdicts(dialectOf(one).answerOf(JSON.parse(raw) as Reply) || "", size) ? undefined : "판정을 읽지 못함";
      } catch {
        return "판정을 읽지 못함(JSON 이 아닌 답)";
      }
    },
  };
}

/** 부르기 한 번. calls: 판정 하나 안에서 몇 번째 부르기인가(리퀘스트 로그의 시도) */
async function attempt(one: AiSettings, request: Awaited<ReturnType<typeof buildRequest>> & { size: number }, total: AbortSignal | null, { calls = 1, genre }: { calls?: number; genre?: string } = {}): Promise<Attempt> {
  const perCall = AbortSignal.timeout(Number(one.timeoutMs));
  const signal = total ? AbortSignal.any([perCall, total]) : perCall;
  try {
    const call: Call = { source: "autoplay", attempt: calls, genre, candidates: request.size, ...judgeCall(one, request.size) };
    const { res, text: raw } = await sendLogged(send, call, request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal });

    // 저쪽이 왜 거절했는지는 본문에만 있다(모델 이름 오타 · 남은 토큰 없음 · 사용량 초과 …).
    // 그대로 싣되 키는 가린다. 거절 응답에 보낸 값을 되비추는 서비스가 있다.
    if (!res.ok) {
      const text = mask(raw);
      const { key, detail } = retry.summaryOf(res.status, text);
      const again = one.retryStatus.map(Number).includes(res.status) && !retry.exhausted(text);
      return { ok: false, reason: key, detail, retry: again, adviceMs: retry.adviceMs(res.headers, text) };
    }

    const text = dialectOf(one).answerOf(JSON.parse(raw) as Reply) || "";
    const verdicts = readVerdicts(text, request.size);
    if (verdicts) return { ok: true, verdicts };
    return { ok: false, reason: "판정을 읽지 못함", detail: `답 ${text.length}자: ${text.slice(0, 160)}`, retry: false, unreadable: true };
  } catch (error) {
    if (total?.aborted) return { ok: false, reason: "판정 상한 초과", detail: `${Number(one.totalTimeoutMs) / 1000}초`, retry: false };
    if (perCall.aborted) return { ok: false, reason: "시간 초과", detail: `${Number(one.timeoutMs) / 1000}초`, retry: !!one.retryTimeouts };
    if (errorKind(error) === "network-error") return { ok: false, reason: "네트워크 오류", detail: messageOf(error), retry: true };
    // 200 인데 본문이 JSON 이 아니다(앞에 둔 프록시의 안내 쪽 등). 판정을 못 읽은 답과 같이 한 번 더 묻는다
    if (error instanceof SyntaxError) return { ok: false, reason: "판정을 읽지 못함", detail: `JSON 이 아닌 답(${messageOf(error)})`, retry: false, unreadable: true };
    return { ok: false, reason: messageOf(error), detail: "", retry: false };
  }
}

/** 다음 재시도 앞의 대기. 다시 하지 않을 것이면 까닭 */
function waitBefore(one: AiSettings, used: number, failed: Attempt & { ok: false }, endsAt: number | null): { ms: number } | { stop: string } {
  if (!failed.retry) return { stop: "" };
  if (used >= Number(one.retries)) return { stop: "" };
  const maxMs = Number(one.retryDelayMaxMs);
  if (failed.adviceMs != null && failed.adviceMs > maxMs) return { stop: `서버가 ${Math.ceil(failed.adviceMs / 1000)}초 뒤라고 함, 대기 상한 ${maxMs / 1000}초` };
  const ms = failed.adviceMs ?? retry.backoffMs(used + 1, Number(one.retryDelayMs), maxMs);
  if (endsAt !== null && Date.now() + ms >= endsAt) return { stop: "판정 상한까지 남은 시간이 모자람" };
  return { ms };
}

/**
 * 후보 묶음 하나를 판정한다. 실패하면 설정대로 다시 부르고(retries · 대기), 끝내 실패하면 AskFailure.
 * 판정을 읽지 못한 답은 재시도와 따로 한 번만 곧바로 다시 묻는다. retries 를 0 으로 주면 한 번만 부른다
 */
async function askBatch(one: AiSettings, cands: Judged[], genre: string | undefined, { retries = Number(one.retries) }: { retries?: number } = {}) {
  const request = { ...(await buildRequest(one, cands, genre)), size: cands.length };
  const totalMs = Number(one.totalTimeoutMs);
  const total = totalMs > 0 ? new AbortController() : null;
  const timer = total ? setTimeout(() => total.abort(OVER_TOTAL), totalMs) : null;
  const endsAt = total ? Date.now() + totalMs : null;
  const limited = { ...one, retries };
  try {
    let used = 0;
    let reasked = false;
    for (let calls = 1; ; calls++) {
      const got = await attempt(limited, request, total?.signal ?? null, { calls, genre });
      if (got.ok) return got.verdicts;
      if (got.unreadable && !reasked) {
        reasked = true;
        log.debug(`AI 보조: 판정을 읽지 못해 한 번 더 묻습니다(${got.detail.slice(0, 80)})`);
        continue;
      }
      const wait = waitBefore(limited, used, got, endsAt);
      if ("stop" in wait) throw new AskFailure(got.reason, [got.detail, wait.stop].filter(Boolean).join(". "), calls);
      used++;
      log.debug(`AI 보조 재시도 ${used}/${retries}(${got.reason}) ${(wait.ms / 1000).toFixed(1)}초 뒤`);
      await sleep(wait.ms);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 후보 목록에서 모델이 아니라고 한 것을 걸러낸다.
 * 실패하면 받은 목록을 그대로 돌려준다. 판정을 못 했다고 곡을 버리면 모델이 죽었을 때 자동재생이 멈춘다.
 *
 * @param {Array<{title: string, durationSec?: number}>} candidates 순위가 매겨진 후보
 * @param {{genre?: string, confident?: boolean}} about
 */
async function filter<T extends Judged>(candidates: T[] | null | undefined, about: About = {}): Promise<T[]> {
  const one = settings();
  if (!one || !candidates?.length) return candidates || [];
  // 규칙이 이미 확신한다면 물을 이유가 없다(설정에서 끌 수 있다)
  if (one.skipConfident && about.confident) return candidates;

  const size = Math.max(1, Number(one.batchSize));
  const kept: T[] = [];
  for (let at = 0; at < candidates.length; at += size) {
    const batch = candidates.slice(at, at + size);
    let verdicts: Array<Verdict | null>;
    try {
      verdicts = await askBatch(one, batch, about.genre, { retries: retriesIn(about) });
    } catch (error) {
      // 남은 후보는 규칙이 고른 그대로 둔다. 이미 판정한 앞 묶음은 살린다
      failedIn(about);
      skipped(error);
      kept.push(...candidates.slice(at));
      break;
    }
    // 답을 못 받은 자리는 살린다. 모델이 빠뜨린 것을 떨어뜨릴 이유가 없다
    batch.forEach((cand, i) => {
      const verdict = verdicts[i];
      if (!verdict || (verdict.song && verdict.fits)) kept.push(cand);
    });
  }

  if (kept.length !== candidates.length) log.debug(`AI 보조: ${candidates.length}개 중 ${kept.length}개 남김${about.genre ? ` [${about.genre}]` : ""}`);
  // 전부 떨어졌다면 모델이 너무 박한 것이다. 규칙이 고른 것을 쓴다.
  return kept.length ? kept : candidates;
}

/**
 * 곡 하나를 물어본다. 규칙이 이미 하나로 좁혀 놓은 자리(키워드 경로)용.
 * `filter`와 달리 아니라고 하면 정말로 버린다. 한 곡이라 "전부 떨어지면 되돌린다"가 성립하지 않는다.
 * 못 물어본 경우는 그대로 살린다.
 *
 * @returns {Promise<boolean>} 틀어도 되는가
 */
async function accepts(candidate: Judged | null | undefined, about: About = {}): Promise<boolean> {
  const one = settings();
  if (!one || !candidate) return true;
  if (one.skipConfident && about.confident) return true;

  try {
    const [verdict] = await askBatch(one, [candidate], about.genre, { retries: retriesIn(about) });
    if (!verdict) return true; // 판정을 못 읽었다. 버릴 근거가 없다
    if (verdict.song && verdict.fits) return true;
    log.debug(`AI 보조가 거름(${verdict.song ? "장르가 다름" : "곡 하나가 아님"})${about.genre ? ` [${about.genre}]` : ""}: ${candidate.title}`);
    return false;
  } catch (error) {
    failedIn(about);
    skipped(error);
    return true;
  }
}

/**
 * 모델 목록만 받아 온다(`GET {baseUrl}/models`). 추론을 안 돌리므로 토큰이 안 든다.
 * 주소·키·네트워크가 맞는지는 이것으로 다 알 수 있고, 받아 온 목록은 화면의 모델 칸을 채우는 데도 쓴다.
 */
async function listModels(draft: Draft): Promise<ModelsCheck> {
  const one = withDefaults(draft);
  if (!live(one)) return { ok: false, reason: `프로바이더가 꺼져 있습니다(provider=${one.provider || "off"}).` };

  // 키가 있어야 하는데 없다. 저쪽에 물어 봐야 거절(401)이라 묻지 않고 받아 둔 목록으로 채운다
  if (wantsKey(one) && !storedKey(one)) return withPreset(one, { ok: false, reason: "키가 없어 저쪽에 묻지 않았습니다." });

  const dialect = dialectOf(one);
  const first = dialect.modelsUrl(one);
  if (!first) return { ok: false, reason: "엔드포인트 주소가 비어 있습니다(custom 이면 직접 적어야 합니다)." };

  // 같은 곳인데 API 버전마다 주소 체계가 다른 데가 있다(버텍스). 404 면 다음 것을 물어본다.
  // 그래야 어느 버전을 쓰는 프로젝트든 목록이 뜬다. 404 가 아니면 그 답이 곧 사실이다.
  const urls = [first, ...(dialect.modelsUrlFallbacks?.(one) || [])];
  const started = Date.now();
  let url = first; // 실패해도 어디를 불렀는지는 알려 줘야 한다(catch 에서 쓴다)

  try {
    const asked = await askModels(urls, await dialect.headers(one), one, (tried) => (url = tried));
    const { res, text } = asked;
    const took = Date.now() - started;
    if (!res.ok) return withPreset(one, { ok: false, url, status: res.status, response: text, tookMs: took, reason: `HTTP ${res.status}` });

    // 모양은 갈래마다 다르다. 못 읽어도 목록만 못 채우고 연결은 된 것이다.
    let all: string[] = [];
    try {
      all = (dialect.modelsOf(JSON.parse(text)) || []).filter((id): id is string => typeof id === "string");
    } catch {
      /* 목록을 못 읽어도 응답 자체는 보여 준다 */
    }

    // 이름을 코드에 적지 않는다. 대신 안 쓸 것을 설정에서 가린다. 저쪽 목록에는
    // 영상·이미지 모델이나 한참 옛 모델이 섞여 나온다.
    return { ok: true, url, status: res.status, ...visibleModels(all, one), response: text, tookMs: took };
  } catch (error) {
    return withPreset(one, { ok: false, url, status: null, response: mask(messageOf(error)), tookMs: Date.now() - started, reason: mask(messageOf(error)) });
  }
}

/**
 * 목록에서 가릴 이름. `*` 만 있는 아주 좁은 글롭이다. 정규식을 설정 파일에 적게 하면
 * 오타 하나에 목록이 통째로 비고, 왜 빈지 알 길이 없다.
 */
// 주소를 차례로 묻는다. 404 면 다음 주소로. at 은 지금 묻는 주소를 알린다(실패해도 어디를 불렀는지 남긴다)
async function askModels(urls: string[], headers: Record<string, string>, one: AiSettings, at: (url: string) => void) {
  for (const [i, url] of urls.entries()) {
    at(url);
    const last = (res: Response) => res.ok || res.status !== 404 || i === urls.length - 1;
    const call: Call = { source: "models", provider: String(one.provider), model: "", keep: last };
    const { res, text: raw } = await sendLogged(send, call, url, { headers, signal: AbortSignal.timeout(Number(one.timeoutMs)) });
    const text = mask(raw);
    if (last(res)) return { res, text };
  }
  throw new Error("물을 주소가 없습니다");
}

// 가릴 것을 뺀 목록과 뺀 수
function visibleModels(all: string[], one: AiSettings) {
  const hidden = hideRules(one.hideModels);
  const models = all.filter((id) => !hidden.some((rule) => rule.test(id))).sort();
  return { models, hiddenCount: all.length - models.length };
}

/**
 * 저쪽에 묻지 못했을 때(키가 없다 · 거절 · 닿지 못함) 받아 둔 모델 프로필(config/ai-models)이 아는 모델로 목록을 채운다.
 * 확인 결과(ok · 까닭)는 그대로 둔다. 연결이 된 것처럼 보이면 안 된다. 프로필이 없는 곳(로컬 · custom)은 채울 것이 없다
 */
function withPreset(one: AiSettings, check: ModelsCheck): ModelsCheck {
  const registry = specOf(one.provider)?.registry;
  const all = registry ? models.modelsOf(registry).map((model) => model.modelId) : [];
  return all.length ? { ...check, ...visibleModels(all, one), preset: true } : check;
}

function hideRules(patterns: unknown) {
  return (Array.isArray(patterns) ? patterns : [])
    .map((one) => String(one ?? "").trim())
    .filter(Boolean)
    .map((one) => new RegExp(`^${one.split("*").map(escapeRe).join(".*")}$`, "i"));
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 유료 확인에 쓰는 물음. 짧고, 답이 맞는지 사람이 바로 알아볼 수 있는 것으로.
const PING_TEXT = "한 문장으로 인사하고 17 + 25 의 값을 알려 주세요.";

/**
 * 유료 확인. 진짜로 한 번 생성시킨다. 판정 프롬프트가 아니라 짧은 물음을 보낸다.
 *
 * 연결만 보고 싶은데 판정 프롬프트를 통째로 보내면 토큰도 들고, 모델이 헛소리를 했을 때
 * "연결이 안 되는 것"과 "판정을 못 읽은 것"이 섞인다.
 */
async function ping(draft: Draft): Promise<PingCheck> {
  const one = withDefaults(draft);
  if (!live(one)) return { ok: false, reason: `프로바이더가 꺼져 있습니다(provider=${one.provider || "off"}).` };
  if (!one.model) return { ok: false, reason: "모델 이름이 비어 있습니다." };

  const dialect = dialectOf(one);
  const url = dialect.chatUrl(one);
  const extra = parseExtra(one.extra);
  const body = withExtra(dialect.body(one, [{ role: "user", content: PING_TEXT }]), extra);

  const started = Date.now();
  let headers: Record<string, string> = {};
  try {
    headers = headersWith(await dialect.headers(one), extra);
    const call: Call = { source: "ping", provider: String(one.provider), model: String(one.model ?? ""), tokensOf: (json) => dialect.usageOf?.(json as Reply) ?? null };
    const { res, text: raw } = await sendLogged(send, call, url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(one.timeoutMs)) });
    const text = mask(raw);
    const took = Date.now() - started;

    let answer = "";
    try {
      answer = dialect.answerOf(JSON.parse(text)) || "";
    } catch {
      /* 모양이 다르면 원문으로 본다 */
    }
    return { ok: res.ok, url, headers: safeHeaders(headers), body, status: res.status, response: text, answer, tookMs: took, reason: res.ok ? "" : `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, url, headers: safeHeaders(headers), body, status: null, response: mask(messageOf(error)), tookMs: Date.now() - started, reason: mask(messageOf(error)) };
  }
}

/**
 * 저장하기 전의 설정으로 나갈 것을 만들어만 본다. 보내지 않는다.
 * 조립은 봇이 쓰는 코드 그대로다. 화면이 따로 흉내 내면 언젠가 어긋난다.
 *
 * 키 값은 돌려주지 않는다. 헤더에는 있었다는 표시만 남긴다.
 */
async function preview(draft: Draft, genre = "rock"): Promise<Preview> {
  const one = withDefaults(draft);
  const request = await buildRequest(one, SAMPLE_CANDIDATES, genre, { live: false });
  return { url: request.url, headers: safeHeaders(request.headers), body: request.body, messages: request.messages, tokens: await countTokens(one, request.wire), problems: request.problems };
}

/**
 * 유튜브 주소로 후보를 만든다. 판정 테스트가 진짜 곡으로 시험할 수 있게.
 * 못 읽은 줄은 버리지 않고 왜 안 됐는지 같이 돌려준다.
 */
async function candidatesFromUrls(urls: unknown[] | null | undefined, { timeoutMs = 30000 }: { timeoutMs?: number } = {}): Promise<TestCandidate[]> {
  const out: TestCandidate[] = [];
  for (const raw of (urls || []).slice(0, 20)) {
    const url = String(raw || "").trim();
    if (!url) continue;
    if (!links.isYouTubeURL(url)) {
      out.push({ url, error: "유튜브 주소가 아닙니다." });
      continue;
    }
    try {
      const info = await Promise.race([YouTube.getInfo(url), new Promise<never>((_, no) => setTimeout(() => no(new Error("시간이 걸려 그만뒀습니다.")), timeoutMs))]);
      if (!info) throw new Error("정보를 읽지 못했습니다.");
      out.push({ url, title: info.title, durationSec: info.duration, thumbnail: info.thumbnail, channel: info.artist });
    } catch (error) {
      out.push({ url, error: (error as Error | null)?.message || "정보를 읽지 못했습니다." });
    }
  }
  return out;
}

/** 그 후보들이 실제로 프롬프트에 어떻게 적히는지. 모델에게 가는 그 줄 그대로다. */
function renderList(draft: Draft, cands: Judged[] | null | undefined, genre = "rock") {
  const one = withDefaults(settings(), draft);
  return (cands || []).map((cand, i) => renderLine(one.list, cand, genre, i));
}

/**
 * 고른 후보들을 실제로 판정시킨다. 보기 곡이 아니라 진짜 곡으로.
 * 나간 것·온 것·곡별 판정을 같이 준다.
 */
async function judgeTest(draft: Draft, cands: TestCandidate[] | null | undefined, genre = "rock"): Promise<JudgeResult> {
  const one = withDefaults(draft);
  // 고른 것이 없으면 보기 곡으로 돌린다. 목록을 안 만들고 눌러도 무엇이 나가는지는 보여야 한다
  const picked = (cands || []).filter((cand) => cand && !cand.error && cand.title);
  const usable = picked.length ? picked : SAMPLE_CANDIDATES;

  const started = Date.now();
  let request: Awaited<ReturnType<typeof buildRequest>>;
  try {
    request = await buildRequest(one, usable, genre);
  } catch (error) {
    // 헤더를 못 만들었다(버텍스 토큰을 못 받는 등). 까닭을 화면에 돌려준다
    return { url: "", headers: {}, body: {}, messages: [], tokens: null, problems: [], status: null, response: mask(messageOf(error)), verdicts: null, tookMs: Date.now() - started } satisfies JudgeResult;
  }
  const out: JudgeResult = { url: request.url, headers: safeHeaders(request.headers), body: request.body, messages: request.messages, tokens: await countTokens(one, request.wire), problems: request.problems, status: null, response: "", verdicts: null };

  try {
    const call: Call = { source: "judge-test", genre, candidates: usable.length, ...judgeCall(one, usable.length) };
    const { res, text } = await sendLogged(send, call, request.url, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: AbortSignal.timeout(Number(one.timeoutMs)) });
    out.status = res.status;
    out.response = mask(text);
    try {
      const json = JSON.parse(text);
      out.usage = dialectOf(one).usageOf?.(json) || null;
      // 판정은 곡마다 한 줄이다. 못 읽으면 null. 원문은 위에 그대로 있다.
      const answered = readVerdicts(dialectOf(one).answerOf(json), usable.length);
      out.verdicts = answered ? usable.map((cand, i) => ({ title: cand.title, url: cand.url, ...(answered[i] || { song: null, fits: null }) })) : null;
    } catch {
      out.verdicts = null;
    }
  } catch (error) {
    out.response = mask(String((error as Error | null)?.message));
  }
  out.tookMs = Date.now() - started;
  return out;
}

export { DEFAULTS, filter, accepts, settings, preview, judgeTest, candidatesFromUrls, renderList, listModels, ping, parseExtra, endpointOf, keyBinding, storedKey, PROVIDER_SPECS, PROVIDERS, REDACTED, PING_TEXT, DEFAULT_PROMPT, DEFAULT_SECTIONS, DEFAULT_LINE, useFetch };
export type { AiPick };
