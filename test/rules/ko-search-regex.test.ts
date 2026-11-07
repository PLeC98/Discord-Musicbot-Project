// src/rules/ko-search.ts: 정규식 구현이 자모로 풀어 찾는 기준 구현(test/helpers/ko-search-reference)과 같은 판정, 같은 위치를 내고,
// 검색어의 메타 문자는 글자 그대로 찾고, 악성 입력에서도 오래 걸리지 않는다
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { koMatch, koRanges, koStarts } from "../../src/rules/ko-search.ts";
import * as reference from "../helpers/ko-search-reference.ts";

// 시드가 있는 난수(실패를 재현할 수 있게 한다)
let seed = 20261107;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
const char = (from: number, to: number) => String.fromCharCode(from + Math.floor(rnd() * (to - from + 1)));

const SYLLABLES = ["가", "각", "간", "갃", "과", "괘", "나", "닭", "달", "앉", "읽", "됐", "음", "악", "감", "상", "실", "재", "생", "시", "작", "자", "아", "이"];
const PIECES = [" ", " ", "\t", "\n", " ", " ", ".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "/", "-", '"', "😀", "\ud83d", "́", "각".normalize("NFD"), "Σ", "σ", "ς", "İ", "ß", "A", "a", "Y", "o", "1", "x"];
function piece(): string {
  const r = rnd();
  if (r < 0.45) return pick(SYLLABLES);
  if (r < 0.6) return char(0xac00, 0xd7a3);
  if (r < 0.75) return char(0x3131, 0x318e);
  return pick(PIECES);
}
const textOf = (n: number) => Array.from({ length: n }, piece).join("");

// 검색어: 본문의 부분 문자열에서(마지막 글자는 조합 중인 글자로 바꾸기도 한다), 초성으로, 대소문자를 바꿔서, 무작위로 만든다
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const isSyllable = (c: string) => c >= "가" && c <= "힣";
function partial(c: string): string {
  if (!isSyllable(c)) return c;
  const i = c.charCodeAt(0) - 0xac00;
  const noJong = String.fromCharCode(0xac00 + i - (i % 28));
  return pick([CHO[Math.floor(i / 588)], noJong, c]);
}
function queryFrom(text: string): string {
  const units = [...text];
  const from = Math.floor(rnd() * units.length);
  const slice = units.slice(from, from + 1 + Math.floor(rnd() * 4));
  const r = rnd();
  if (r < 0.35 && slice.length) slice[slice.length - 1] = partial(slice[slice.length - 1]);
  else if (r < 0.6) return slice.map((c) => (isSyllable(c) ? CHO[Math.floor((c.charCodeAt(0) - 0xac00) / 588)] : c)).join(rnd() < 0.3 ? " " : "");
  else if (r < 0.7) return slice.join("").toUpperCase();
  return slice.join("");
}

test("기준 구현과 같은 판정, 같은 위치를 낸다: koMatch, koStarts, koRanges", () => {
  const texts = Array.from({ length: 300 }, () => textOf(1 + Math.floor(rnd() * 12)));
  const queries = [...texts.slice(0, 250).map(queryFrom), ...Array.from({ length: 50 }, () => textOf(1 + Math.floor(rnd() * 3)))];
  let differ = 0;
  const examples: string[] = [];
  for (const q of queries) {
    for (const t of texts) {
      const same = koMatch(t, q) === reference.koMatch(t, q) && koStarts(t, q) === reference.koStarts(t, q) && JSON.stringify(koRanges(t, q)) === JSON.stringify(reference.koRanges(t, q));
      if (same) continue;
      differ++;
      if (examples.length < 5) examples.push(JSON.stringify([t, q]));
    }
  }
  assert.equal(differ, 0, `다른 쌍 ${differ}: ${examples.join(", ")}`);
});

test("검색어의 정규식 메타 문자, 줄바꿈 문자, 단독 서로게이트는 글자 그대로 찾는다", () => {
  for (const q of [".", "*", "a+", "(", ")", "[", "]", "{2}", "|", "\\", "/", "$", "^", "-", "a b", "\ud83d"]) {
    assert.equal(koMatch(`x${q}y`, q), true, JSON.stringify(q));
    assert.equal(koMatch("xy", q), false, JSON.stringify(q));
  }
  assert.equal(koMatch("😀이모지", "😀"), true);
});

test("악성 입력: 같은 초성 음절이 이어진 긴 글에서 긴 자음 검색어로 찾아도 오래 걸리지 않는다", () => {
  // 초성 사이의 공백이 초성 글자와 겹치지 않아 백트래킹이 글 길이에 비례한다(겹치면 기하급수적으로 늘어 멈춘다).
  // 정규식 실행은 동기식이라 테스트 안에서는 중단할 수 없어 자식 프로세스에서 시간을 재고 종료시킨다
  const script = `
    const { koMatch, koRanges } = await import(${JSON.stringify(new URL("../../src/rules/ko-search.ts", import.meta.url).href)});
    const cases = [["자".repeat(262144), "ㅈ".repeat(199) + "ㅅ"], ["자   ".repeat(65536), "ㅈ".repeat(199) + "ㅅ"], ["가".repeat(262144), "가".repeat(199) + "나"]];
    const out = [];
    for (const [text, q] of cases) {
      const t = performance.now();
      out.push([koMatch(text, q), koRanges(text, q).length, performance.now() - t]);
    }
    console.log(JSON.stringify(out));`;
  // .ts를 실행하는 플래그 등은 그대로 넘기고, 테스트 러너 플래그는 뺀다
  const flags = process.execArgv.filter((one) => !one.startsWith("--test") && !one.startsWith("--experimental-test"));
  const run = spawnSync(process.execPath, [...flags, "--input-type=module", "-e", script], { encoding: "utf8", timeout: 30_000 });
  assert.equal(run.error, undefined, "30초 안에 끝난다");
  for (const [matched, ranges, ms] of JSON.parse(run.stdout) as Array<[boolean, number, number]>) {
    assert.deepEqual([matched, ranges], [false, 0]);
    assert.ok(ms < 3000, `${ms}ms`);
  }
});

test("같은 검색어로 거듭 부르면 정규식을 다시 만들지 않는다", () => {
  const texts = Array.from({ length: 20_000 }, (_, i) => `곡 ${i} 재생 시작`);
  for (const q of ["ㅈㅅ", "재새", "없는 글"]) {
    const t = performance.now();
    for (const text of texts) koMatch(text, q);
    const ms = performance.now() - t;
    assert.ok(ms < 1000, `${q}: ${ms}ms`);
  }
});
