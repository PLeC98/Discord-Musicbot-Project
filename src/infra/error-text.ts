// 던져진 값에서 이름(code)과 메시지를 꺼낸다. 오류가 아닌 값도 받는다. 화면도 rules 를 거쳐 부르므로 Node 타입을 쓰지 않는다

/** 오류 코드(code)를 꺼낸다. 문자열도 숫자도 온다(디스코드 API는 숫자). DOMException의 옛 숫자 code(TimeoutError 23 등)는 뜻이 이름(name)에 있어 보지 않는다 */
function codeOf(error: unknown): string | number | undefined {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return undefined;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

/**
 * 기다려도 응답이 오지 않아 끊은 오류다(무응답, 응답 헤더 시간 초과). 이름이 TimeoutError라 실패 범위, 종류를 AbortSignal.timeout과 같게 네트워크 탓으로 본다.
 * 일반 Error에 name만 붙인다(DOMException은 code를 덮어쓰면 예외가 난다). extra는 함께 붙일 필드(code 등)다
 */
function timeoutError(message: string, extra: object = {}) {
  return Object.assign(new Error(message), { name: "TimeoutError" }, extra);
}

// 이름만으로는 무슨 오류인지 모르는 것
const PLAIN_NAMES = new Set(["Error", "Object"]);
const SUMMARY_MAX = 300;

/**
 * 오류 글. 메시지가 없으면 무슨 오류인지 알 수 있는 다음 것으로: 이름, 코드 → 던진 자리(스택 첫 줄) → 객체의 내용(줄여서) → 값 그대로
 */
function messageOf(error: unknown): string {
  if (!error || typeof error !== "object") return typeof error === "string" && error ? error : `던진 값: ${String(error)}`;
  const { message } = error as { message?: unknown };
  return typeof message === "string" && message ? message : withoutMessage(error);
}

// 메시지가 없는 오류, 객체
function withoutMessage(error: object): string {
  const { name, stack } = error as { name?: unknown; stack?: unknown };
  const label = typeof name === "string" && name ? name : error.constructor?.name;
  if (label && !PLAIN_NAMES.has(label)) return label;
  const code = codeOf(error);
  if (code !== undefined) return `오류 코드 ${code}`;
  const at = typeof stack === "string" ? stack.split("\n").find((line) => line.trim().startsWith("at ")) : undefined;
  if (at) return `메시지 없는 ${label ?? "오류"} (${at.trim()})`;
  return summaryOf(error) ?? `메시지 없는 ${label ?? "오류"}`;
}

// 객체의 내용을 줄여서. 비었거나 순환 참조면 null
function summaryOf(error: object): string | null {
  try {
    const json = JSON.stringify(error);
    if (!json || json === "{}") return null;
    return json.length > SUMMARY_MAX ? `${json.slice(0, SUMMARY_MAX)}…` : json;
  } catch {
    return null;
  }
}

export { codeOf, messageOf, timeoutError };
