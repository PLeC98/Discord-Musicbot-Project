/**
 * 토큰 세기. 요청이 몇 토큰짜리인지.
 *
 * 어느 토크나이저를 쓸지는 모델 프로필의 `recommendedTokenizer` 가 정함
 *   tik     OpenAI 계열. gpt-tokenizer (o200k_base). 4o·4.1·o1·o3·5.x·6 이 같은 인코딩
 *   gemma   제미니·젬마. data/gemma-tokenizer.model (SentencePiece BPE)
 *   claude  앤트로픽은 공개 토크나이저가 없다. tik 로 세면 한국어에서 35% 가 모자람
 *           (실측 50 vs 33). 그래서 저쪽 count_tokens 로 측정: 무료이고 정확
 *           키가 없거나 못 부르면 tik 로 떨어지고, 그때만 추산치
 */
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import models from "../../config/schema/aiModels.ts";

// gpt-tokenizer 는 표가 커서 불러오는 데 오래 걸린다. 처음 셀 때 부른다. 셈이 동기라 await import() 대신 require 로
// (이름을 require 로 두어 구조 검사가 지연 부름으로 센다)
const require = createRequire(import.meta.url);
let tik = null;
const tikCount = (body) => (tik ??= require("gpt-tokenizer")).encode(body).length;

const GEMMA_FILE = path.join(import.meta.dirname, "..", "..", "..", "data", "gemma-tokenizer.model");

/**
 * 메시지를 역할과 함께 감싸는 데 드는 토큰. 규격마다 다르고 실측으로 잡았다.
 *
 *   openai     한 메시지 3 + 요청 3. 본문 33 짜리가 prompt_tokens 39 로 왔다
 *   gemini     0. promptTokenCount 가 본문 토큰과 그대로 같았다
 *              (countTokens 엔드포인트는 1 을 더 세는데 그 값은 청구되지 않는다)
 *   anthropic  세대마다 다르다. 5(4.8~5) · 10(4.7) · 6(4.5~4.6)
 */
const FRAMING = {
  openai: { perMessage: 3, perRequest: 3 },
  gemini: { perMessage: 0, perRequest: 0 },
  vertex: { perMessage: 0, perRequest: 0 },
  anthropic: { perMessage: 0, perRequest: 6 },
};

// ── SentencePiece BPE ──────────────────────────────────────────────────────
// 조각마다 점수가 있고 점수가 높은 짝부터 붙인다. merges 목록이 따로 없는 이유다.
let gemma = null;

function varint(buf, at) {
  let out = 0;
  let shift = 0;
  let byte;
  do {
    byte = buf[at++];
    out += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [out, at];
}

/** ModelProto 에서 조각과 점수만 */
function readPieces(buf) {
  const piece = [];
  const score = [];
  let at = 0;
  while (at < buf.length) {
    let tag;
    [tag, at] = varint(buf, at);
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire !== 2) {
      if (wire === 0) [, at] = varint(buf, at);
      else if (wire === 5) at += 4;
      else if (wire === 1) at += 8;
      else break;
      continue;
    }
    let len;
    [len, at] = varint(buf, at);
    const sub = buf.subarray(at, at + len);
    at += len;
    if (field !== 1) continue; // pieces 만

    let j = 0;
    let text = "";
    let value = 0;
    while (j < sub.length) {
      let t;
      [t, j] = varint(sub, j);
      const f = t >> 3;
      const w = t & 7;
      if (w === 2) {
        let l;
        [l, j] = varint(sub, j);
        if (f === 1) text = sub.toString("utf8", j, j + l);
        j += l;
      } else if (w === 5) {
        if (f === 2) value = sub.readFloatLE(j);
        j += 4;
      } else if (w === 0) {
        [, j] = varint(sub, j);
      } else break;
    }
    piece.push(text);
    score.push(value);
  }
  return { piece, score };
}

