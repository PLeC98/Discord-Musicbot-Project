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
 * 고쳐야 한다. 주소만 알고 있다가 `GET {baseUrl}/models` 로 그때그때 물어본다.
 *
 * 전부 OpenAI 호환이라 코드가 하나다 — 규격이 진짜로 다른 것(Anthropic · Vertex 네이티브)이
 * 필요해지면 그때 갈래를 낸다.
 */
const PROVIDER_SPECS = {
  off: { label: "사용하지 않음", group: "" },

  // ── 내 기기에서 도는 것 ── 키가 없다.
  ollama: { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", key: false, group: "로컬" },
  lmstudio: { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", key: false, group: "로컬" },
  vllm: { label: "vLLM", baseUrl: "http://127.0.0.1:8000/v1", key: false, group: "로컬" },
  llamacpp: { label: "llama.cpp", baseUrl: "http://127.0.0.1:8080/v1", key: false, group: "로컬" },

  // ── 모델을 직접 내는 곳 ──
  "ollama-cloud": { label: "Ollama Cloud", baseUrl: "https://ollama.com/v1", key: true, group: "클라우드" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", key: true, group: "클라우드" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", key: true, group: "클라우드" },
  aistudio: { label: "Google AI Studio", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", key: true, group: "클라우드" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", key: true, group: "클라우드" },
  mistral: { label: "Mistral", baseUrl: "https://api.mistral.ai/v1", key: true, group: "클라우드" },
  xai: { label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", key: true, group: "클라우드" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", key: true, group: "클라우드" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", key: true, group: "클라우드" },

  // ── 여러 곳을 묶어 파는 곳 ──
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", key: true, group: "게이트웨이" },
  nanogpt: { label: "NanoGPT", baseUrl: "https://nano-gpt.com/api/v1", key: true, group: "게이트웨이" },
  vercel: { label: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1", key: true, group: "게이트웨이" },
  llmgateway: { label: "LLM Gateway", baseUrl: "https://api.llmgateway.io/v1", key: true, group: "게이트웨이" },

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
function authOf(one) {
  if (!wantsKey(one)) return {};

  if (specOf(one.provider)?.editable) {
    const saved = String(configData.ai()?.baseUrl || "").replace(/\/+$/, "");
    if (!saved || endpointOf(one) !== saved) return {};
  }

  const key = configData.aiKeyOf(one.provider);
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** 지금 쓸 수 있나 — 설정을 읽는 유일한 곳이다(파일을 고치면 곧바로 반영된다). */
function settings() {
  const one = { ...DEFAULTS, ...configData.ai() };
  if (!live(one) || !endpointOf(one) || !one.model) return null;
  // 프롬프트는 딴 파일에 산다(config/ai-prompt.chatml) — 설정 파일에는 안 섞는다
  return { ...one, prompt: configData.aiPrompt() };
}

/**
 * 추가 파라미터 — 한 줄에 하나씩. 서비스마다 이름도 자리도 달라 글로 받는다.
 *
 *   key=value            그대로 (true · false · 숫자는 알아서 바꾼다)
 *   key=json::{...}      JSON 으로 읽어 넣는다 (객체·배열)
 *   header::Name=value   본문이 아니라 요청 헤더에 넣는다
 *   key={{none}}         그 값을 아예 안 보낸다 (temperature 처럼 늘 붙는 것을 뺄 때)
 */
function parseExtra(text) {
  const body = {};
  const headers = {};
  const drop = [];

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const at = line.indexOf("=");
    if (at < 1) continue; // 이름이 없는 줄은 버린다
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();

    if (/^header::/i.test(name)) {
      headers[name.slice(8).trim()] = value;
    } else if (value === "{{none}}") {
      drop.push(name);
    } else if (value.startsWith("json::")) {
      const json = value.slice(6);
      try {
        body[name] = JSON.parse(json);
      } catch {
        body[name] = json; // 못 읽으면 적힌 그대로 — 조용히 버리지 않는다
      }
    } else if (value === "true" || value === "false") {
      body[name] = value === "true";
    } else if (value !== "" && !Number.isNaN(Number(value))) {
      body[name] = Number(value);
    } else {
      body[name] = value;
    }
  }
  return { body, headers, drop };
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
 * 후보 묶음을 모델에게 묻는다.
 * @returns {Promise<Array<{song: boolean, fits: boolean}|null>>} 후보와 같은 길이. 못 받은 자리는 null.
 */
/** 보낼 것 한 벌 — 미리보기도 이것을 쓴다. */
function buildRequest(one, batch, genre) {
  const extra = parseExtra(one.extra);
  const body = {
    model: one.model,
    temperature: Number(one.temperature),
    messages: buildMessages(one, batch, genre),
    ...extra.body,
  };
  // {{none}} 은 얹은 뒤에 지워야 temperature 처럼 늘 붙는 것도 뺄 수 있다
  for (const key of extra.drop) delete body[key];

  return {
    url: `${endpointOf(one)}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      ...authOf(one),
      ...extra.headers,
    },
    body,
  };
}

// gemma 계열은 토크나이저의 공백 표시(U+2581 ▁)를 답에 그대로 흘리는 일이 있다.
// JSON.parse 가 `Unexpected token '▁'` 로 죽으므로 들여쓰기 자리의 그것만 공백으로 되돌린다.
// 같은 자리에 오는 다른 폭의 공백(U+00A0 · U+3000)도 함께 본다.
const ODD_SPACE = new RegExp("[\u2581\u00a0\u3000]", "g");
const despace = (text) => text.replace(ODD_SPACE, " ");

async function askBatch(one, batch, genre) {
  const request = buildRequest(one, batch, genre);

  const res = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(Number(one.timeoutMs)),
  });

  // 저쪽이 왜 거절했는지는 본문에만 있다(모델 이름 오타 · 남은 토큰 없음 · 사용량 초과 …).
  // 그대로 싣되 키는 가린다 — 거절 응답에 보낸 값을 되비추는 서비스가 있다.
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${mask(await res.text()).slice(0, 300)}`);

  const text = (await res.json())?.choices?.[0]?.message?.content || "";
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
  if (!endpointOf(one)) return { ok: false, reason: "엔드포인트 주소가 비어 있습니다(custom 이면 직접 적어야 합니다)." };

  const url = `${endpointOf(one)}/models`;
  const headers = authOf(one);
  const started = Date.now();

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(Number(one.timeoutMs)) });
    const text = mask(await res.text());
    const took = Date.now() - started;
    if (!res.ok) return { ok: false, url, status: res.status, response: text, tookMs: took, reason: `HTTP ${res.status}` };

    // OpenAI 규격은 { data: [{ id }] } 다. 다른 모양이면 목록만 못 채우고 연결은 된 것이다.
    let models = [];
    try {
      models = (JSON.parse(text)?.data || []).map((m) => m?.id).filter((id) => typeof id === "string");
    } catch {
      /* 목록을 못 읽어도 응답 자체는 보여 준다 */
    }
    return { ok: true, url, status: res.status, models: models.sort(), response: text, tookMs: took };
  } catch (error) {
    return { ok: false, url, status: null, response: mask(error.message), tookMs: Date.now() - started, reason: mask(error.message) };
  }
}

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

  const url = `${endpointOf(one)}/chat/completions`;
  const extra = parseExtra(one.extra);
  const body = { model: one.model, messages: [{ role: "user", content: PING_TEXT }], ...extra.body };
  for (const key of extra.drop) delete body[key];

  const headers = {
    "Content-Type": "application/json",
    ...authOf(one),
    ...extra.headers,
  };

  const started = Date.now();
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(Number(one.timeoutMs)) });
    const text = mask(await res.text());
    const took = Date.now() - started;

    let answer = "";
    try {
      answer = JSON.parse(text)?.choices?.[0]?.message?.content || "";
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
function preview(draft, genre = "록") {
  const one = { ...DEFAULTS, ...(draft || {}) };
  const request = buildRequest(one, SAMPLE, genre);
  return { url: request.url, headers: safeHeaders(request.headers), body: request.body };
}

/** 화면에 보여도 되는 헤더 — 키 값은 절대 나가지 않는다. */
function safeHeaders(headers) {
  const out = { ...headers };
  if (out.Authorization) out.Authorization = `Bearer ${REDACTED}`;
  return out;
}

/** 같은 것을 **실제로 보낸다.** 나간 것과 온 것을 손대지 않고 그대로 준다. */
async function sendTest(draft, genre = "록") {
  const one = { ...DEFAULTS, ...(draft || {}) };
  const request = buildRequest(one, SAMPLE, genre);
  const out = { ...preview(draft, genre), status: null, response: "" };

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
  for (const key of Object.values(configData.aiKeys())) {
    if (key) out = out.split(key).join(REDACTED);
  }
  return out;
}

module.exports = { filter, accepts, settings, preview, sendTest, listModels, ping, parseExtra, endpointOf, PROVIDER_SPECS, PROVIDERS, REDACTED, PING_TEXT, DEFAULT_PROMPT, DEFAULT_SECTIONS, DEFAULT_LINE };
