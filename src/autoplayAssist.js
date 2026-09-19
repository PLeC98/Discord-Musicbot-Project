"use strict";

// 자동재생 AI 보조 — 유튜브에서 찾아온 후보를 모델에게 한 번 더 물어본다.
//
// **소스가 아니라 뒷거름망이다.** 곡 이름만 아는 소스(키워드·Last.fm)에서만 쓸 자리가 있다.
// 주소를 직접 주는 소스(VocaDB·AnimeThemes·재생목록)는 출처가 곧 정답이라 물을 것이 없다.
//
// 실측(notes/research-autoplay-quality.md · 140곡 정답표, gemma3n:e2b)
//   규칙만        맞춘 비율 86% · 정밀도 79% · 재현율 97%
//   규칙 + 모델   맞춘 비율 95% · 정밀도 96% · 재현율 94%
//
// **없어도 되는 기능이다.** 못 부르면 규칙이 고른 것을 그대로 쓴다. 재생이 멈추지 않는다.

const configData = require("./configDataLoader");
const log = require("./logger").child({ category: "autoplay" });

// 판정 기준을 그대로 글로 옮긴 것. **프롬프트가 성능의 거의 전부였다** —
// 같은 모델·같은 표본에서 이 글을 고쳐 맞춘 비율이 77% → 95%로 움직였다.
//
// 1차 프롬프트는 "믹스·플레이리스트·컴필레이션·라디오·강의·리뷰·예고편·랭킹영상이면 false"처럼
// 부정 목록을 늘어놓았는데, 그러면 "Avicii - Wake Me Up (Official Video)"까지 false 가 됐다.
// **"곡 하나냐 여러 곡이냐"로 묻고 예를 붙이는** 지금 모양이 훨씬 낫다.
const DEFAULT_PROMPT = `유튜브 검색 결과가 디스코드 음악봇의 자동재생에 쓸 만한지 판정한다.

song — 이 영상이 **곡 하나**를 담고 있는가?
  true : 뮤직비디오 · 공식 오디오 · 라이브 한 곡 · 애니 오프닝 한 곡
         클래식 교향곡이나 소나타는 20~40분이어도 작품 하나이므로 true
  false: 여러 곡을 이어 붙인 것(믹스 · 플레이리스트 · 메들리 · 컴필레이션 · 앨범 전곡 · 라디오)
         음악이 아닌 것(강의 · 리뷰 · 예고편 PV · 랭킹영상 · 동요 모음)

fits — 요청한 장르가 맞는가?
  아티스트와 곡을 알고 판단한다. 제목에 장르 이름이 들어 있어도 실제 장르가 다르면 false.
  장르가 "랜덤"이면 음악이기만 하면 true.

예)
  장르=록 제목=System Of A Down - Toxicity (Official HD Video) → song=true, fits=true
  장르=록 제목=LMFAO - Party Rock Anthem → song=true, fits=false (제목에 rock이 있지만 일렉트로닉이다)
  장르=팝 제목=Pop Hits 2021 - Ariana Grande, Maroon 5, Taylor Swift → song=false (여러 곡)
  장르=클래식 제목=Beethoven: Symphony No. 7 (41분) → song=true, fits=true (작품 하나)
  장르=로파이 제목=Maroon 5 - Girls Like You → song=true, fits=false (로파이가 아니다)

JSON 배열로만 답한다. 설명하지 않는다.
[{"n":1,"song":true,"fits":false}, ...]`;

// 기본 대화 구성. 섹션마다 역할이 따로 있고, {{목록}} 자리에 후보가 들어간다.
// 이 둘이 곧 예전 모양(system=기준 · user=목록)이라 설정을 안 건드리면 지금까지와 같다.
const DEFAULT_SECTIONS = [
  { role: "system", text: DEFAULT_PROMPT },
  { role: "user", text: "{{목록}}" },
];

// 업로더 이름은 **일부러 안 넣는다.** 도움이 될 줄 알고 넣어 봤더니 fits 가 94% → 88% 로 떨어졌다.
// 유튜브의 그 칸은 토픽 트랙에서만 진짜 아티스트고 나머지는 채널 이름이다(`Vevo`·`Radio Mix`).
const DEFAULT_LINE = "{{번호}}. 장르={{장르}} 길이={{길이분}}분 제목={{제목}}";

const ROLES = new Set(["system", "user", "assistant"]);
const LIST_MARK = /\{\{\s*목록\s*\}\}/g;
const DEFAULTS = { temperature: 0, timeoutMs: 60000, batchSize: 10, skipConfident: true };

/**
 * 어디에 물을지.
 *
 * **모델 이름은 여기 적지 않는다.** 적어 두면 저쪽에서 새 모델이 나올 때마다 이 파일을
 * 고쳐야 한다. 주소만 알고 있다가 목록을 그때그때 물어본다.
 *
 * 대부분 OpenAI 호환이라 코드가 하나다. 규격이 진짜로 다른 것(앤트로픽·버텍스 네이티브)은
 * `dialect` 로 갈래를 낸다 — 차이는 DIALECTS 한 곳에만 있다.
 */
