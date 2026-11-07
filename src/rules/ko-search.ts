// 한국어를 아는 검색. 검색어의 마지막 글자는 아직 조합 중일 수 있다(입력기가 "음ㅇ", "가" 같은 덜 된 글자를 넘긴다).
// 그래서 마지막 글자는 자모로 풀어 앞부분만 맞으면 찾는다: "음ㅇ" → 음악, "음악 가" → 음악 감상실, "간" → 가나(받침이 다음 글자 첫소리로 넘어가는 중), "고" → 과일.
// 자음만 입력한 검색어는 초성으로도 찾는다(ㅇㅇㄱㅅㅅ → 음악 감상실). 영문은 대소문자를 가리지 않는다
// 봇(캐시 DB 필터)과 화면(서버 목록, 선택지 검색 등)이 같이 쓴다. Node 를 부르지 않는다
//
// 검색어마다 이 규칙을 정규식 하나로 만들어 두고(최근 것 몇 개를 기억한다) 엔진으로 찾는다. 줄마다 자모로 풀지 않는다.
// 정규식에는 백트래킹이 거의 없다: 마지막 글자의 분기는 첫 글자로 서로 겹치지 않고(글자마다 자모가 하나),
// 초성 사이의 공백은 초성 글자와 겹치지 않는다. 겹치게 바꾸면 백트래킹이 늘어 긴 글에서 멈춘다

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
// 겹받침, 겹모음은 입력하는 순서대로 푼다(ㄺ = ㄹ 다음 ㄱ, ㅘ = ㅗ 다음 ㅏ)
const SPLIT: Record<string, string> = { ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ", ㄽ: "ㄹㅅ", ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ", ㅘ: "ㅗㅏ", ㅙ: "ㅗㅐ", ㅚ: "ㅗㅣ", ㅝ: "ㅜㅓ", ㅞ: "ㅜㅔ", ㅟ: "ㅜㅣ", ㅢ: "ㅡㅣ" };

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
/** 초성 하나가 맡는 음절 수(중성 21 × 종성 28) */
const PER_CHO = 588;
// 호환 자모(ㄱ ~ ㆎ)
const JAMO_FIRST = 0x3131;
const JAMO_LAST = 0x318e;

const isSyllableCode = (c: number) => c >= SYLLABLE_FIRST && c <= SYLLABLE_LAST;
const split = (j: string) => SPLIT[j] ?? j;

/** 글자 하나(UTF-16 단위)를 입력하는 순서의 자모로 바꾼다(한글 음절이 아니면 그 글자, 겹자모는 푼다) */
function jamoOf(c: string): string {
  const code = c.charCodeAt(0);
  if (!isSyllableCode(code)) return split(c);
  const i = code - SYLLABLE_FIRST;
  return CHO[Math.floor(i / PER_CHO)] + split(JUNG[Math.floor((i % PER_CHO) / 28)]) + split(JONG[i % 28]);
}

type Entry = { code: number; jamo: string };
let byFirstJamo: Map<string, Entry[]> | null = null;
/** 음절과 호환 자모를 자모의 첫 글자로 묶은 표. 처음 검색할 때 만든다(화면도 불러 쓴다) */
function table(): Map<string, Entry[]> {
  if (byFirstJamo) return byFirstJamo;
  const map = new Map<string, Entry[]>();
  const add = (code: number) => {
    const jamo = jamoOf(String.fromCharCode(code));
    const list = map.get(jamo[0]);
    if (list) list.push({ code, jamo });
    else map.set(jamo[0], [{ code, jamo }]);
  };
  for (let c = SYLLABLE_FIRST; c <= SYLLABLE_LAST; c++) add(c);
  for (let c = JAMO_FIRST; c <= JAMO_LAST; c++) add(c);
  byFirstJamo = map;
  return map;
}
const inTable = (code: number) => isSyllableCode(code) || (code >= JAMO_FIRST && code <= JAMO_LAST);

const unit = (code: number) => `\\u${code.toString(16).padStart(4, "0")}`;
/** 정규식에 글 그대로: 영문 소문자, 숫자, 공백 말고는 모두 \uXXXX로(메타 문자, 줄 끝 문자가 뜻을 갖지 않게) */
const literal = (s: string) => [...Array(s.length).keys()].map((i) => (/[a-z0-9 ]/.test(s[i]) ? s[i] : unit(s.charCodeAt(i)))).join("");

/** 문자 코드들의 문자 클래스([...]) */
function charClass(codes: number[]): string {
  const sorted = [...new Set(codes)].sort((a, b) => a - b);
  if (sorted.length === 1) return unit(sorted[0]);
  let out = "";
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out += j === i ? unit(sorted[i]) : `${unit(sorted[i])}-${unit(sorted[j])}`;
    i = j + 1;
  }
  return `[${out}]`;
}

/** 자모가 jamo로 시작하는 글자들(표 밖의 글자는 자모가 자기 자신이다) */
function startingWith(jamo: string, exact: boolean): number[] {
  const codes = (table().get(jamo[0]) ?? []).filter((e) => (exact ? e.jamo === jamo : e.jamo.startsWith(jamo))).map((e) => e.code);
  const first = jamo.charCodeAt(0);
  if (jamo.length === 1 && !inTable(first)) codes.push(first);
  return codes;
}

