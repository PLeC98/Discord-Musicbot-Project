// 대시보드 서버의 문제 응답(RFC 9457)을 사람이 읽을 글로. 문장은 봇과 같이 쓰는 안내(src/ui/text/ko/errors.ts)에서 코드로 고른다.
// 공유 문장의 꾸밈(굵게 · 코드)은 지금 화면이 글자로만 보여서 뗀다. 꾸밈을 살려 그리는 것은 대시보드 개편 몫

import { notice } from "../../../src/ui/text/ko/errors.ts";
import { isCode } from "../../../src/rules/problems.ts";

const plain = (text) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");

/** 요청 오류(axios)의 문제 응답 → 머리 줄 · 본문 · 운영자용 원문(detail)을 이은 글. 문제 응답이 아니거나 모르는 코드면 fallback */
export function problemText(error, fallback) {
  const data = error?.response?.data;
  if (!data || typeof data.code !== "string" || !isCode(data.code)) return fallback;
  const { title, body } = notice(data.code, data);
  return [title, body, data.detail].filter(Boolean).map(plain).join("\n");
}

/** 칸별 문제의 운영자용 원문 목록(설정 검사). 없으면 빈 목록 */
export function problemDetails(error) {
  const errors = error?.response?.data?.errors;
  return Array.isArray(errors) ? errors.map((one) => one.detail).filter(Boolean) : [];
}

/** 문제 응답의 코드. 문제 응답이 아니면 null */
export const problemCode = (error) => (typeof error?.response?.data?.code === "string" ? error.response.data.code : null);
