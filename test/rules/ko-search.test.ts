// src/rules/ko-search.ts — 한국어를 아는 찾기. 마지막 글자는 조합 중일 수 있고, 자음만이면 초성으로 찾는다
import test from "node:test";
import assert from "node:assert/strict";
import { koMatch, koRanges, koStarts } from "../../src/rules/ko-search.ts";

test("그대로 들어 있으면 찾는다(영문은 대소문자 무시, 빈 검색어는 모두)", () => {
  assert.equal(koMatch("YOASOBI", "yoa"), true);
  assert.equal(koMatch("아무거나", "  "), true);
  assert.equal(koMatch("음악", "미술"), false);
});

test("마지막 글자는 조합 중으로 본다: 받침 · 겹모음이 덜 된 글자", () => {
  assert.equal(koMatch("음악 감상실", "음ㅇ"), true);
  assert.equal(koMatch("음악 감상실", "음악 가"), true);
  assert.equal(koMatch("가나", "간"), true, "받침이 다음 글자 첫소리로 넘어가는 중");
  assert.equal(koMatch("과일", "고"), true, "ㅘ 를 치는 중");
  assert.equal(koMatch("음악", "읍"), false);
});

test("자음만이면 초성으로(띄어쓰기는 보지 않는다)", () => {
  assert.equal(koMatch("음악 감상실", "ㅇㅇㄱㅅㅅ"), true);
  assert.equal(koMatch("음악 감상실", "ㅇㄱ"), true);
  assert.equal(koMatch("음악 감상실", "ㄱㅇ"), false);
});

test("koStarts 는 맨 앞에서만 같은 규칙", () => {
  assert.equal(koStarts("음악 감상실", "음ㅇ"), true);
  assert.equal(koStarts("음악 감상실", "ㅇㅇ"), true);
  assert.equal(koStarts("음악 감상실", "감"), false);
});

test("koRanges 는 맞은 자리들(칠할 곳): 그대로 · 조합 중인 글자가 걸친 글자까지 · 초성은 띄어쓰기를 건너 원래 자리로", () => {
  assert.deepEqual(koRanges("YouTube 와 youtube", "you"), [
    [0, 3],
    [10, 13],
  ]);
  assert.deepEqual(koRanges("음악 감상실", "음ㅇ"), [[0, 2]]);
  assert.deepEqual(koRanges("가나다", "간"), [[0, 2]], "받침이 넘어가는 다음 글자까지");
  assert.deepEqual(koRanges("음악 감상실", "ㅇㄱ"), [[1, 4]], "초성 ㅇㅇㄱㅅㅅ 의 둘째부터: 띄어쓰기를 사이에 둔 악 감");
  assert.deepEqual(koRanges("음악", "미술"), []);
  assert.deepEqual(koRanges("음악", " "), [], "빈 검색어는 칠하지 않는다");
});

test("koRanges 는 koMatch 와 같은 규칙이다(맞으면 자리가 있다)", () => {
  for (const [text, query] of [
    ["음악 감상실", "음악 가"],
    ["과일", "고"],
    ["음악 감상실", "ㅇㅇㄱㅅㅅ"],
    ["음악", "읍"],
    ["YOASOBI", "yoa"],
  ]) {
    assert.equal(koRanges(text, query).length > 0, koMatch(text, query), `${text} / ${query}`);
  }
});
