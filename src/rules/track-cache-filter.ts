// 캐시 DB 의 필터 식(DB Browser for SQLite 의 열 필터 문법)을 읽고 비교한다. 봇(읽기 경로)과 화면(입력란 미리 보기)이 같이 쓴다. Node 를 부르지 않는다.
// 식: 그냥 쓰면 포함(대소문자 무시. 한국어는 조합 중인 마지막 글자 · 초성으로도 찾는다: rules/ko-search, 서버 목록 찾기와 같다. % 를 넣으면 아무 글자들) · =값 · <>값 · >값 <값 >=값 <=값 · 값~값(사이) · /정규식/(\/ 로 / 를 쓴다) · ='' (빔) · <>'' (빔 아님).
// 열의 형식에 따라 값을 읽는다: 크기는 10MB 같은 단위(없으면 바이트), 시각은 2026-10-17 · 2026-10-17 12:30 같은 날짜(이 기기의 시간대), 길이는 3:30 같은 분:초(없으면 초).
// 날짜 하나는 그날 하루다: =날짜 는 그날 안, >날짜 는 그날 뒤, >=날짜 는 그날부터, <날짜 는 그날 전, <=날짜 는 그날까지.
// 정규식은 서버가 음악 재생과 같은 이벤트 루프에서 돌리므로 길이 상한을 두고, 반복 안에 반복이 겹친 형태(오래 걸릴 수 있다)는 받지 않는다.

import type { Code } from "./problems.ts";
import { koMatch } from "./ko-search.ts";

/** 열 하나의 필터 식 · 아무 열에서나 필터 · 그 안의 정규식 길이 상한 */
const FILTER_MAX = 200;
const REGEX_MAX = 100;

/** 열의 형식. text: 문자열 · bytes: 크기 · time: 시각(ms) · count: 개수 · seconds: 길이(초) */
type ColumnKind = "text" | "bytes" | "time" | "count" | "seconds";

type Cmp = ">" | "<" | ">=" | "<=";
/** 읽은 식. 값은 열의 형식으로 읽은 것(문자열 열은 문자열, 그 밖은 수). 날짜는 그날의 처음 · 끝(ms) */
type Filter = { kind: "contains"; text: string } | { kind: "like"; pattern: RegExp } | { kind: "equals"; value: string | number; until?: number } | { kind: "not-equals"; value: string | number; until?: number } | { kind: "compare"; op: Cmp; value: number } | { kind: "between"; low: number; high: number } | { kind: "regex"; pattern: RegExp } | { kind: "empty" } | { kind: "not-empty" };

type Problem = { ok: false; code: Code; max?: number };
type Parsed = { ok: true; filter: Filter } | Problem;
type Words = { ok: true; words: string[] } | Problem;

const BYTE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
const DAY_MS = 24 * 60 * 60 * 1000;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 반복(+ * ? {n,})으로 끝나는 그룹 뒤에 또 반복이 붙은 형태: (a+)+ · (a*)* · (\w+){2,} 처럼 백트래킹이 크게 늘 수 있다
const NESTED_REPEAT = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,\d*\})\)(?:[+*]|\{\d+,\d*\})/;

/** 값 하나를 그 열의 형식으로. 시각은 그날(또는 그 분)의 처음과 끝. 읽을 수 없으면 null */
function readValue(kind: ColumnKind, raw: string): { value: number; until?: number } | null {
  const text = raw.trim();
  if (kind === "bytes") {
    const m = /^(\d+(?:\.\d+)?)\s*([kmgt]?b)?$/i.exec(text);
    return m ? { value: Math.round(Number(m[1]) * BYTE_UNITS[(m[2] ?? "b").toLowerCase()]) } : null;
  }
  if (kind === "seconds") {
    const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(text);
    if (clock) return { value: Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) };
    return /^\d+(?:\.\d+)?$/.test(text) ? { value: Number(text) } : null;
  }
  if (kind === "time") {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text);
    if (!m) return null;
    const [year, month, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    const start = m[4] === undefined ? new Date(year, month, day).getTime() : new Date(year, month, day, Number(m[4]), Number(m[5])).getTime();
    if (Number.isNaN(start)) return null;
    return { value: start, until: start + (m[4] === undefined ? DAY_MS : 60_000) - 1 };
  }
  if (kind === "count") return /^-?\d+(?:\.\d+)?$/.test(text) ? { value: Number(text) } : null;
  return null;
}

function regexOf(source: string): Parsed {
  if (source.length > REGEX_MAX) return { ok: false, code: "regex-too-long", max: REGEX_MAX };
  if (NESTED_REPEAT.test(source)) return { ok: false, code: "unsafe-regex" };
  try {
    return { ok: true, filter: { kind: "regex", pattern: new RegExp(source, "i") } };
  } catch {
    return { ok: false, code: "bad-filter" };
  }
}

