// 로그 문구 서술자: 로그, 예외 메시지의 글 대신 넘기는 것. 언어와 상관없는 문구 코드(event)와 값(args)을 들고, 글은 쓰는 쪽이 필요할 때 그린다(renderLogText).
// 그리기는 절대 던지지 않는다: 문구 함수가 던지면 표식(FAILED_MARK)과 코드, 값을 적은 대체 글을 낸다. catch 블록 안에서 로그를 찍다 원래 오류가 묻히지 않게.
// 아무 모듈도 부르지 않는다(화면 번들에 들어가는 모듈도 서술자를 알아본다)

const RENDER: unique symbol = Symbol.for("musicbot.log-text.render");

/** 문구에 넣는 값. 원시값과 다른 서술자(라벨)만 받는다: 객체, Error, BigInt는 로그 파일 직렬화에 실패하거나 signed URL, 헤더를 통째로 남긴다 */
type LogArg = string | number | boolean | null | LogText;
type LogArgs = { readonly [name: string]: LogArg };
/** event: 문구 코드(<네임스페이스>.<키>), args: 값. 둘 다 Object.freeze 해 두어 맨 위에 만들어 둔 서술자를 가리기(redact)가 바꾸지 못한다 */
type LogText = { readonly event: string; readonly args: LogArgs; readonly [RENDER]: () => string };
/** 로거의 병합 객체(바인딩). 서술자는 받지 않는다. 병합 객체 자리에 넣으면 글이 빠진다 */
type LogBindings = { readonly [RENDER]?: never; readonly [field: string]: unknown };

/** 그리기에 실패한 글의 표식. 언어와 상관없이 찾도록 ASCII다 */
const FAILED_MARK = "[log-text-failed]";

const isLogText = (value: unknown): value is LogText => typeof value === "object" && value !== null && RENDER in value;

// 대체 글의 값. 직렬화도 실패하면 빈 표
function argsJson(args: LogArgs): string {
  try {
    return JSON.stringify(args);
  } catch {
    return "{}";
  }
}

// 그리기에 실패한 문구 코드(차례대로). 테스트의 실행 전체 검사(test/helpers/test-process)가 테스트마다 꺼내 본다. 운영에서는 꺼내는 쪽이 없어 상한까지만 쌓는다
const failedEvents: string[] = [];
const FAILED_KEEP = 100;

/** 서술자를 글로. 문구 함수가 던지면 표식이 붙은 대체 글 */
function renderLogText(text: LogText): string {
  try {
    return text[RENDER]();
  } catch {
    if (failedEvents.length < FAILED_KEEP) failedEvents.push(text.event);
    return `${FAILED_MARK} ${text.event} ${argsJson(text.args)}`;
  }
}

/** 지금까지 그리기에 실패한 문구 코드를 꺼내고 비운다 */
const takeRenderFailures = (): string[] => failedEvents.splice(0);

/**
 * 서술자를 만든다. render는 지금 로그 언어의 문구로 그리는 함수(만드는 쪽이 넘긴다).
 * 글을 받는 자리(템플릿 문자열, console, util.format)에 잘못 넘어가도 객체 덤프 대신 글이 나오게 toString과 inspect도 글을 그린다
 */
function logText(event: string, args: LogArgs, render: () => string): LogText {
  const text = { event, args: Object.freeze({ ...args }) };
  Object.defineProperties(text, {
    [RENDER]: { value: render },
    toString: { value: () => renderLogText(text as LogText) },
    [Symbol.for("nodejs.util.inspect.custom")]: { value: () => renderLogText(text as LogText) },
  });
  return Object.freeze(text) as LogText;
}

/** 값 안의 서술자를 글로 바꾼 값(문구 함수는 글만 받는다) */
const plainArgs = (args: LogArgs): Record<string, string | number | boolean | null> => Object.fromEntries(Object.entries(args).map(([name, value]) => [name, isLogText(value) ? renderLogText(value) : value]));

/** 레코드에 싣는 값: 값 안의 서술자를 { event, args }로 풀어 쓴 새 객체(원본은 그대로) */
const recordArgs = (args: LogArgs): Record<string, unknown> => Object.fromEntries(Object.entries(args).map(([name, value]) => [name, isLogText(value) ? { event: value.event, args: recordArgs(value.args) } : value]));

/**
 * 로그로만 가는 예외: 메시지는 서술자를 로그 언어로 그린 글이고, 서술자(logText)를 함께 든다(rules/text의 errorText가 꺼내 바깥 줄의 값 안에 남긴다).
 * code: 종류 판정(rules/error-kind)이 보는 이름
 */
function logTextError(text: LogText, { code, cause }: { code?: string; cause?: unknown } = {}): Error {
  return Object.assign(new Error(renderLogText(text), cause === undefined ? undefined : { cause }), { logText: text }, code === undefined ? {} : { code });
}

export { FAILED_MARK, isLogText, logText, logTextError, renderLogText, takeRenderFailures, plainArgs, recordArgs };
export type { LogArg, LogArgs, LogText, LogBindings };