const PROVIDER_SPECS = {
  off: { label: "사용하지 않음", group: "" },

  // ── 내 기기에서 도는 것 ── 키가 없다.
  ollama: { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", key: false, group: "로컬" },
  lmstudio: { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", key: false, group: "로컬" },
  vllm: { label: "vLLM", baseUrl: "http://127.0.0.1:8000/v1", key: false, group: "로컬" },
  llamacpp: { label: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1", key: false, group: "로컬" },

  // ── 모델을 직접 내는 곳 ──
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", key: true, group: "클라우드", registry: "openai" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", key: true, group: "클라우드", dialect: "anthropic", registry: "anthropic" },
  aistudio: { label: "Google AI Studio", baseUrl: "https://generativelanguage.googleapis.com/v1beta", key: true, group: "클라우드", dialect: "gemini", registry: "google" },
  xai: { label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", key: true, group: "클라우드" },
  "ollama-cloud": { label: "Ollama Cloud", baseUrl: "https://ollama.com/v1", key: true, group: "클라우드", registry: "ollama-cloud" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", key: true, group: "클라우드", registry: "deepseek" },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", key: true, group: "클라우드" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", key: true, group: "클라우드" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", key: true, group: "클라우드" },

  // 구글 클라우드. 키가 아니라 서비스 계정 JSON 을 쓰고, 주소는 프로젝트·리전으로 조립한다.
  vertex: { label: "Vertex AI (Gemini 네이티브)", key: true, group: "클라우드", dialect: "vertex", serviceAccount: true, needsProject: true, registry: "vertex-gemini-native" },

  // ── 여러 곳을 묶어 파는 곳 ──
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", key: true, group: "게이트웨이", registry: "openrouter" },
  nanogpt: { label: "NanoGPT", baseUrl: "https://nano-gpt.com/api/v1", key: true, group: "게이트웨이", registry: "nanogpt" },
  vercel: { label: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1", key: true, group: "게이트웨이", registry: "vercel" },
  llmgateway: { label: "LLM Gateway", baseUrl: "https://api.llmgateway.io/v1", key: true, group: "게이트웨이", registry: "llmgateway" },
  neuralwatt: { label: "Neuralwatt", baseUrl: "https://api.neuralwatt.com/v1", key: true, group: "게이트웨이", registry: "neuralwatt" },

  // 주소를 직접 적는 유일한 자리. 여기 없는 곳도, 위의 주소가 바뀌었을 때도 이것으로 간다.
  custom: { label: "OpenAI 호환 (직접 입력)", baseUrl: "", key: true, editable: true, group: "직접" },
};

const PROVIDERS = Object.keys(PROVIDER_SPECS);
const specOf = (provider) => PROVIDER_SPECS[provider] || null;
const live = (one) => !!one?.provider && one.provider !== "off" && !!specOf(one.provider);

/**
 * 어디로 보낼지. **custom 일 때만 설정에 적힌 주소를 쓴다.**
 *
 * 프로바이더를 골랐으면 그곳의 주소로 간다 — 설정에 남아 있는 옛 주소로 조용히 나가지 않는다.
 * 여기 적힌 주소가 틀렸거나 프록시를 앞에 두고 싶으면 custom 으로 간다.
 */
function endpointOf(one) {
  const spec = specOf(one?.provider);
  if (!spec) return "";
  const url = spec.editable ? one?.baseUrl : spec.baseUrl;
  return String(url || "").replace(/\/+$/, "");
}
// 로컬 모델은 키를 안 받는다. 보내 봐야 쓸데없고, 어디로 새는지도 모른다.
const wantsKey = (one) => !!specOf(one?.provider)?.key;

/**
 * 키는 프로바이더마다 따로다(config/ai-keys.yaml). 로컬에는 아예 안 붙인다.
 *
 * **custom 은 저장된 주소와 같을 때만 붙인다.** 대시보드의 미리보기·테스트는 저장 안 한
 * 초안을 그대로 받는데, 그 주소로 키까지 붙여 보내면 운영자 세션을 쥔 쪽이 저장도 없이
 * 아무 데로나 키를 흘려보낼 수 있다(재 봤다). 다른 프로바이더는 주소가 박혀 있어 해당 없다.
 */
async function keyFor(one) {
  if (!wantsKey(one)) return "";

  if (specOf(one.provider)?.editable) {
    const saved = String(configData.ai()?.baseUrl || "").replace(/\/+$/, "");
    if (!saved || endpointOf(one) !== saved) return "";
  }
  return configData.aiKeyOf(one.provider);
}

async function authOf(one) {
  const key = await keyFor(one);
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** 지금 쓸 수 있나 — 설정을 읽는 유일한 곳이다(파일을 고치면 곧바로 반영된다). */
function settings() {
  const one = { ...DEFAULTS, ...configData.ai() };
  // 버텍스는 주소를 프로젝트·리전으로 조립하므로 baseUrl 이 없다
  if (!live(one) || !one.model) return null;
  if (!specOf(one.provider)?.dialect?.startsWith("vertex") && !endpointOf(one)) return null;
  // 프롬프트는 딴 파일에 산다(config/ai-prompt.chatml) — 설정 파일에는 안 섞는다
  return { ...one, prompt: configData.aiPrompt() };
}

/**
 * 추가 파라미터 — 한 줄에 하나씩. 서비스마다 이름도 자리도 달라 글로 받는다.
 *
 *   key=value            그대로 (true · false · null · 숫자는 알아서 바꾼다)
 *   key="value"          따옴표로 두르면 숫자처럼 보여도 글자다
 *   a.b.c=value          점으로 안쪽 칸에 넣는다 (thinking.budget_tokens 처럼)
 *   key=json::{...}      JSON 으로 읽어 넣는다 (객체·배열)
 *   header::Name=value   본문이 아니라 요청 헤더에 넣는다
 *   key={{none}}         그 값을 아예 안 보낸다 (header::Name={{none}} 이면 헤더를 뺀다)
 *   # 주석
 *
 * **RisuAI 와 같은 입력법이다** — 그쪽에 익숙한 사람이 그대로 적을 수 있게 맞췄다.
 * 못 읽은 줄은 조용히 버리지 않고 problems 로 돌려준다(대시보드가 보여 준다).
 */
function setPath(obj, path, value) {
  const keys = path.split(".");
  let at = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    // 앞 줄이 같은 자리에 값을 넣어 뒀으면 덮어쓴다 — 안쪽에 더 넣을 수 없는 모양이다
    if (!at[k] || typeof at[k] !== "object" || Array.isArray(at[k])) at[k] = {};
    at = at[k];
  }
  at[keys[keys.length - 1]] = value;
  return obj;
}

/** 점 경로로 지운다. 없는 길이면 아무 일도 안 한다. */
function delPath(obj, path) {
  const keys = path.split(".");
  let at = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    at = at?.[keys[i]];
    if (!at || typeof at !== "object") return;
  }
  delete at[keys[keys.length - 1]];
}

// 파이썬 꼴 키워드를 JSON 이 읽을 수 있게 바꾼다. 따옴표 안은 건드리지 않는다.
const RELAXED = [
  ["True", "true"],
  ["False", "false"],
  ["None", "null"],
];
function relaxJson(text) {
  let out = "";
  let quote = null;
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
    // 낱말 경계에서만 바꾼다 — Nonetype 같은 것을 건드리면 안 된다
    const edge = (c) => !c || !/[A-Za-z0-9_$]/.test(c);
    const hit = RELAXED.find(([word]) => text.startsWith(word, i) && edge(text[i - 1]) && edge(text[i + word.length]));
    if (hit) {
      out += hit[1];
      i += hit[0].length - 1;
    } else out += ch;
  }
  return out;
}

function readJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {}
  const relaxed = relaxJson(text);
  if (relaxed !== text) {
    try {
      return { ok: true, value: JSON.parse(relaxed) };
    } catch {}
  }
  return { ok: false };
}

function parseExtra(text) {
  const body = {};
  const headers = {};
  const drop = [];
  const dropHeaders = [];
  const problems = [];

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const at = line.indexOf("=");
    if (at < 1) {
      problems.push(`이름이 없습니다: ${line}`);
      continue;
    }
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    const isHeader = /^header::/i.test(name);
    const header = isHeader ? name.slice(8).trim() : null;

    // **{{none}} 을 header:: 보다 먼저 본다** — 안 그러면 헤더에 "{{none}}" 을 넣게 된다
    if (value === "{{none}}") {
      if (isHeader) dropHeaders.push(header);
      else drop.push(name);
      continue;
    }
    if (isHeader) {
      headers[header] = value;
      continue;
    }
    if (value === "") {
      problems.push(`값이 없습니다: ${name}`);
      continue;
    }

    if (value.startsWith("json::")) {
      const got = readJson(value.slice(6));
      if (got.ok) setPath(body, name, got.value);
      else problems.push(`JSON 으로 못 읽었습니다: ${name}`);
      continue;
    }
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) setPath(body, name, value.slice(1, -1));
    else if (value === "true" || value === "false") setPath(body, name, value === "true");
    else if (value === "null") setPath(body, name, null);
    else if (!Number.isNaN(Number(value))) setPath(body, name, Number(value));
    else setPath(body, name, value);
  }
  return { body, headers, drop, dropHeaders, problems };
}

