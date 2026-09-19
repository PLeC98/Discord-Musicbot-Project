/**
 * 토큰 세기 — 요청이 몇 토큰짜리인지.
 *
 * 어느 토크나이저를 쓸지는 모델 프로필의 `recommendedTokenizer` 가 정한다.
 *   tik     OpenAI 계열 — gpt-tokenizer (o200k_base)
 *   gemma   제미니·젬마 — data/gemma-tokenizer.model (SentencePiece BPE)
 *   claude  앤트로픽은 공개 토크나이저가 없다 — tik 로 어림하고, 정확한 값은 저쪽 API 로 센다
 *
 * **어림수다.** 어느 기준으로 셌는지 같이 돌려주니 화면이 그대로 밝힌다.
 */
const fs = require("fs");
const path = require("path");

const GEMMA_FILE = path.join(__dirname, "..", "data", "gemma-tokenizer.model");

// 한 메시지를 감싸는 포장 몫. 실측으로 맞췄다(GPT-5·5.6·6 세대).
const WRAP_PER_MESSAGE = 3;
const WRAP_PER_REQUEST = 3;

// ── SentencePiece BPE ──────────────────────────────────────────────────────
// 조각마다 점수가 있고 **점수가 높은 짝부터 붙인다.** merges 목록이 따로 없는 이유다.
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

/** ModelProto 에서 조각과 점수만 꺼낸다. */
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

/** 점수가 높은 짝부터 붙여 나간다. 더 붙일 것이 없으면 그것이 토큰 수다. */
function countGemma(text, rank) {
  // 스페이스를 ▁ 로 바꾸는 것이 SentencePiece 의 규약이다
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

/** 그 모델이 쓰는 토크나이저. 모르면 tik 로 어림한다. */
function tokenizerFor(registry, model) {
  if (!registry || !model) return "tik";
  const found = require("./aiModels")
    .modelsOf(registry)
    .find((one) => one.modelId === model);
  return found?.tokenizer || "tik";
}

/** 글 하나가 몇 토큰인지. 어느 기준으로 셌는지 같이 준다. */
function count(text, tokenizer = "tik") {
  const body = String(text ?? "");
  if (!body) return { tokens: 0, by: tokenizer, exact: tokenizer === "tik" };

  if (tokenizer === "gemma") {
    const rank = loadGemma();
    if (rank) return { tokens: countGemma(body, rank), by: "gemma", exact: true };
  }
  // claude 는 공개 토크나이저가 없다. gemma 파일이 없을 때도 여기로 온다.
  return { tokens: require("gpt-tokenizer").encode(body).length, by: "tik", exact: tokenizer === "tik" };
}

/** 메시지 묶음 하나가 몇 토큰인지 — 포장 몫까지 더한 값. */
function countMessages(messages, tokenizer = "tik") {
  let total = WRAP_PER_REQUEST;
  const each = [];
  for (const one of messages || []) {
    const got = count(one?.content ?? one?.text ?? "", tokenizer);
    each.push(got.tokens);
    total += got.tokens + WRAP_PER_MESSAGE;
  }
  const by = count("", tokenizer).by;
  return { total, each, by, exact: false };
}

module.exports = { count, countMessages, tokenizerFor, GEMMA_FILE, _readPieces: readPieces };
