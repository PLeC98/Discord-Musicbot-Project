// 점 표기 경로(a.b.c)로 중첩 객체의 필드에 값을 넣고 뺀다. AI 요청 본문에 모델 필드와 추가 파라미터를 넣을 때 쓴다. 화면도 부르는 Node 없는 모듈

type Body = Record<string, unknown>;

// `__proto__` 한 마디면 Object.prototype이 통째로 오염된다. 점 경로는 설정 문자열뿐 아니라
// 모델 레지스트리(외부에서 받아 오는 데이터)의 mapsTo.path로도 들어오므로 여기서 막는다.
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
    // safeKeys가 이미 필터링했지만 여기서도 본다. 분석기가 알아보는 위치는 대입 바로 옆이다
    if (k === "__proto__" || k === "constructor" || k === "prototype") return obj;
    // 앞 줄이 같은 경로에 값을 넣어 뒀으면 덮어쓴다. 객체가 아니라 안쪽에 더 넣을 수 없다
    if (!at[k] || typeof at[k] !== "object" || Array.isArray(at[k])) at[k] = {};
    at = at[k] as Body;
  }
  const last = keys[keys.length - 1];
  if (last === "__proto__" || last === "constructor" || last === "prototype") return obj;
  at[last] = value;
  return obj;
}

/** 점 경로로 삭제한다. 없는 경로면 아무 일도 안 한다. */
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

export { UNSAFE_KEYS, safeKeys, setPath, delPath };