/** 후보 한 줄. 길이 칸 이름은 후보(durationSec)와 트랙(duration)이 다르다 — 둘 다 받는다. */
function renderLine(list, cand, genre, i) {
  const sec = Number(cand.durationSec ?? cand.duration);
  const known = Number.isFinite(sec) && sec > 0;
  // 길이를 모르는데 "0분"이라고 적으면 거짓을 알려 주는 것이다 — 기본은 그 칸을 뺀다
  const mode = list?.unknownDuration || "hide";
  const unknown = mode === "zero" ? "0" : mode === "text" ? String(list?.unknownText ?? "모름") : null;

  const values = {
    번호: String(i + 1),
    장르: genre || "랜덤",
    제목: String(cand.title ?? ""),
    길이분: known ? String(Math.floor(sec / 60)) : unknown,
    길이초: known ? String(Math.round(sec)) : unknown,
  };

  // 아는 이름인데 값을 모르면 **그 자리표시자가 든 낱말째** 뺀다.
  // "길이=" 만 덩그러니 남으면 모델이 더 헷갈리기 때문이다.
  //
  // 모르는 이름은 건드리지 않는다 — 오타를 조용히 지워 버리면 왜 사라졌는지 알 길이 없다.
  return String(list?.lineFormat || DEFAULT_LINE)
    .split(/(\s+)/)
    .map((word) => {
      if (!word.includes("{{")) return word;
      let missing = false;
      const filled = word.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (all, name) => {
        if (!(name in values)) return all;
        if (values[name] == null) missing = true;
        return values[name] ?? "";
      });
      return missing ? "" : filled;
    })
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 실제로 보낼 messages. 미리보기도 이것을 쓴다 — 화면이 흉내 내면 어긋난다. */
function buildMessages(one, batch, genre) {
  const list = batch.map((cand, i) => renderLine(one.list, cand, genre, i)).join("\n");
  const sections = Array.isArray(one.prompt) && one.prompt.length ? one.prompt : DEFAULT_SECTIONS;

  return sections
    .map((section) => ({
      // 모르는 역할은 system 으로 떨어뜨린다 — 저쪽이 400을 주느니 낫다
      role: ROLES.has(section?.role) ? section.role : "system",
      content: String(section?.text ?? "").replace(LIST_MARK, list),
    }))
    .filter((message) => message.content.trim());
}

