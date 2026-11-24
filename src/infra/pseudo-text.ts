// 테스트 언어. 기준 언어의 문구에서 한글 음절을 초성에 맞춘 영문자 하나로 바꾼다(봇, 대시보드가 같이 쓴다, Node 없는 모듈).
// 글자 수가 그대로이고 ASCII라서 디스코드의 길이 상한과 카드 글꼴 검사에 걸리지 않는다. 두 번 바꿔도 같다(문구가 다른 문구의 인자로 들어가도 된다).
// 문구 함수에 인자로 들어간 한글 데이터(곡 제목 등)도 함께 바뀐다

// 초성 19개(ㄱ ㄲ ㄴ ㄷ ㄸ ㄹ ㅁ ㅂ ㅃ ㅅ ㅆ ㅇ ㅈ ㅉ ㅊ ㅋ ㅌ ㅍ ㅎ)
const INITIALS = "gkndtrmbpssojjcktph";
const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
// 한 초성에 딸린 음절 수(중성 21 × 종성 28)
const PER_INITIAL = 21 * 28;

/** 한글 음절을 바꾼 글 */
function pseudoString(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code >= HANGUL_FIRST && code <= HANGUL_LAST ? INITIALS[Math.floor((code - HANGUL_FIRST) / PER_INITIAL)] : ch;
  }
  return out;
}

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * 문구 번들을 감싼다. 문자열, 배열, 일반 객체(모듈 네임스페이스 포함)는 안쪽까지 바꾸고, 함수는 돌려준 값을 바꾼다. 그 밖의 값은 그대로 넘긴다.
 * skip: 감싸지 않을 경로(문구가 아니라 사용자가 입력한 글에서 꺼낸 값을 돌려주는 함수)
 */
function pseudoText<T>(value: T, skip: ReadonlySet<string> = new Set(), path = ""): T {
  if (skip.has(path)) return value;
  if (typeof value === "string") return pseudoString(value) as T;
  if (typeof value === "function") return ((...args: unknown[]) => pseudoText((value as (...a: unknown[]) => unknown)(...args), skip)) as T;
  if (Array.isArray(value)) return value.map((one) => pseudoText(one, skip)) as T;
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([key, one]) => [key, pseudoText(one, skip, path ? `${path}.${key}` : key)])) as T;
  return value;
}

export { pseudoString, pseudoText };
