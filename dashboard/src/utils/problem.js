// 대시보드 서버의 문제 응답(RFC 9457)을 사람이 읽을 글로. 문장은 봇과 같이 쓰는 안내(src/ui/text/ko/errors.ts)에서 코드로 고른다.
// 응답 없이 실패한 요청(시간 한도 · 연결 안 됨)은 화면만의 문장이다. 어느 쪽이든 끝 줄에 코드를 적는다(운영자에게 알릴 때 쓴다).
// 공유 문장의 꾸밈(굵게 · 코드)은 지금 화면이 글자로만 보여서 뗀다

import { notice } from "../../../src/ui/text/ko/errors.ts";
import { isCode } from "../../../src/rules/problems.ts";
import { failureKind } from "./request.js";

const plain = (text) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");

// 응답 없이 실패한 요청. 키는 request.js 의 failureKind
const UNANSWERED = {
  timeout: { code: "request-timeout", severity: "warning", title: "응답이 너무 늦어요!", body: "봇이 정해진 시간 안에 답하지 않았어요. 요청이 처리됐을 수도 있으니 화면을 확인한 뒤 다시 시도해 주세요." },
  offline: { code: "no-connection", severity: "error", title: "봇에 연결할 수 없어요!", body: "봇이 꺼져 있거나 네트워크에 문제가 있어요. 잠시 뒤에 다시 시도해 주세요." },
};

/** 요청 오류(axios)의 안내: 머리 줄 · 본문 · 운영자용 원문(detail) · 코드 · 심각한 정도. 문제 응답도 응답 없는 실패도 아니면 fallback 을 머리 줄로(코드 없음) */
export function problemNotice(error, fallback) {
  const data = error?.response?.data;
  if (data && typeof data.code === "string" && isCode(data.code)) {
    const { title, body, severity } = notice(data.code, data);
    return { title: plain(title), body: body ? plain(body) : "", detail: typeof data.detail === "string" ? data.detail : "", code: data.code, severity };
  }
  const unanswered = UNANSWERED[failureKind(error)];
  if (unanswered) return { ...unanswered, detail: "" };
  return { title: fallback, body: "", detail: "", code: null, severity: "error" };
}

/** problemNotice 를 줄로 이은 글. 끝 줄이 코드 */
export function problemText(error, fallback) {
  const { title, body, detail, code } = problemNotice(error, fallback);
  return [title, body, detail, code && `오류 코드: ${code}`].filter(Boolean).join("\n");
}

/** 칸별 문제의 운영자용 원문 목록(설정 검사). 없으면 빈 목록 */
export function problemDetails(error) {
  const errors = error?.response?.data?.errors;
  return Array.isArray(errors) ? errors.map((one) => one.detail).filter(Boolean) : [];
}