/**
 * 저쪽 규격의 차이를 여기 한 곳에 모은다.
 *
 * 오래 "전부 OpenAI 호환"으로 버텼지만, 앤트로픽과 버텍스 네이티브는 본문 모양도 인증도
 * 다르다. 갈래마다 이 여섯 가지만 답하면 나머지 코드(판정·미리보기·테스트)는 그대로 돈다.
 *
 *   chatUrl   생성 요청을 보낼 주소
 *   modelsUrl 모델 목록 주소 (없으면 목록을 못 받는 곳이다)
 *   headers   그 규격이 요구하는 헤더 + 인증 (토큰을 받아야 할 수 있어 async)
 *   body      우리 {role, content} 목록을 저쪽 본문으로
 *   answerOf  응답에서 모델이 쓴 글
 *   modelsOf  모델 목록 응답에서 이름들
 */
/**
 * 제미니 네이티브 본문 — AI 스튜디오와 버텍스가 **같은 모양**을 쓴다.
 * 갈리는 것은 주소와 인증뿐이다.
 *
 *   · messages 가 아니라 contents/parts 이고, assistant 를 model 이라 부른다
 *   · system 은 systemInstruction 이라는 딴 칸이다
 *   · 온도 같은 것은 generationConfig 안에 있다(추가 파라미터도 경로를 적어 넣는다)
 */
