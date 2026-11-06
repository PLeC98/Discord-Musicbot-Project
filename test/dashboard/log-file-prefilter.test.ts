// src/dashboard/log-file-reader.ts: 검색어가 있을 때 묶음째 거르기가 맞는 줄을 놓치지 않는다. 까다로운 글(바꿔 쓴 글자, 탭, 줄바꿈, NFD,
// 시그마, 결합 문자, 이모지, 따옴표, 짝 없는 서로게이트, 묶음보다 긴 줄)로 만든 파일에서 쪽, 맞은 줄 수, 다운로드가 모든 줄을 푼 기준과 같다
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { filteredLines, readLogPage } from "../../src/dashboard/log-file-reader.ts";
import { matchesLog, type FileLine, type LogFilter } from "../../src/dashboard/contract/log-files.ts";
import { wireFields } from "../../src/infra/log/levels.ts";

let seed = 777;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];

const WORDS = ["재생", "시작", "음악", "감상실", "가나", "과일", "닭갈비", "앉아", "YouTube", "Player", "ΟΔΟΣ", "σοφία", "café", "café", "재생".normalize("NFD"), "😀", "\ud83d", 'say "hi"', "a\\b", "탭\t뒤", "줄\n바꿈", "\u000b", "İstanbul", "ㄱㅅ", "자 자 자", "x", "Σ", "́x"];
const sentence = () => Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => pick(WORDS)).join(pick([" ", "", "  ", "\t", "\n"]));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logread-prefilter-"));
const file = path.join(dir, "bot.log");
const T0 = 1_760_000_000_000;
const records: string[] = [];
for (let i = 0; i < 6000; i++) {
  const rec: Record<string, unknown> = { time: T0 + i, level: pick([20, 30, 40, 50]), msg: sentence() };
  if (rnd() < 0.5) rec.category = pick(["player", "youtube", "재생기"]);
  if (rnd() < 0.2) rec.tags = [pick(["retry", "재시도", "Σ"])];
  records.push(JSON.stringify(rec));
  // 묶음(256KB)보다 긴 줄
  if (i === 2500) records.push(JSON.stringify({ time: T0 + i, level: 30, msg: "긴 줄 " + "재생 시작 ".repeat(40_000) + "끝" }));
  if (i === 4000) records.push("not json 재생 시작");
  // 화면 글이 바이트와 다른 줄: 읽을 때 ANSI 를 걷어 내고, 글이 아닌 msg, 태그를 글로 바꾼다
  if (i % 1000 === 500) {
    records.push(JSON.stringify({ time: T0 + i, level: 30, msg: "foo\x1b[31mbar" }));
    records.push(JSON.stringify({ time: T0 + i, level: 30, msg: ["foo", "bar"] }));
    records.push(JSON.stringify({ time: T0 + i, level: 30, msg: { a: 1 } }));
    records.push(JSON.stringify({ time: T0 + i, level: 30, msg: "x", tags: [["tag", "inner"], 7, true] }));
    records.push(JSON.stringify({ time: T0 + i, level: 30, msg: "y", tags: ["\u2028", {}] }));
  }
}
fs.writeFileSync(file, records.join("\n") + "\n");
after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

// 기준: 모든 줄을 풀어 필터로
const all: FileLine[] = [];
{
  const buf = fs.readFileSync(file);
  let start = 0;
  for (let i = buf.indexOf(10); i >= 0; i = buf.indexOf(10, start)) {
    try {
      const rec = JSON.parse(buf.toString("utf8", start, i));
      if (typeof rec.time === "number" && typeof rec.level === "number") all.push({ offset: start, ...wireFields(rec) });
    } catch {
      // 레코드가 아닌 줄
    }
    start = i + 1;
  }
}
const target = { name: "bot.log", path: file };
const offsets = (lines: FileLine[]) => lines.map((l) => l.offset);

const queries = [
  ...Array.from({ length: 40 }, () => {
    const w = pick(WORDS);
    const r = rnd();
    if (r < 0.3) return w.slice(0, Math.max(1, w.length - 1));
    if (r < 0.5) return w.toUpperCase();
    return w;
  }),
  "ㅈㅅ",
  "ㅈ ㅅ",
  "ㅈㅈㅈ",
  "재새",
  "음ㅇ",
  "고",
  "간",
  "say",
  '"hi"',
  "\\",
  "σ",
  "ς",
  "Σ",
  "́",
  "é",
  "\ud83d",
  "탭\t뒤",
  "player",
  "youtube",
  "끝",
  "긴 줄",
  "없는 글자열",
  "foobar",
  "foo,bar",
  "[object obj",
  "tag,inner",
  "object",
  "true",
  "7",
];

test("검색 첫 쪽: 마지막 쪽의 줄, more, 맞은 줄 수가 기준과 같다", async () => {
  for (const q of queries) {
    const filter: LogFilter = { q };
    const want = all.filter((l) => matchesLog(l, filter));
    const page = (await readLogPage(target, { limit: 7, filter }))!;
    assert.deepEqual(offsets(page.lines), offsets(want.slice(-7)), JSON.stringify(q));
    // 다듬으면 빈 검색어는 세지 않는다
    assert.equal(page.matches, q.trim() ? want.length : undefined, JSON.stringify(q));
    assert.equal(page.more, want.length > 7, JSON.stringify(q));
  }
});

test("이어 받는 쪽(앞, 뒤)과 레벨을 같이 건 검색도 기준과 같다", async () => {
  for (const q of queries) {
    const filter: LogFilter = { q, levels: new Set(["warn", "error"]) };
    const want = all.filter((l) => matchesLog(l, filter));
    if (want.length < 3) continue;
    const mid = want[Math.floor(want.length / 2)].offset;
    const earlier = (await readLogPage(target, { limit: 5, filter, before: mid }))!;
    assert.deepEqual(offsets(earlier.lines), offsets(want.filter((l) => l.offset < mid).slice(-5)), `앞 ${JSON.stringify(q)}`);
    const later = (await readLogPage(target, { limit: 5, filter, after: mid }))!;
    assert.deepEqual(offsets(later.lines), offsets(want.filter((l) => l.offset > mid).slice(0, 5)), `뒤 ${JSON.stringify(q)}`);
  }
});

test("검색어가 있으면 후보 줄만 푼다", async () => {
  const parse = JSON.parse;
  let calls = 0;
  JSON.parse = ((...args: Parameters<typeof parse>) => (calls++, parse(...args))) as typeof JSON.parse;
  try {
    const page = (await readLogPage(target, { limit: 7, filter: { q: "닭갈비" } }))!;
    assert.ok(page.matches! > 0);
    assert.ok(calls < page.matches! * 2 + 50, `푼 줄 ${calls} / 맞은 줄 ${page.matches} / 모든 줄 ${all.length}`);
  } finally {
    JSON.parse = parse;
  }
});

test("다운로드도 기준과 같은 줄", async () => {
  for (const q of queries.slice(0, 20)) {
    const filter: LogFilter = { q };
    const got: FileLine[] = [];
    for await (const batch of filteredLines(target, filter)) got.push(...batch);
    assert.deepEqual(offsets(got), offsets(all.filter((l) => matchesLog(l, filter))), JSON.stringify(q));
  }
});
