// 상태 문구 조건(양력, 음력, 시간대)의 범위 ↔ 고르개(ConditionRangeField). 저장 형식은 "MM-DD ~ MM-DD", "HH:MM ~ HH:MM"(config/schema/status).
// 끝이 시작보다 앞이면 연말, 자정을 넘기는 범위다(봇이 그렇게 판정한다, ui/bot-presence)

import type { ConditionKey } from "./presence-rows.ts";
import { text } from "../text/index.ts";

/** 한쪽 끝: 날짜는 [월 0 ~ 11, 일 0 ~], 시간대는 [시, 분] */
type End = [number, number];
type Range = { start: End; end: End };

// 양력 달마다 날 수(연도가 없어 2월은 29일까지). 음력은 큰달이 30일
const SOLAR_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** 그 달의 날 수 */
const daysIn = (kind: ConditionKey, month: number) => (kind === "lunar" ? 30 : SOLAR_DAYS[month]);

const two = (n: number) => String(n).padStart(2, "0");

/** 저장 형식 → 범위. 비었거나 못 읽으면 null */
function parseRange(kind: ConditionKey, value: string): Range | null {
  const shape = kind === "time" ? /^(\d{2}):(\d{2})$/ : /^(\d{2})-(\d{2})$/;
  const parts = value.split("~").map((part) => shape.exec(part.trim()));
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const end = (m: RegExpExecArray): End => (kind === "time" ? [Number(m[1]), Number(m[2])] : [Number(m[1]) - 1, Number(m[2]) - 1]);
  return { start: end(parts[0]), end: end(parts[1]) };
}

/** 범위 → 저장 형식 */
function formatRange(kind: ConditionKey, { start, end }: Range) {
  const one = ([a, b]: End) => (kind === "time" ? `${two(a)}:${two(b)}` : `${two(a + 1)}-${two(b + 1)}`);
  return `${one(start)} ~ ${one(end)}`;
}

/** 끝이 시작보다 앞인가(연말, 자정을 넘긴다) */
const wraps = ({ start, end }: Range) => end[0] < start[0] || (end[0] === start[0] && end[1] < start[1]);

/** 입력란, 목록 툴팁의 글: "12월 24일 ~ 12월 26일", 하루면 "1월 1일 하루", 넘기면 "~ 다음 해 1월 5일", 시간대는 "22:00 ~ 다음 날 06:00" */
function rangeText(kind: ConditionKey, range: Range) {
  const T = text.presence.range;
  const one = ([a, b]: End) => (kind === "time" ? `${two(a)}:${two(b)}` : T.monthDay(a + 1, b + 1));
  const same = range.start[0] === range.end[0] && range.start[1] === range.end[1];
  if (kind !== "time" && same) return T.oneDay(one(range.start));
  const end = one(range.end);
  return `${one(range.start)} ~ ${wraps(range) ? (kind === "time" ? T.nextDay(end) : T.nextYear(end)) : end}`;
}

export { daysIn, parseRange, formatRange, wraps, rangeText };
export type { End, Range };