function geminiBody(one, messages) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  return {
    contents: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: { temperature: Number(one.temperature) },
  };
}
const geminiAnswer = (json) => (json?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join("");

const DIALECTS = {
  openai: {
    chatUrl: (one) => `${endpointOf(one)}/chat/completions`,
    modelsUrl: (one) => `${endpointOf(one)}/models`,
    headers: async (one) => ({ "Content-Type": "application/json", ...(specOf(one.provider)?.headers || {}), ...(await authOf(one)) }),
    body: (one, messages) => ({ model: one.model, temperature: Number(one.temperature), messages }),
    answerOf: (json) => json?.choices?.[0]?.message?.content || "",
    modelsOf: (json) => (json?.data || []).map((m) => m?.id),
  },

  /**
   * 앤트로픽 네이티브(/v1/messages).
   *
   * OpenAI 와 다른 것 셋:
   *   · system 은 메시지가 아니라 **본문 맨 위 칸**이다
   *   · max_tokens 가 **필수**다(없으면 400)
   *   · 인증이 Authorization 이 아니라 x-api-key 다
   */
  anthropic: {
    chatUrl: (one) => `${endpointOf(one)}/messages`,
    modelsUrl: (one) => `${endpointOf(one)}/models`,
    headers: async (one) => {
      const key = await keyFor(one);
      return { "Content-Type": "application/json", "anthropic-version": ANTHROPIC_VERSION, ...(key ? { "x-api-key": key } : {}) };
    },
    body: (one, messages) => {
      // system 은 여럿일 수 있다(섹션을 나눠 적었을 수 있다) — 붙여서 한 칸에 넣는다
      const system = messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      return {
        model: one.model,
        // 저쪽에서 필수라 늘 붙인다. 프로필이 아는 모델이면 그쪽 값이 이긴다.
        max_tokens: ANTHROPIC_MAX_TOKENS,
        temperature: Number(one.temperature),
        ...(system ? { system } : {}),
        messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      };
    },
    answerOf: (json) => (json?.content || []).map((part) => part?.text || "").join(""),
    modelsOf: (json) => (json?.data || []).map((m) => m?.id),
  },

  /**
   * 구글 AI 스튜디오 — 제미니 네이티브.
   *
   * **OpenAI 호환층(/v1beta/openai)을 쓰지 않는다.** 호환층으로는 추론 설정이 저쪽 규격과
   * 어긋나고, 모델 프로필이 적어 둔 경로(generationConfig.…)도 네이티브 기준이다.
   * 버텍스와 본문이 같고 주소·인증만 다르다.
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
    // { models: [{ name: "models/gemini-3.7-flash" }] }
    modelsOf: (json) =>
      (json?.models || []).map((m) =>
        String(m?.name || "")
          .split("/")
          .pop(),
      ),
  },

  /**
   * 버텍스 AI — 제미니 네이티브.
   *
   * 여기만 유난히 다르다.
   *   · 주소를 프로젝트·리전·모델로 **조립한다**. baseUrl 이 없다.
   *   · 인증이 API 키가 아니라 서비스 계정에서 받은 액세스 토큰이다(googleAuth).
   *   · 본문이 messages 가 아니라 contents/parts 이고, assistant 를 model 이라 부른다.
   *   · system 은 systemInstruction 이라는 딴 칸이다.
   *   · 온도 같은 것은 맨 위가 아니라 generationConfig 안에 있다 —
   *     추가 파라미터도 `generationConfig.topP=0.9` 처럼 **경로를 적어** 넣는다.
   */
  vertex: {
    chatUrl: (one) => `${vertexBase(one)}/publishers/google/models/${one.model || ""}:generateContent`,
    // 모델 목록은 생성과 **주소 체계가 다르다.** 프로젝트·리전이 붙지 않는 쪽이라
    // 생성 주소를 그대로 쓰면 404 다. 문서판이 갈려 있어 차례로 물어본다.
    modelsUrl: (one) => `https://${vertexHost(one)}/v1beta1/publishers/google/models`,
    modelsUrlFallbacks: (one) => [`https://${vertexHost(one)}/v1/publishers/google/models`, `${vertexBase(one)}/publishers/google/models`],
    headers: async (one) => {
      const token = await require("./googleAuth").accessToken(configData.aiKeyOf(one.provider), { baseDir: configData.configDir(), timeoutMs: Number(one.timeoutMs) });
      return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    },
    body: geminiBody,
    answerOf: geminiAnswer,
    // { publisherModels: [{ name: "publishers/google/models/gemini-3-pro" }] }
    modelsOf: (json) =>
      (json?.publisherModels || []).map((m) =>
        String(m?.name || "")
          .split("/")
          .pop(),
      ),
  },
};

// 리전이 global 이면 호스트도 다르다(지역 호스트로 부르면 404 다)
const vertexLocation = (one) => String(one?.location || "").trim() || "global";
const vertexHost = (one) => (vertexLocation(one) === "global" ? "aiplatform.googleapis.com" : `${vertexLocation(one)}-aiplatform.googleapis.com`);

function vertexBase(one) {
  const location = vertexLocation(one);
  const project = String(one?.project || "").trim() || require("./googleAuth").projectOf(configData.aiKeyOf(one?.provider), configData.configDir());
  return `https://${vertexHost(one)}/v1/projects/${project}/locations/${location}`;
}

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 1024;

const dialectOf = (one) => DIALECTS[specOf(one?.provider)?.dialect || "openai"] || DIALECTS.openai;

/** 보낼 것 한 벌 — 미리보기도 이것을 쓴다. */
/**
 * 모델이 받는다고 적혀 있는 칸만 싣는다. 모델을 바꾸면 안 받는 칸은 저절로 빠진다 —
 * Astra 에서 고른 effort=max 를 none 만 받는 모델에 그대로 보내면 400 이다.
 */
function withParams(body, one) {
  const registry = specOf(one.provider)?.registry;
  if (!registry || !one.model) return body;

  const models = require("./aiModels");
  const out = deepMerge(body, models.defaultsOf(registry, one.model));
  // 사용자가 안 고른 칸은 프로필이 적어 둔 기본값으로 간다. 값은 모델별로 따로 저장된다 —
  // 모델을 바꿨는데 앞 모델에서 고른 값이 따라오면 안 된다.
  const picked = one.params?.[one.model] || {};
  for (const field of models.fieldsOf(registry, one.model)) {
    const chosen = picked[field.key];
    const value = chosen === undefined || chosen === "" ? field.default : chosen;
    if (value === undefined || value === "") continue;
    if (field.enum && !field.enum.some((e) => e.value === value)) continue;
    setPath(out, field.path, value);
  }
  return out;
}

async function buildRequest(one, batch, genre) {
  const dialect = dialectOf(one);
  const extra = parseExtra(one.extra);

  // 추가 파라미터가 맨 나중이다 — 프로필이 모르는 것을 넣는 비상구이므로 마지막 말을 갖는다
  const body = withExtra(dialect, withParams(dialect.body(one, buildMessages(one, batch, genre)), one), extra);
  return { url: dialect.chatUrl(one), headers: headersWith(await dialect.headers(one), extra), body, problems: extra.problems };
}

/**
 * 추가 파라미터를 본문에 얹는다.
 *
 * 버텍스는 온도 같은 것이 맨 위가 아니라 generationConfig 안에 있다.
 * 거기로 안 넣으면 적어 둔 값이 조용히 무시된다 — 가장 알아채기 어려운 종류다.
 */
/** 안쪽 칸까지 합친다 — 점 표기로 만든 중첩을 통째로 덮어쓰지 않게. */
function deepMerge(base, add) {
  const out = { ...base };
  for (const [key, value] of Object.entries(add)) {
    const mine = out[key];
    const both = (v) => v && typeof v === "object" && !Array.isArray(v);
    out[key] = both(mine) && both(value) ? deepMerge(mine, value) : value;
  }
  return out;
}

/** 헤더를 얹고, header::Name={{none}} 으로 지우라고 한 것을 뺀다. 이름의 대소문자는 안 가린다. */
function headersWith(base, extra) {
  const out = { ...base, ...extra.headers };
  for (const name of extra.dropHeaders || []) {
    for (const key of Object.keys(out)) if (key.toLowerCase() === String(name).toLowerCase()) delete out[key];
  }
  return out;
}

/**
 * **경로는 언제나 본문 맨 위부터다.** 다이얼렉트마다 다른 자리로 넣어 주지 않는다 —
 * 버텍스처럼 안쪽 칸을 쓰는 곳은 `generationConfig.topP=0.9` 로 적는다.
 * 모델 프로필의 mapsTo.path 도 같은 규칙이라, 두 길이 어긋나지 않는다.
 */
function withExtra(_dialect, body, extra) {
  const out = deepMerge(body, extra.body);
  // {{none}} 은 얹은 뒤에 지워야 temperature 처럼 늘 붙는 것도 뺄 수 있다
  for (const path of extra.drop) delPath(out, path);
  return out;
}

// gemma 계열은 토크나이저의 공백 표시(U+2581 ▁)를 답에 그대로 흘리는 일이 있다.
// JSON.parse 가 `Unexpected token '▁'` 로 죽으므로 들여쓰기 자리의 그것만 공백으로 되돌린다.
// 같은 자리에 오는 다른 폭의 공백(U+00A0 · U+3000)도 함께 본다.
const ODD_SPACE = new RegExp("[\u2581\u00a0\u3000]", "g");
const despace = (text) => text.replace(ODD_SPACE, " ");

async function askBatch(one, batch, genre) {
  const request = await buildRequest(one, batch, genre);

  const res = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(Number(one.timeoutMs)),
  });

  // 저쪽이 왜 거절했는지는 본문에만 있다(모델 이름 오타 · 남은 토큰 없음 · 사용량 초과 …).
  // 그대로 싣되 키는 가린다 — 거절 응답에 보낸 값을 되비추는 서비스가 있다.
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${mask(await res.text()).slice(0, 300)}`);

  const text = dialectOf(one).answerOf(await res.json()) || "";
  // 작은 모델은 ```json 울타리나 앞말을 곧잘 붙인다. 배열만 집어낸다.
  const found = text.match(/\[[\s\S]*\]/);
  if (!found) throw new Error(`JSON 배열을 못 찾았습니다: ${text.slice(0, 160)}`);

  const out = new Array(batch.length).fill(null);
  for (const verdict of JSON.parse(despace(found[0]))) {
    const at = Number(verdict?.n) - 1;
    if (at >= 0 && at < batch.length) out[at] = { song: !!verdict.song, fits: !!verdict.fits };
  }
  return out;
}

