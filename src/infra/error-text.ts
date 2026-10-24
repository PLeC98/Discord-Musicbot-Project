// 던져진 값에서 이름(code)과 메시지를 꺼낸다. 오류가 아닌 값도 받는다. 화면도 rules 를 거쳐 부르므로 Node 타입을 쓰지 않는다

/** 오류가 달고 온 이름(code). 문자열도 숫자도 온다(디스코드 API 는 숫자) */
function codeOf(error: unknown): string | number | undefined {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

/** 오류 메시지. 메시지가 없으면 fallback(주지 않으면 값을 그대로 문자열로) */
function messageOf(error: unknown, fallback = String(error)): string {
  const message = error && typeof error === "object" && "message" in error ? error.message : undefined;
  return (typeof message === "string" && message) || fallback;
}

export { codeOf, messageOf };