function loadGemma() {
  if (gemma !== null) return gemma;
  try {
    const { piece, score } = readPieces(fs.readFileSync(GEMMA_FILE));
    const rank = new Map();
    for (let i = 0; i < piece.length; i++) rank.set(piece[i], score[i]);
    gemma = rank;
  } catch {
    gemma = false; // 파일이 없으면 tik 로 떨어진다
  }
  return gemma;
}

// 점수가 높은 짝부터 붙여 나간다. 더 붙일 것이 없으면 그것이 토큰 수.
function countGemma(text, rank) {
  // 스페이스를 ▁ 로 바꾸는 것이 SentencePiece 의 규약임
  const prepared = "▁" + String(text).replace(/ /g, "▁");
  let parts = [...prepared];
  for (;;) {
    let bestAt = -1;
    let best = -Infinity;
    for (let i = 0; i < parts.length - 1; i++) {
      const joined = parts[i] + parts[i + 1];
      const got = rank.get(joined);
      if (got !== undefined && got > best) {
        best = got;
        bestAt = i;
      }
    }
    if (bestAt < 0) break;
    parts.splice(bestAt, 2, parts[bestAt] + parts[bestAt + 1]);
  }
  return parts.length;
}

// ── 바깥에서 쓰는 것 ────────────────────────────────────────────────────────

// 그 모델이 쓰는 토크나이저. 모르면 tik 로 어림.
function tokenizerFor(registry, model) {
  if (!registry || !model) return "tik";
  const found = models.modelsOf(registry).find((one) => one.modelId === model);
  return found?.tokenizer || "tik";
}

// 글 하나가 몇 토큰인지, 어느 기준으로 셌는지
function count(text, tokenizer = "tik") {
  const body = String(text ?? "");
  if (tokenizer === "gemma") {
    const rank = loadGemma();
    if (rank) return { tokens: body ? countGemma(body, rank) : 0, by: "gemma", exact: true };
  }
  // claude 는 공개 토크나이저가 없다. gemma 파일이 없을 때도 여기로 온다.
  return { tokens: body ? tikCount(body) : 0, by: "tik", exact: tokenizer === "tik" };
}

/**
 * 요청 하나가 몇 토큰인지. 메시지를 감싸는 몫까지 더한 값.
 * 본문만 세려면 `count` 를 쓴다(프롬프트 칸이 그렇게 쓴다).
 */
function countMessages(messages, tokenizer = "tik", dialect = "openai") {
  const wrap = FRAMING[dialect] || FRAMING.openai;
  let total = wrap.perRequest;
  const each = [];
  for (const one of messages || []) {
    const got = count(one?.content ?? one?.text ?? "", tokenizer);
    each.push(got.tokens);
    total += got.tokens + wrap.perMessage;
  }
  const got = count("", tokenizer);
  return { total, body: total - wrap.perRequest - (messages || []).length * wrap.perMessage, each, by: got.by, exact: got.exact };
}

/**
 * 앤트로픽에 직접 물어 정확히 측정. 무과금, ~150ms
 * 감싸는 몫까지 포함된 값이 오므로 본문만 필요하면 빼서 사용
 */
async function countByAnthropic(messages, { model, apiKey, timeoutMs = 15000 } = {}) {
  if (!apiKey || !model) return null;
  const body = {
    model,
    messages: (messages || []).map((one) => ({ role: one.role === "assistant" ? "assistant" : "user", content: String(one.content ?? one.text ?? "") })).filter((one) => one.content),
  };
  const system = (messages || [])
    .filter((one) => one.role === "system")
    .map((one) => one.content ?? one.text)
    .join(String.fromCharCode(10, 10));
  if (system) body.system = system;
  body.messages = body.messages.filter((one) => one.role !== "system");
  if (!body.messages.length) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return typeof json?.input_tokens === "number" ? json.input_tokens : null;
}

const exported = { count, countMessages, countByAnthropic, tokenizerFor, FRAMING, GEMMA_FILE, _readPieces: readPieces };
export default exported;
export { exported as "module.exports" };