/**
 * 후보 목록에서 모델이 아니라고 한 것을 걸러낸다.
 *
 * **실패하면 받은 목록을 그대로 돌려준다.** 판정을 못 했다고 곡을 버리면, 모델이 죽었을 때
 * 자동재생이 통째로 멈춘다. 못 고르는 것보다 규칙만으로 고르는 편이 낫다.
 *
 * @param {Array<{title: string, durationSec?: number}>} candidates 순위가 매겨진 후보
 * @param {{genre?: string, confident?: boolean}} about
 */
async function filter(candidates, about = {}) {
  const one = settings();
  if (!one || !candidates?.length) return candidates || [];
  // 규칙이 이미 확신한다면 물을 이유가 없다(설정에서 끌 수 있다)
  if (one.skipConfident && about.confident) return candidates;

  const size = Math.max(1, Number(one.batchSize));
  const kept = [];
  try {
    for (let at = 0; at < candidates.length; at += size) {
      const batch = candidates.slice(at, at + size);
      const verdicts = await askBatch(one, batch, about.genre);
      // 답을 못 받은 자리는 살린다 — 모델이 빠뜨린 것을 떨어뜨릴 이유가 없다
      batch.forEach((cand, i) => {
        const verdict = verdicts[i];
        if (!verdict || (verdict.song && verdict.fits)) kept.push(cand);
      });
    }
  } catch (error) {
    log.debug(`AI 보조를 건너뜁니다(${error.message}) — 규칙만으로 고릅니다`);
    return candidates;
  }

  if (kept.length !== candidates.length) log.debug(`AI 보조: ${candidates.length}개 중 ${kept.length}개 남김${about.genre ? ` [${about.genre}]` : ""}`);
  // 전부 떨어졌다면 모델이 너무 박한 것이다. 규칙이 고른 것을 쓴다.
  return kept.length ? kept : candidates;
}

/**
 * 곡 하나를 물어본다 — 규칙이 이미 하나로 좁혀 놓은 자리(키워드 경로)용.
 *
 * `filter`와 달리 **아니라고 하면 정말로 버린다.** 목록이 아니라 한 곡이므로
 * "전부 떨어지면 되돌린다"가 성립하지 않는다. 대신 못 물어본 경우는 그대로 살린다.
 *
 * @returns {Promise<boolean>} 틀어도 되는가
 */
