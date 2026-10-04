// 대시보드 서버의 문제 응답(RFC 9457)을 사람이 읽을 글로. 문장은 봇과 같이 쓰는 안내(src/ui/text/ko/errors.ts)에서 코드로 고른다.
// 봇 쪽 거절은 디스코드와 같은 문장만. 웹 쪽 오류(대시보드에서만 나는 코드)는 웹 오류 화면처럼 끝 줄에 코드와 HTTP 상태를 함께 적는다.
// 응답 없이 실패한 요청(시간 한도 · 연결 안 됨)은 화면만의 문장이고 코드를 적는다.
// 공유 문장의 꾸밈(굵게 · 코드)은 지금 화면이 글자로만 보여서 뗀다

import { notice } from "../../../src/ui/text/ko/errors.ts";
import { isCode, isWebCode } from "../../../src/rules/problems.ts";
import { failureKind } from "./request.js";

const plain = (text) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");

// 응답 없이 실패한 요청. 키는 request.js 의 failureKind
const UNANSWERED = {
  timeout: { code: "request-timeout", severity: "warning", title: "응답이 너무 늦어요!", body: "봇이 정해진 시간 안에 답하지 않았어요. 요청이 처리됐을 수도 있으니 화면을 확인한 뒤 다시 시도해 주세요." },
  offline: { code: "no-connection", severity: "error", title: "봇에 연결할 수 없어요!", body: "봇이 꺼져 있거나 네트워크에 문제가 있어요. 잠시 뒤에 다시 시도해 주세요." },
};

/**
 * 요청 오류(axios)의 안내: 머리 줄 · 본문 · 운영자용 원문(detail) · 끝 줄(codeLine, 웹 쪽 오류와 응답 없는 실패만) · 심각한 정도.
 * 문제 응답도 응답 없는 실패도 아니면 fallback 을 머리 줄로
 */
export function problemNotice(error, fallback) {
  const data = error?.response?.data;
  if (data && typeof data.code === "string" && isCode(data.code)) {
    const { title, body, severity } = notice(data.code, data);
    const status = error.response.status ?? data.status;
    const codeLine = isWebCode(data.code) ? `오류 코드: ${data.code} (HTTP ${status})` : "";
    return { title: plain(title), body: body ? plain(body) : "", detail: typeof data.detail === "string" ? data.detail : "", codeLine, severity };
  }
  const unanswered = UNANSWERED[failureKind(error)];
  if (unanswered) {
    const { code, ...rest } = unanswered;
    return { ...rest, detail: "", codeLine: `오류 코드: ${code}` };
  }
  return { title: fallback, body: "", detail: "", codeLine: "", severity: "error" };
}

/** problemNotice 를 줄로 이은 글 */
export function problemText(error, fallback) {
  const { title, body, detail, codeLine } = problemNotice(error, fallback);
  return [title, body, detail, codeLine].filter(Boolean).join("\n");
}

/** 칸별 문제의 운영자용 원문 목록(설정 검사). 없으면 빈 목록 */
export function problemDetails(error) {
  const errors = error?.response?.data?.errors;
  return Array.isArray(errors) ? errors.map((one) => one.detail).filter(Boolean) : [];
}
