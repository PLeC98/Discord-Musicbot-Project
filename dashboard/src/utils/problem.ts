// 대시보드 서버의 문제 응답(RFC 9457)을 사람이 읽을 글로. 문장은 봇과 같이 쓰는 안내(src/ui/text/ko/errors.ts)에서 코드로 선택한다.
// 봇 쪽 거절은 디스코드와 같은 문장만. 웹 쪽 오류(대시보드에서만 나는 코드)는 웹 오류 화면처럼 끝 줄에 코드와 HTTP 상태를 함께 적는다.
// 응답 없이 실패한 요청(시간 한도 · 연결 안 됨)은 화면만의 문장이고 코드를 적는다.
// 공유 문장의 꾸밈(굵게 · 코드)은 지금 화면이 글자로만 보여서 뗀다.
// 문장이 "봇 개발자에게 보고해 주세요"를 쓰면 보고할 곳(소스 저장소, /api/bot 의 sourceRepo)을 reportUrl 로 붙인다

import { notice, PLAIN } from "../../../src/ui/text/ko/errors.ts";
import { isCode, isWebCode, type Code } from "../../../src/rules/problems.ts";
import type { Notice } from "../../../src/ui/text/notice.ts";
import { paramsOf, type ProblemBody } from "../../../src/dashboard/contract/problem.ts";
import { failureKind, replyOf, statusOf, type FailureKind } from "./request.ts";
import { text } from "../text/index.ts";

const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");

// 보고할 곳. 화면이 처음 뜰 때 /api/bot 에서 불러와 넣는다(App.vue). 불러오기 전이면 붙이지 않는다
let reportTo = "";
export const setReportUrl = (url: unknown) => (reportTo = typeof url === "string" ? url : "");

/** 요청 오류의 안내. codeLine 은 웹 쪽 오류와 응답 없는 실패만, reportUrl 은 문장이 봇 개발자를 불렀을 때만 */
export type ProblemNotice = { title: string; body: string; detail: string; codeLine: string; severity: Notice["severity"]; reportUrl: string };

// 응답 없이 실패한 요청. 키는 request 의 failureKind
const UNANSWERED: Partial<Record<FailureKind, { code: string; severity: Notice["severity"]; title: string; body: string }>> = {
  timeout: { code: "request-timeout", severity: "warning", ...text.errors.timeout },
  offline: { code: "no-connection", severity: "error", ...text.errors.offline },
};

/** 끝 줄: 오류 코드(와 HTTP 상태) */
export const codeLineOf = text.errors.codeLine;

/** 봇과 같은 안내의 제목 줄 · 본문(꾸밈을 뗀 글). 요청 없이 화면이 먼저 알릴 때(조작이 막힌 까닭 등) */
export function noticeText(code: Code): { title: string; body: string } {
  const { title, body } = notice(code, {}, PLAIN);
  return { title: plain(title), body: body ? plain(body) : "" };
}

/** 응답 없이 실패한 요청의 제목 줄 */
export const unansweredTitle = (kind: FailureKind) => UNANSWERED[kind]?.title ?? "";

/** 응답 없이 실패한 요청의 알림 전체(알림에 표시하는 모양) */
export function unansweredNotice(kind: "timeout" | "offline"): ProblemNotice {
  const { code, ...rest } = UNANSWERED[kind]!;
  return { ...rest, detail: "", codeLine: codeLineOf(code), reportUrl: "" };
}

/** 요청 오류의 문제 응답 본문. 문제 응답이 아니면 undefined */
function problemOf(error: unknown): Partial<ProblemBody> | undefined {
  const data = replyOf(error);
  return data && typeof data === "object" ? (data as Partial<ProblemBody>) : undefined;
}

/**
 * 요청 오류(axios)의 안내: 제목 줄 · 본문 · 운영자용 원문(detail) · 끝 줄(codeLine, 웹 쪽 오류와 응답 없는 실패만) · 심각한 정도.
 * 문제 응답도 응답 없는 실패도 아니면 fallback 을 제목 줄로
 */
export function problemNotice(error: unknown, fallback: string): ProblemNotice {
  const data = problemOf(error);
  if (data && typeof data.code === "string" && isCode(data.code)) {
    // 문장이 봇 개발자를 불렀는지 본다. 불렀으면 보고할 곳을 붙인다
    let asked = false;
    const look = { ...PLAIN, developer: () => ((asked = true), PLAIN.developer()) };
    const { title, body, severity } = notice(data.code, paramsOf({ ...data, code: data.code }), look);
    const status = statusOf(error) ?? data.status;
    const codeLine = isWebCode(data.code) ? codeLineOf(data.code, status) : "";
    return { title: plain(title), body: body ? plain(body) : "", detail: typeof data.detail === "string" ? data.detail : "", codeLine, severity, reportUrl: asked ? reportTo : "" };
  }
  const kind = failureKind(error);
  if (kind === "timeout" || kind === "offline") return unansweredNotice(kind);
  return { title: fallback, body: "", detail: "", codeLine: "", severity: "error", reportUrl: "" };
}

/** problemNotice 를 줄로 이은 글 */
export function problemText(error: unknown, fallback: string): string {
  const { title, body, detail, codeLine, reportUrl } = problemNotice(error, fallback);
  return [title, body, detail, reportUrl && text.errors.reportAt(reportUrl), codeLine].filter(Boolean).join("\n");
}

/** 필드별 문제의 운영자용 원문 목록(설정 검사). 없으면 빈 목록 */
export function problemDetails(error: unknown): string[] {
  const errors = problemOf(error)?.errors;
  return Array.isArray(errors) ? errors.map((one) => one.detail).filter((detail): detail is string => Boolean(detail)) : [];
}
