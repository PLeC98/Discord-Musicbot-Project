// 던져진 값에서 이름(code)과 메시지를 꺼낸다. 오류가 아닌 값도 받는다. 화면도 rules를 거쳐 부르므로 Node 타입을 쓰지 않는다

import { logTextError, type LogText } from "./log/log-text.ts";
import type { RuleProblem } from "../rules/rule-problem.ts";

/** 오류 코드(code)를 꺼낸다. 문자열도 숫자도 온다(디스코드 API는 숫자). DOMException의 옛 숫자 code(TimeoutError 23 등)는 뜻이 이름(name)에 있어 보지 않는다 */
function codeOf(error: unknown): string | number | undefined {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return undefined;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

/**
 * 기다려도 응답이 오지 않아 끊은 오류다(무응답, 응답 헤더 시간 초과). 이름이 TimeoutError라 실패 범위, 종류를 AbortSignal.timeout과 같게 네트워크 탓으로 본다.
 * 일반 Error에 name만 붙인다(DOMException은 code를 덮어쓰면 예외가 난다). extra는 함께 붙일 필드(code 등)다.
 * 메시지는 로그 언어로 그린 글이고 서술자(logText)를 함께 갖는다(infra/log/log-text의 logTextError)
 */
function timeoutError(message: LogText, extra: object = {}) {
  return Object.assign(logTextError(message), { name: "TimeoutError" }, extra);
}

/**
 * 화면 번들이 닿는 모듈과 기반 층(rules를 부를 수 없다)의 예외: 로그 문구, 규칙 문구의 진입점을 부를 수 없어 글 대신 규칙 문제를 갖고 메시지는 코드다.
 * 로그는 rules/text의 errorText가 그 문제를 로그 언어로, 화면은 보는 사람의 언어로 그린다
 */
function problemError(code: string, problem: RuleProblem) {
  return Object.assign(new Error(code), { code, problem });
}

// 이름만으로는 무슨 오류인지 모르는 것
const PLAIN_NAMES = new Set(["Error", "Object"]);
const SUMMARY_MAX = 300;

/**
 * 오류 글을 정하는 사실(언어와 상관없이). 메시지가 없으면 무슨 오류인지 알 수 있는 다음 것으로: 이름, 코드 → 예외를 던진 자리(스택 첫 줄) → 객체의 내용(줄여서) → 값 그대로.
 * message: 메시지(바깥 글이거나 만든 쪽의 글), thrown: 오류가 아닌 값을 던진 경우, at, unknown의 name은 이름만으로는 알 수 없는 이름(없으면 null).
 * 글은 쓰는 쪽이 그린다(화면은 규칙 문제로, 로그는 로그 언어로). 워커는 이것을 메인으로 보낸다
 */
type ErrorFacts = { kind: "message"; message: string } | { kind: "thrown"; value: string } | { kind: "name"; name: string } | { kind: "code"; code: string | number } | { kind: "at"; name: string | null; at: string } | { kind: "summary"; summary: string } | { kind: "unknown"; name: string | null };

function errorFacts(error: unknown): ErrorFacts {
  if (error && typeof error === "object") return objectFacts(error);
  return typeof error === "string" && error ? { kind: "message", message: error } : { kind: "thrown", value: String(error) };
}

// 객체로 던진 값의 사실. 차례는 errorFacts에 적은 것과 같다
function objectFacts(error: object): ErrorFacts {
  const { message, name, stack } = error as { message?: unknown; name?: unknown; stack?: unknown };
  if (typeof message === "string" && message) return { kind: "message", message };
  const label = typeof name === "string" && name ? name : (error.constructor?.name ?? null);
  if (label && !PLAIN_NAMES.has(label)) return { kind: "name", name: label };
  const code = codeOf(error);
  if (code !== undefined) return { kind: "code", code };
  const at = typeof stack === "string" ? stack.split("\n").find((line) => line.trim().startsWith("at ")) : undefined;
  if (at) return { kind: "at", name: label || null, at: at.trim() };
  const summary = summaryOf(error);
  return summary ? { kind: "summary", summary } : { kind: "unknown", name: label || null };
}

/**
 * 오류 글. 메시지가 없으면 언어와 상관없는 사실 그대로(던진 값, 코드, 이름과 던진 자리).
 * 그 사실을 문장으로 보이려면 화면은 규칙 문제(rules/error-kind의 errorProblem), 로그는 로그 문구(rules/text의 errorText)로 그린다
 */
function messageOf(error: unknown): string {
  const facts = errorFacts(error);
  switch (facts.kind) {
    case "message":
      return facts.message;
    case "thrown":
      return facts.value;
    case "name":
      return facts.name;
    case "code":
      return String(facts.code);
    case "at":
      return `${facts.name ?? "Error"} (${facts.at})`;
    case "summary":
      return facts.summary;
    case "unknown":
      return facts.name ?? "Error";
  }
}

/** 로그에 싣는 오류 글: 메시지 뒤에 오류 코드(있으면. 디스코드 오류 번호 등). 메시지가 없어 글이 이미 코드면 다시 붙이지 않는다 */
function messageWithCode(error: unknown): string {
  const code = codeOf(error);
  const text = messageOf(error);
  return code === undefined || errorFacts(error).kind === "code" ? text : `${text} (${code})`;
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

export { codeOf, errorFacts, messageOf, messageWithCode, problemError, timeoutError };
export type { ErrorFacts };