async function accepts(candidate, about = {}) {
  const one = settings();
  if (!one || !candidate) return true;
  if (one.skipConfident && about.confident) return true;

  try {
    const [verdict] = await askBatch(one, [candidate], about.genre);
    if (!verdict) return true; // 판정을 못 읽었다 — 버릴 근거가 없다
    if (verdict.song && verdict.fits) return true;
    log.debug(`AI 보조가 거름(${verdict.song ? "장르가 다름" : "곡 하나가 아님"})${about.genre ? ` [${about.genre}]` : ""}: ${candidate.title}`);
    return false;
  } catch (error) {
    log.debug(`AI 보조를 건너뜁니다(${error.message}) — 규칙만으로 고릅니다`);
    return true;
  }
}

/** 지금 설정으로 실제로 부를 수 있는지 한 번 재 본다. 대시보드의 "연결 확인" 버튼용. */
/**
 * **무료 확인** — 모델 목록만 받아 온다(`GET {baseUrl}/models`).
 *
 * 추론을 안 돌리므로 토큰이 안 든다. 주소·키·네트워크가 맞는지는 이것으로 다 알 수 있다.
 * 받아 온 목록은 화면의 모델 고르는 칸을 채우는 데도 쓴다 — 그래서 모델 이름을 코드에
 * 적어 둘 이유가 없다.
 */
async function listModels(draft) {
  const one = { ...DEFAULTS, ...(draft || {}) };
  if (!live(one)) return { ok: false, reason: `프로바이더가 꺼져 있습니다(provider=${one.provider || "off"}).` };

  const dialect = dialectOf(one);
  const first = dialect.modelsUrl(one);
  if (!first) return { ok: false, reason: "엔드포인트 주소가 비어 있습니다(custom 이면 직접 적어야 합니다)." };

  // 같은 곳인데 문서판마다 주소 체계가 다른 데가 있다(버텍스). 404 면 다음 것을 물어본다 —
  // 그래야 어느 판을 쓰는 프로젝트든 목록이 뜬다. 404 가 아니면 그 답이 곧 사실이다.
  const urls = [first, ...(dialect.modelsUrlFallbacks?.(one) || [])];
  const started = Date.now();
  let url = first; // 실패해도 어디를 불렀는지는 알려 줘야 한다(catch 에서 쓴다)

  try {
    const headers = await dialect.headers(one);
    let res;
    let text = "";

    for (const candidate of urls) {
      url = candidate;
      res = await fetch(url, { headers, signal: AbortSignal.timeout(Number(one.timeoutMs)) });
      text = mask(await res.text());
      if (res.ok || res.status !== 404) break;
    }

    const took = Date.now() - started;
    if (!res.ok) return { ok: false, url, status: res.status, response: text, tookMs: took, reason: `HTTP ${res.status}` };

    // 모양은 갈래마다 다르다. 못 읽어도 목록만 못 채우고 연결은 된 것이다.
    let all = [];
    try {
      all = (dialect.modelsOf(JSON.parse(text)) || []).filter((id) => typeof id === "string");
    } catch {
      /* 목록을 못 읽어도 응답 자체는 보여 준다 */
    }

    // **이름을 코드에 적지 않는다.** 대신 안 쓸 것을 설정에서 가린다 — 저쪽 목록에는
    // 영상·이미지 모델이나 한참 옛 모델이 섞여 나온다.
    const hidden = hideRules(one.hideModels);
    const models = all.filter((id) => !hidden.some((rule) => rule.test(id))).sort();
    return { ok: true, url, status: res.status, models, hiddenCount: all.length - models.length, response: text, tookMs: took };
  } catch (error) {
    return { ok: false, url, status: null, response: mask(error.message), tookMs: Date.now() - started, reason: mask(error.message) };
  }
}

/**
 * 목록에서 가릴 이름. `*` 만 있는 아주 좁은 글롭이다 — 정규식을 설정 파일에 적게 하면
 * 오타 하나에 목록이 통째로 비고, 왜 빈지 알 길이 없다.
 */
