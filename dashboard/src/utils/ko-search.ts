// 한국어를 아는 찾기. 검색어의 마지막 글자는 아직 조합 중일 수 있다(입력기가 "음ㅇ" · "가" 같은 덜 된 글자를 넘긴다).
// 그래서 마지막 글자는 자모로 풀어 앞부분만 맞으면 찾는다: "음ㅇ" → 음악, "음악 가" → 음악 감상실, "간" → 가나(받침이 다음 글자 첫소리로 넘어가는 중), "고" → 과일.
// 자음만 입력한 검색어는 초성으로도 찾는다(ㅇㅇㄱㅅㅅ → 음악 감상실). 영문은 대소문자를 가리지 않는다

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

/** text 에서 query 를 찾는다 */
export function koMatch(text: string, query: string): boolean {
  const q = query.trim().normalize("NFC").toLowerCase();
  if (!q) return true;
  const t = text.normalize("NFC").toLowerCase();
  if (t.includes(q)) return true;
  // 마지막 글자만 덜 된 글자로 보고, 앞은 그대로 맞는 위치에서 뒤를 자모로 견준다
  const head = q.slice(0, -1);
  const last = jamo(q.slice(-1));
  for (let i = t.indexOf(head); i >= 0 && i < t.length; i = t.indexOf(head, i + 1)) {
    if (jamo(t.slice(i + head.length, i + head.length + 3)).startsWith(last)) return true;
  }
  // 자음만: 초성 찾기(띄어쓰기는 보지 않는다)
  const bare = q.replace(/\s+/g, "");
  return onlyConsonants(bare) && initials(t.replace(/\s+/g, "")).includes(bare);
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