/** 자모로 풀면 rest로 시작하는 글 1 ~ chars 글자(마지막 글자를 조합 중으로 본다). 분기는 첫 글자로 서로 겹치지 않는다 */
function tailPattern(rest: string, chars: number): string {
  const alts: string[] = [];
  const whole = startingWith(rest, false);
  if (whole.length) alts.push(charClass(whole));
  for (let n = 1; chars > 1 && n < rest.length; n++) {
    const head = startingWith(rest.slice(0, n), true);
    if (!head.length) continue;
    const next = tailPattern(rest.slice(n), chars - 1);
    if (next) alts.push(charClass(head) + next);
  }
  if (alts.length <= 1) return alts[0] ?? "";
  return `(?:${alts.join("|")})`;
}

const onlyConsonants = (q: string) => /^[ㄱ-ㅎ]+$/.test(q);

/** 초성 하나: 그 초성의 음절, 그 자음 자체 */
function initialClass(consonant: string): string {
  const i = CHO.indexOf(consonant);
  const codes = [consonant.charCodeAt(0)];
  if (i >= 0) for (let c = SYLLABLE_FIRST + i * PER_CHO; c < SYLLABLE_FIRST + (i + 1) * PER_CHO; c++) codes.push(c);
  return charClass(codes);
}

/** 다듬은 검색어(q)의 정규식 원문. tail: 그대로, 마지막 글자는 조합 중으로. initial: 자음만이면 초성(glue: 초성 사이에 건너는 공백, 초성 글자와 겹치면 안 된다) */
function sourcesOf(q: string, glue: string): { tail: string; initial: string | null } {
  // 마지막 글자는 표에 있거나 자기 자신이라 분기가 비지 않는다
  const tail = literal(q.slice(0, -1)) + tailPattern(jamoOf(q.slice(-1)), 3);
  const bare = q.replace(/\s+/g, "");
  return { tail, initial: onlyConsonants(bare) ? [...bare].map(initialClass).join(glue) : null };
}

const tidy = (s: string) => s.normalize("NFC").toLowerCase();

type Matcher = { any: RegExp; tail: RegExp; initial: RegExp | null; start: RegExp };
const CACHE_MAX = 16;
const cache = new Map<string, Matcher | null>();

/** 검색어의 정규식들(빈 검색어면 null). 최근 CACHE_MAX개를 캐시한다(목록을 필터링할 때 같은 검색어로 거듭 부른다) */
function matcherOf(query: string): Matcher | null {
  const known = cache.get(query);
  if (known !== undefined) return known;
  const q = tidy(query.trim());
  let made: Matcher | null = null;
  if (q) {
    const { tail, initial } = sourcesOf(q, "\\s*");
    made = {
      any: new RegExp(initial ? `${tail}|${initial}` : tail),
      tail: new RegExp(tail, "g"),
      initial: initial ? new RegExp(initial, "g") : null,
      start: new RegExp(initial ? `^(?:${tail})|^\\s*(?:${initial})` : `^(?:${tail})`),
    };
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(query, made);
  return made;
}

type Range = [number, number];

/** 겹치는 자리를 합친다 */
function merge(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const r of [...ranges].sort((x, y) => x[0] - y[0])) {
    const prev = out[out.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}
const rangesOf = (re: RegExp, t: string): Range[] => [...t.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);

/** text 에서 query 를 찾는다 */
export function koMatch(text: string, query: string): boolean {
  const m = matcherOf(query);
  return !m || m.any.test(tidy(text));
}

/**
 * text 에서 query 가 맞은 자리 [시작, 끝) 들(koMatch 와 같은 규칙, 겹치지 않게 앞에서부터). 맞은 글자를 칠할 때.
 * 다듬으면 글자 수가 바뀌는 글(NFC 로 합쳐지는 자모 등)은 자리를 되짚을 수 없어 빈 목록이다
 */
export function koRanges(text: string, query: string): Range[] {
  const m = matcherOf(query);
  const t = tidy(text);
  if (!m || t.length !== text.length) return [];
  const tail = rangesOf(m.tail, t);
  return m.initial ? merge([...tail, ...rangesOf(m.initial, t)]) : tail;
}

/** text 가 query 로 시작하는지(koMatch 와 같은 규칙, 맨 앞에서만). 앞에서 걸리는 것을 먼저 보일 때 */
export function koStarts(text: string, query: string): boolean {
  const m = matcherOf(query);
  return !m || m.start.test(tidy(text));
}

/**
 * koMatch의 정규식 원문(빈 검색어면 null). 다듬은 글(koTidy)에 쓴다. glue: 초성 사이에 건너는 공백(바이트 그대로의 JSON처럼
 * 공백을 다르게 쓴 글에 쓸 때). 초성 글자(음절, 자음)와 겹치는 것을 넣으면 안 된다
 */
export function koPattern(query: string, glue = "\\s*"): string | null {
  const q = tidy(query.trim());
  if (!q) return null;
  const { tail, initial } = sourcesOf(q, glue);
  return initial ? `${tail}|${initial}` : tail;
}

/** koMatch가 비교하기 전에 글을 다듬는 함수(NFC, 소문자) */
export const koTidy = tidy;
