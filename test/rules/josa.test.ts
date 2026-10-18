// src/rules/josa.ts — 앞말의 끝소리를 보고 조사를 선택한다. 모르면 괄호 형태

import { test } from "node:test";
import assert from "node:assert/strict";
import { josa, finalOf } from "../../src/rules/josa.ts";

// 낱말마다 [을/를 선택한 것] 을 적어 둔다
const picks = (words: string[], particle: Parameters<typeof josa>[1] = "을") => words.map((w) => `${w}${josa(w, particle)}`);

test("네 조사: 받침 있음 · 없음 · 모름. 으로는 ㄹ 받침 뒤에서 로", () => {
  assert.deepEqual(
    (["을", "은", "이", "으로"] as const).map((p) => [josa("곡", p), josa("노래", p), josa("가을", p), josa("😀", p)]),
    [
      ["을", "를", "을", "을(를)"],
      ["은", "는", "은", "은(는)"],
      ["이", "가", "이", "이(가)"],
      ["으로", "로", "로", "(으)로"],
    ],
  );
});

test("한글: 받침 · ㄹ 받침 · 받침 없음", () => {
  assert.deepEqual([finalOf("재생목록"), finalOf("앨범"), finalOf("아티스트 인기곡"), finalOf("가요"), finalOf("하늘")], ["final", "final", "final", "none", "rieul"]);
});

test("끝의 공백 · 괄호 · 따옴표 · 기호 · 이모지는 건너뛰고 그 앞을 본다", () => {
  assert.deepEqual(picks(["봄날 (Live)", "「春」", '"사랑"', "밤편지!", "좋은 날 ~", "별 ★", "꽃 🌸", "Song [MV]  "]), ["봄날 (Live)를", "「春」을(를)", '"사랑"을', "밤편지!를", "좋은 날 ~을", "별 ★을", "꽃 🌸을", "Song [MV]  를"]);
});

test("숫자: 읽는 소리의 끝. 끝의 0 은 자릿수(십 · 백 · 천 · 만 · 억 · 조), 쉼표는 뺀다, 소수는 마지막 숫자", () => {
  const cases: Array<[string, string]> = [
    ["0", "을"],
    ["1", "을"],
    ["2", "를"],
    ["3", "을"],
    ["4", "를"],
    ["5", "를"],
    ["6", "을"],
    ["7", "을"],
    ["8", "을"],
    ["9", "를"],
    ["10", "을"],
    ["100", "을"],
    ["1000", "을"],
    ["10000", "을"],
    ["100000", "을"],
    ["100000000", "을"],
    ["1000000000000", "를"],
    ["10000000000000000", "을"],
    ["1,200", "을"],
    ["1,000,000,000,000", "를"],
    ["1000000000", "을"],
    ["1.000000000000", "을"],
    ["12", "를"],
    ["2.5", "를"],
    ["Vol.2", "를"],
    ["Version 2.0", "을"],
    ["007", "을"],
  ];
  assert.deepEqual(
    cases.map(([w]) => josa(w, "을")),
    cases.map(([, p]) => p),
  );
  assert.deepEqual([josa("21", "으로"), josa("10", "으로"), josa("2", "으로")], ["로", "으로", "로"], "일 · 칠 · 팔 은 ㄹ 받침");
});

test("영어: 발음 사전의 마지막 소리. 짧은 모음 뒤의 p · t · k 만 받침", () => {
  assert.deepEqual(picks(["Love", "Dream", "Song", "Night", "Cat", "Hit", "Rock", "Cake", "Talk", "Feel", "Girl", "Star", "Shape of You", "Bad", "Dance", "Don't"]), ["Love를", "Dream을", "Song을", "Night를", "Cat을", "Hit을", "Rock을", "Cake를", "Talk를", "Feel을", "Girl을", "Star를", "Shape of You를", "Bad를", "Dance를", "Don't를"]);
  assert.deepEqual([josa("Feel", "으로"), josa("Dream", "으로")], ["로", "으로"]);
});

test("영어: 사전에 없으면 철자로, 사전에 없는 대문자 약어는 글자 이름으로", () => {
  assert.deepEqual(picks(["Zxqkem", "Zxqkol", "Zxqbop", "Zxqbeck", "Zxqboo", "Zxqbas"]), ["Zxqkem을", "Zxqkol을", "Zxqbop을", "Zxqbeck을", "Zxqboo를", "Zxqbas를"]);
  assert.deepEqual(picks(["BTS", "TV", "MV", "DJ", "OST", "AKML", "QQM", "DVR", "'Cause"]), ["BTS를", "TV를", "MV를", "DJ를", "OST를", "AKML을", "QQM을", "DVR을", "'Cause를"]);
  assert.equal(josa("AKML", "으로"), "로", "엘 은 ㄹ 받침");
  assert.equal(josa("ONE", "을"), "을", "사전에 있는 낱말은 대문자여도 낱말로 읽는다(원)");
});

test("가나: ん 은 ㄴ, っ 는 ㅅ, 장음 · 작은 가나 · 그 밖은 받침 없음, 반복 기호는 앞 글자, 반각은 정규화", () => {
  assert.deepEqual(picks(["さくらんぼ", "ドラえもん", "ラーメン", "あっ", "コーヒー", "でしょ", "きゃ", "いすゞ", "ことゝ", "ｶﾞﾝﾀﾞﾑ", "ﾊﾟﾝ", "ﾗｲﾌﾞ", "ァ"]), ["さくらんぼ를", "ドラえもん을", "ラーメン을", "あっ을", "コーヒー를", "でしょ를", "きゃ를", "いすゞ를", "ことゝ를", "ｶﾞﾝﾀﾞﾑ를", "ﾊﾟﾝ을", "ﾗｲﾌﾞ를", "ァ를"]);
  assert.equal(josa("ドラえもん", "으로"), "으로");
});

test("한자: 일본어 읽기가 모두 같은 쪽으로 끝나면 안다. 나뉘면 괄호 형태, 々 는 앞 한자", () => {
  // 花(カ · はな) · 愛(アイ · あい …)는 모두 모음, 千(セン · ち) · 恋(レン · こい) · 雲(ウン · くも)은 나뉜다
  assert.deepEqual([finalOf("夜桜"), finalOf("花"), finalOf("愛"), finalOf("千"), finalOf("恋"), finalOf("雲"), finalOf("時々"), finalOf("坂本龍一"), finalOf("吨")], ["none", "none", "none", null, null, null, "none", "none", "final"]);
  assert.deepEqual([josa("千", "을"), josa("吨", "을")], ["을(를)", "을"]);
});

test("모르는 글자 · 빈 말", () => {
  assert.deepEqual([finalOf(""), finalOf("   "), finalOf("!!!"), finalOf("Привет"), finalOf("ㅋㅋ")], [null, null, null, null, null]);
});