function hideRules(patterns) {
  return (Array.isArray(patterns) ? patterns : [])
    .map((one) => String(one ?? "").trim())
    .filter(Boolean)
    .map((one) => new RegExp(`^${one.split("*").map(escapeRe).join(".*")}$`, "i"));
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 유료 확인에 쓰는 물음 — 짧고, 답이 맞는지 사람이 바로 알아볼 수 있는 것으로.
const PING_TEXT = "한 문장으로 인사하고 17 + 25 의 값을 알려 주세요.";

/**
 * **유료 확인** — 진짜로 한 번 생성시킨다. 판정 프롬프트가 아니라 짧은 물음을 보낸다.
 *
 * 연결만 보고 싶은데 판정 프롬프트를 통째로 보내면 토큰도 들고, 모델이 헛소리를 했을 때
 * "연결이 안 되는 것"과 "판정을 못 읽은 것"이 섞인다.
 */
async function ping(draft) {
  const one = { ...DEFAULTS, ...(draft || {}) };
  if (!live(one)) return { ok: false, reason: `프로바이더가 꺼져 있습니다(provider=${one.provider || "off"}).` };
  if (!one.model) return { ok: false, reason: "모델 이름이 비어 있습니다." };

  const dialect = dialectOf(one);
  const url = dialect.chatUrl(one);
  const extra = parseExtra(one.extra);
  const body = withExtra(dialect, dialect.body(one, [{ role: "user", content: PING_TEXT }]), extra);

  const headers = headersWith(await dialect.headers(one), extra);

  const started = Date.now();
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(one.timeoutMs)) });
    const text = mask(await res.text());
    const took = Date.now() - started;

    let answer = "";
    try {
      answer = dialect.answerOf(JSON.parse(text)) || "";
    } catch {
      /* 모양이 다르면 원문으로 본다 */
    }
    return { ok: res.ok, url, headers: safeHeaders(headers), body, status: res.status, response: text, answer, tookMs: took, reason: res.ok ? "" : `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, url, headers: safeHeaders(headers), body, status: null, response: mask(error.message), tookMs: Date.now() - started, reason: mask(error.message) };
  }
}

// 미리보기용 보기 곡 — 판정이 갈리는 세 가지를 일부러 골랐다(멀쩡한 곡 · 믹스 · 길이 모름)
const SAMPLE = [{ title: "System Of A Down - Toxicity (Official HD Video)", durationSec: 210 }, { title: "Rock Mix 2024 · 1 Hour Best Rock Songs", durationSec: 3600 }, { title: "이름만 아는 곡 (길이를 모르는 후보)" }];

/**
 * 저장하기 전의 설정으로 **나갈 것을 만들어만 본다. 보내지 않는다.**
 * 조립은 봇이 쓰는 코드 그대로다 — 화면이 따로 흉내 내면 언젠가 어긋난다.
 *
 * 키 값은 돌려주지 않는다. 헤더에는 있었다는 표시만 남긴다.
 */
async function preview(draft, genre = "록") {
  const one = { ...DEFAULTS, ...(draft || {}) };
  const request = await buildRequest(one, SAMPLE, genre);
  return { url: request.url, headers: safeHeaders(request.headers), body: request.body };
}

// 인증이 실리는 헤더는 규격마다 다르다. 하나를 더할 때 여기도 같이 봐야 한다.
const SECRET_HEADERS = ["authorization", "x-api-key", "x-goog-api-key", "api-key"];

/** 화면에 보여도 되는 헤더 — 키 값은 절대 나가지 않는다. */
function safeHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (!SECRET_HEADERS.includes(name.toLowerCase())) {
      out[name] = value;
      continue;
    }
    // 앞의 낱말(Bearer)은 남긴다 — 어떤 방식으로 붙는지는 보이는 편이 낫다
    const scheme = /^(\w+)\s/.exec(String(value));
    out[name] = scheme ? `${scheme[1]} ${REDACTED}` : REDACTED;
  }
  return out;
}

/** 같은 것을 **실제로 보낸다.** 나간 것과 온 것을 손대지 않고 그대로 준다. */
async function sendTest(draft, genre = "록") {
  const one = { ...DEFAULTS, ...(draft || {}) };
  const request = await buildRequest(one, SAMPLE, genre);
  const out = { url: request.url, headers: safeHeaders(request.headers), body: request.body, status: null, response: "" };

  const started = Date.now();
  try {
    const res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(Number(one.timeoutMs)),
    });
    out.status = res.status;
    out.response = mask(await res.text()); // 다듬지 않는다 — 무엇이 왔는지 그대로 봐야 한다
  } catch (error) {
    out.response = mask(String(error.message));
  }
  out.tookMs = Date.now() - started;
  return out;
}

// 어떤 서비스는 거절 응답에 보낸 값을 되비춘다 — 화면에도 로그에도 키가 남으면 안 된다.
// 무엇이 가려진 것인지 알아볼 수 있게 이름을 붙인다(별표만 있으면 원래 그런 값인 줄 안다).
const REDACTED = "[REDACTED_SECRET_KEY]";

// 지금 쓰는 프로바이더 것만이 아니라 **적혀 있는 키를 모두** 가린다.
// 어느 것이 되비쳐 올지 우리가 정할 수 없고, 넉넉히 가려서 손해 볼 것이 없다.
function mask(text) {
  let out = String(text);
  // 받아 둔 액세스 토큰도 가린다 — 서비스 계정에서 나온 것이라 키만큼 값이 나간다
  for (const key of [...Object.values(configData.aiKeys()), ...require("./googleAuth").heldTokens()]) {
    if (!key || key.length <= 8) continue;
    out = out.split(key).join(REDACTED);

    // 서비스 계정은 값 자체가 JSON 덩어리다. 통째로 나오는 일은 없어도 **키만 떨어져 나올 수는**
    // 있으므로 안쪽 private_key 도 따로 가린다.
    if (key.trimStart().startsWith("{")) {
      try {
        const inner = JSON.parse(key)?.private_key;
        if (inner) out = out.split(inner).join(REDACTED);
      } catch {
        /* JSON 이 아니면 경로였던 것이다 */
      }
    }
  }
  return out;
}

module.exports = { filter, accepts, settings, preview, sendTest, listModels, ping, parseExtra, endpointOf, PROVIDER_SPECS, PROVIDERS, REDACTED, PING_TEXT, DEFAULT_PROMPT, DEFAULT_SECTIONS, DEFAULT_LINE };
