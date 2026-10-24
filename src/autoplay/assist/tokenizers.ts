/**
 * 토크나이저로 글 하나를 센다. 바깥에 묻지 않고 이 프로세스에서 센다.
 * 무엇으로 셀지와 요청 하나를 세는 것은 tokens.ts
 */
import fs from "fs";
import path from "path";
import { PROJECT } from "../../infra/project-paths.ts";
import { codeOf, describeError } from "../../rules/error-kind.ts";

// gpt-tokenizer 는 표가 커서 불러 두면 메모리를 꽤 쓴다. AI 보조를 안 쓰는 봇이 떠안지 않게 처음 셀 때 부른다
let tik: Promise<typeof import("gpt-tokenizer")> | null = null;
// 본문에 적힌 <|endoftext|> 같은 특수 토큰 글자는 글자 그대로 센다(API 도 사용자 글을 그렇게 받는다). 기본값은 예외를 던진다
const tikCount = async (body: string) => (await (tik ??= import("gpt-tokenizer"))).countTokens(body, { disallowedSpecial: new Set() });

type Counted = { tokens: number; by: string; exact: boolean };

const GEMMA_FILE = path.join(PROJECT.data, "gemma-tokenizer.model");

// ── SentencePiece BPE ──────────────────────────────────────────────────────
// 조각마다 점수가 있고 점수가 높은 짝부터 붙인다. merges 목록이 따로 없는 이유다.
// 조각 → 점수. 파일이 없으면 false
let gemma: Map<string, number> | false | null = null;
// 파일이 있는데 읽지 못한 까닭. 이 모듈은 세는 스레드에서 돌아 로그가 봇 로그에 닿지 않으므로 스레드가 부모에게 한 번 넘긴다
let gemmaProblem: string | null = null;

function varint(buf: Buffer, at: number): [number, number] {
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
function readPieces(buf: Buffer) {
  const piece: string[] = [];
  const score: number[] = [];
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

function loadGemma(): Map<string, number> | false {
  if (gemma !== null) return gemma;
  try {
    const { piece, score } = readPieces(fs.readFileSync(GEMMA_FILE));
    const rank = new Map<string, number>();
    for (let i = 0; i < piece.length; i++) rank.set(piece[i], score[i]);
    gemma = rank;
  } catch (error) {
    gemma = false; // 파일이 없으면 tik 로 떨어진다
    if (codeOf(error) !== "ENOENT") gemmaProblem = describeError(error);
  }
  return gemma;
}

/** 젬마 파일을 읽지 못한 까닭. 한 번 꺼내면 비운다 */
function takeGemmaProblem() {
  const problem = gemmaProblem;
  gemmaProblem = null;
  return problem;
}

// 붙일 짝 하나. left · right 는 처음 글자 위치(왼쪽이 먼저인 순서를 지킨다)
type Pair = { score: number; left: number; right: number; joined: string };
// 점수가 높은 것, 같으면 왼쪽이 먼저
const before = (a: Pair, b: Pair) => a.score > b.score || (a.score === b.score && a.left < b.left);

/**
 * 점수가 높은 짝부터 붙여 나간다(같으면 왼쪽 먼저). 더 붙일 것이 없으면 그것이 토큰 수.
 * 조각을 연결 목록으로, 붙일 짝을 힙으로 둔다. 붙일 때마다 전부 훑으면 글 길이의 제곱이 든다
 */
function countGemma(text: string, rank: Map<string, number>) {
  // 스페이스를 ▁ 로 바꾸는 것이 SentencePiece 의 규약임
  const parts = [...("▁" + String(text).replace(/ /g, "▁"))];
  const n = parts.length;
  const prev = Array.from({ length: n }, (_, i) => i - 1);
  const next = Array.from({ length: n }, (_, i) => (i + 1 < n ? i + 1 : -1));
  const gone = new Uint8Array(n); // 왼쪽 조각에 붙어 사라진 위치
  const heap: Pair[] = [];
  const push = (pair: Pair) => {
    heap.push(pair);
    for (let i = heap.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (!before(heap[i], heap[up])) break;
      [heap[i], heap[up]] = [heap[up], heap[i]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop() as Pair;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < heap.length && before(heap[l], heap[best])) best = l;
        if (r < heap.length && before(heap[r], heap[best])) best = r;
        if (best === i) break;
        [heap[i], heap[best]] = [heap[best], heap[i]];
        i = best;
      }
    }
    return top;
  };
  const offer = (left: number) => {
    const right = left >= 0 ? next[left] : -1;
    if (right < 0) return;
    const joined = parts[left] + parts[right];
    const score = rank.get(joined);
    if (score !== undefined) push({ score, left, right, joined });
  };

  for (let i = 0; i < n - 1; i++) offer(i);
  let count = n;
  while (heap.length) {
    const { left, right, joined } = pop();
    // 그 사이 한쪽이 다른 짝에 붙었으면 낡은 짝이다
    if (gone[left] || next[left] !== right || parts[left] + parts[right] !== joined) continue;
    parts[left] = joined;
    gone[right] = 1;
    next[left] = next[right];
    if (next[right] >= 0) prev[next[right]] = left;
    count--;
    offer(prev[left]);
    offer(left);
  }
  return count;
}

// 글 하나가 몇 토큰인지, 어느 기준으로 셌는지
async function count(text: unknown, tokenizer = "tik"): Promise<Counted> {
  const body = String(text ?? "");
  if (tokenizer === "gemma") {
    const rank = loadGemma();
    if (rank) return { tokens: body ? countGemma(body, rank) : 0, by: "gemma", exact: true };
  }
  // claude 는 공개 토크나이저가 없다. gemma 파일이 없을 때도 여기로 온다.
  return { tokens: body ? await tikCount(body) : 0, by: "tik", exact: tokenizer === "tik" };
}

export { count, takeGemmaProblem, GEMMA_FILE, readPieces };
export type { Counted };