// =값 · <>값. 문자열 열은 문자열 그대로, 그 밖은 그 형식으로 읽은 수(날짜면 그날 안)
function equality(kind: ColumnKind, raw: string, negate: boolean): Parsed {
  if (raw === "''") return { ok: true, filter: { kind: negate ? "not-empty" : "empty" } };
  if (kind === "text") return { ok: true, filter: { kind: negate ? "not-equals" : "equals", value: raw } };
  const read = readValue(kind, raw);
  if (!read) return { ok: false, code: "bad-filter" };
  return { ok: true, filter: { kind: negate ? "not-equals" : "equals", value: read.value, ...(read.until !== undefined ? { until: read.until } : {}) } };
}

// > < >= <=. 날짜면 > 는 그날 뒤, <= 는 그날 끝까지
function comparison(kind: ColumnKind, op: Cmp, raw: string): Parsed {
  if (kind === "text") return { ok: false, code: "bad-filter" };
  const read = readValue(kind, raw);
  if (!read) return { ok: false, code: "bad-filter" };
  const value = op === ">" || op === "<=" ? (read.until ?? read.value) : read.value;
  return { ok: true, filter: { kind: "compare", op, value } };
}

/** 열 하나의 식을 읽는다. 빈 식은 null(필터링하지 않음) */
function parseFilter(kind: ColumnKind, input: string): Parsed | null {
  const expr = input.trim();
  if (!expr) return null;
  if (expr.length > FILTER_MAX) return { ok: false, code: "filter-too-long", max: FILTER_MAX };
  if (expr.length >= 2 && expr.startsWith("/") && expr.endsWith("/")) return regexOf(expr.slice(1, -1).replaceAll("\\/", "/"));
  const op = /^(<>|>=|<=|=|>|<)(.*)$/.exec(expr);
  if (op) {
    const [, sign, rest] = op;
    if (sign === "=" || sign === "<>") return equality(kind, rest.trim(), sign === "<>");
    return comparison(kind, sign as Cmp, rest);
  }
  const range = /^(.+?)~(.+)$/.exec(expr);
  if (range && kind !== "text") {
    const [low, high] = [readValue(kind, range[1]), readValue(kind, range[2])];
    if (!low || !high) return { ok: false, code: "bad-filter" };
    return { ok: true, filter: { kind: "between", low: low.value, high: high.until ?? high.value } };
  }
  if (expr.includes("%")) return { ok: true, filter: { kind: "like", pattern: new RegExp(expr.split("%").map(escape).join(".*"), "i") } };
  return { ok: true, filter: { kind: "contains", text: expr } };
}

// = 의 비교: 문자열은 그대로, 날짜는 그날 안, 수는 같은 수
function sameAs(filter: Extract<Filter, { kind: "equals" | "not-equals" }>, value: string | number) {
  if (typeof filter.value === "string") return String(value) === filter.value;
  const n = Number(value);
  return filter.until === undefined ? n === filter.value : n >= filter.value && n <= filter.until;
}

const COMPARE: Record<Cmp, (n: number, value: number) => boolean> = { ">": (n, v) => n > v, "<": (n, v) => n < v, ">=": (n, v) => n >= v, "<=": (n, v) => n <= v };

/** 값이 식에 맞나. 값이 없으면(null · 빈 문자열) 빔 · 빔 아님 · 같지 않음만 맞을 수 있다 */
function matchFilter(filter: Filter, value: string | number | null): boolean {
  const empty = value === null || value === "";
  if (filter.kind === "empty") return empty;
  if (filter.kind === "not-empty") return !empty;
  if (empty) return filter.kind === "not-equals";
  if (filter.kind === "contains") return koMatch(String(value), filter.text);
  if (filter.kind === "like" || filter.kind === "regex") return filter.pattern.test(String(value));
  if (filter.kind === "equals") return sameAs(filter, value);
  if (filter.kind === "not-equals") return !sameAs(filter, value);
  if (filter.kind === "between") return Number(value) >= filter.low && Number(value) <= filter.high;
  return COMPARE[filter.op](Number(value), filter.value);
}

/** 아무 열에서나: 낱말마다 어느 열에든 들어간 행(대소문자 무시, 한국어는 조합 중인 글자 · 초성도). 빈 문자열은 null */
function parseWords(input: string): Words | null {
  const text = input.trim();
  if (!text) return null;
  if (text.length > FILTER_MAX) return { ok: false, code: "filter-too-long", max: FILTER_MAX };
  return { ok: true, words: text.toLowerCase().split(/\s+/) };
}

const matchWords = (words: string[], values: Array<string | number | null>) => {
  const texts = values.filter((one) => one !== null && one !== "").map((one) => String(one));
  return words.every((word) => texts.some((text) => koMatch(text, word)));
};

export { FILTER_MAX, REGEX_MAX, parseFilter, matchFilter, parseWords, matchWords, readValue };
export type { ColumnKind, Filter, Parsed, Words };
