// 언어 번들에서 빠진 문구를 기준 언어의 것으로 채운다. 봇, 그리기 워커, 대시보드(브라우저)가 같이 쓴다(로그, 설정을 읽지 않는 순수 함수).
// 저장소의 언어 번들은 타입 검사로 기준 언어와 같은 모양을 지킨다. 이 함수는 타입 검사를 거치지 않은 번들(포크, 손으로 고친 설치)에서 빠진 문구만 기준 언어의 것으로 바꾼다

/**
 * 비교하는 법: 키가 있는지, typeof, 배열인지만 본다. 함수는 있는지만 본다(매개변수 수는 나머지 매개변수, 래퍼 때문에 믿을 수 없다).
 * 배열은 통째로 문구 하나다(요일처럼 순서에 의미가 있다). 일반 객체와 모듈 네임스페이스는 키마다 들어가 채운다. 기준 언어에 없는 키는 버린다.
 * whole: 하나라도 빠지면 통째로 기준 언어로 채울 경로(짝으로 움직이는 함수가 든 모듈. 반쪽만 채우면 짝이 어긋난다)
 */
function fillFrom<T>(base: T, given: unknown, whole: ReadonlySet<string> = new Set()): { value: T; missing: string[] } {
  const missing: string[] = [];
  const value = fill(base, given, "", whole, missing) as T;
  return { value, missing };
}

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function fill(base: unknown, given: unknown, path: string, whole: ReadonlySet<string>, missing: string[]): unknown {
  if (Array.isArray(base)) return Array.isArray(given) ? given : lack(base, path, missing);
  if (isPlain(base)) {
    if (!isPlain(given)) return lack(base, path, missing);
    const inner: string[] = [];
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(base)) out[key] = fill(base[key], given[key], path ? `${path}.${key}` : key, whole, inner);
    missing.push(...inner);
    return inner.length && whole.has(path) ? base : out;
  }
  return typeof given === typeof base && given !== undefined ? given : lack(base, path, missing);
}

function lack(base: unknown, path: string, missing: string[]) {
  missing.push(path);
  return base;
}

export { fillFrom };
