// 한국어를 아는 찾기. 검색어의 마지막 글자는 아직 조합 중일 수 있다(입력기가 "음ㅇ" · "가" 같은 덜 된 글자를 넘긴다).
// 그래서 마지막 글자는 자모로 풀어 앞부분만 맞으면 찾는다: "음ㅇ" → 음악, "음악 가" → 음악 감상실, "간" → 가나(받침이 다음 글자 첫소리로 넘어가는 중), "고" → 과일.
// 자음만 입력한 검색어는 초성으로도 찾는다(ㅇㅇㄱㅅㅅ → 음악 감상실). 영문은 대소문자를 가리지 않는다
// 봇(캐시 DB 필터)과 화면(서버 목록 · 선택지 찾기 등)이 같이 쓴다. Node 를 부르지 않는다

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
// 겹받침 · 겹모음은 입력하는 순서대로 푼다(ㄺ = ㄹ 다음 ㄱ, ㅘ = ㅗ 다음 ㅏ)
const SPLIT: Record<string, string> = { ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ", ㄽ: "ㄹㅅ", ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ", ㅘ: "ㅗㅏ", ㅙ: "ㅗㅐ", ㅚ: "ㅗㅣ", ㅝ: "ㅜㅓ", ㅞ: "ㅜㅔ", ㅟ: "ㅜㅣ", ㅢ: "ㅡㅣ" };

const isSyllable = (c: string) => c >= "가" && c <= "힣";
const split = (j: string) => SPLIT[j] ?? j;

/** 글을 입력하는 순서의 자모로 푼다(한글이 아닌 글자는 그대로) */
function jamo(text: string): string {
  let out = "";
  for (const c of text) {
    if (!isSyllable(c)) {
      out += split(c);
      continue;
    }
    const i = c.charCodeAt(0) - 0xac00;
    out += CHO[Math.floor(i / 588)] + split(JUNG[Math.floor((i % 588) / 28)]) + split(JONG[i % 28]);
  }
  return out;
}

/** 글자마다 첫소리(한글이 아니면 그 글자) */
const initials = (text: string) => [...text].map((c) => (isSyllable(c) ? CHO[Math.floor((c.charCodeAt(0) - 0xac00) / 588)] : c)).join("");

const onlyConsonants = (q: string) => /^[ㄱ-ㅎ]+$/.test(q);

type Range = [number, number];

/** 덜 된 글자가 걸친 글자까지의 끝(맞지 않으면 -1). from 부터 최대 세 글자를 자모로 견준다 */
function tailEnd(t: string, from: number, last: string): number {
  for (let k = 1; k <= 3 && from + k <= t.length; k++) {
    if (jamo(t.slice(from, from + k)).startsWith(last)) return from + k;
  }
  return -1;
}

// 마지막 글자만 덜 된 글자로 보고, 앞은 그대로 맞는 위치에서 뒤를 자모로 견준다. 덜 된 글자가 걸친 글자까지 맞은 자리다
// (그대로 들어 있는 것도 여기서 걸린다: 마지막 글자의 자모는 자기 자신으로 시작한다)
function tailMatches(t: string, q: string, all: boolean): Range[] {
  const out: Range[] = [];
  const head = q.slice(0, -1);
  const last = jamo(q.slice(-1));
  for (let i = t.indexOf(head); i >= 0 && i < t.length;) {
    const end = tailEnd(t, i + head.length, last);
    if (end < 0) {
      i = t.indexOf(head, i + 1);
      continue;
    }
    out.push([i, end]);
    if (!all) break;
    i = t.indexOf(head, end);
  }
  return out;
}

// 자음만: 초성 찾기(띄어쓰기는 보지 않는다). 띄어쓰기를 뺀 글의 자리를 원래 자리로 되돌린다
function initialMatches(t: string, bare: string, all: boolean): Range[] {
  const out: Range[] = [];
  const kept: number[] = [];
  for (let i = 0; i < t.length; i++) if (!/\s/.test(t[i])) kept.push(i);
  const chos = initials(kept.map((i) => t[i]).join(""));
  for (let i = chos.indexOf(bare); i >= 0; i = chos.indexOf(bare, i + bare.length)) {
    out.push([kept[i], kept[i + bare.length - 1] + 1]);
    if (!all) break;
  }
  return out;
}

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

/** 맞은 자리 [시작, 끝) 들. all 이 아니면 첫 자리 하나에서 멈춘다. t · q 는 다듬은 글(NFC · 소문자, q 는 앞뒤 공백 없음) */
function find(t: string, q: string, all: boolean): Range[] {
  const tail = tailMatches(t, q, all);
  const bare = q.replace(/\s+/g, "");
  if (!onlyConsonants(bare) || (tail.length && !all)) return tail;
  return merge([...tail, ...initialMatches(t, bare, all)]);
}

const tidy = (s: string) => s.normalize("NFC").toLowerCase();

/** text 에서 query 를 찾는다 */
export function koMatch(text: string, query: string): boolean {
  const q = tidy(query.trim());
  return !q || find(tidy(text), q, false).length > 0;
}

/**
 * text 에서 query 가 맞은 자리 [시작, 끝) 들(koMatch 와 같은 규칙, 겹치지 않게 앞에서부터). 맞은 글자를 칠할 때.
 * 다듬으면 글자 수가 바뀌는 글(NFC 로 합쳐지는 자모 등)은 자리를 되짚을 수 없어 빈 목록이다
 */
export function koRanges(text: string, query: string): Range[] {
  const q = tidy(query.trim());
  const t = tidy(text);
  if (!q || t.length !== text.length) return [];
  return find(t, q, true);
}

/** text 가 query 로 시작하는지(koMatch 와 같은 규칙, 맨 앞에서만). 앞에서 걸리는 것을 먼저 보일 때 */
export function koStarts(text: string, query: string): boolean {
  const q = query.trim().normalize("NFC").toLowerCase();
  if (!q) return true;
  const t = text.normalize("NFC").toLowerCase();
  if (t.startsWith(q)) return true;
  const head = q.slice(0, -1);
  if (t.startsWith(head) && jamo(t.slice(head.length, head.length + 3)).startsWith(jamo(q.slice(-1)))) return true;
  const bare = q.replace(/\s+/g, "");
  return onlyConsonants(bare) && initials(t.replace(/\s+/g, "")).startsWith(bare);
}
