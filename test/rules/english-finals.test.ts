// 영어 끝소리 표(data/english-finals.json). 발음 사전 전체를 들고 판정할 때와 낱말마다 답이 같은지, 표가 지금 사전에서 만든 그대로인지 본다.
// 사전 패키지(cmu-pronouncing-dictionary)는 표를 만들 때만 쓰는 개발 의존성이다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dictionary } from "cmu-pronouncing-dictionary";
import { PROJECT } from "../../src/infra/project-paths.ts";
import { _internals } from "../../src/rules/josa.ts";
import { letterFinal, phonemeFinal, spellingFinal, tableOf } from "../../src/rules/english-final.ts";
import type { Final } from "../../src/rules/josa.ts";

const { englishFinal } = _internals;
const FILE = path.join(PROJECT.data, "english-finals.json");

// 사전 전체로 판정하던 법. 사전에 있으면 그 발음, 사전에 없는 대문자 약어(또는 모음이 없는 약어)는 글자 이름, 그 밖은 철자
function withWholeDictionary(word: string): Final {
  const lower = word.toLowerCase();
  const said = Object.hasOwn(dictionary, lower) ? dictionary[lower] : null;
  if (/^[A-Z]{1,5}$/.test(word) && (!said || !/[AEIOUY]/.test(word))) return letterFinal(word);
  if (said) return phonemeFinal(said.split(" ").map((p) => p.replace(/\d/, "")));
  return spellingFinal(lower);
}

// 조사 도우미가 묻는 꼴: 소문자 · 첫 글자만 대문자 · 다섯 글자 이하는 모두 대문자(약어)
const formsOf = (word: string) => [word, word[0].toUpperCase() + word.slice(1), ...(word.length <= 5 ? [word.toUpperCase()] : [])];

test("사전의 모든 낱말에서 표의 답이 사전 전체의 답과 같다", () => {
  const words = Object.keys(dictionary).filter((word) => /^[a-z]+$/.test(word));
  assert.ok(words.length > 100_000, `사전 낱말이 너무 적다(${words.length})`);
  const differ = words.flatMap(formsOf).filter((form) => englishFinal(form) !== withWholeDictionary(form));
  assert.deepEqual(differ.slice(0, 20), []);
});

test("사전에 없는 말(세 글자 이하 모든 조합)도 같다: 철자 어림 · 글자 이름", () => {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const short = [...letters].flatMap((a) => [a, ...[...letters].flatMap((b) => [a + b, ...[...letters].map((c) => a + b + c)])]);
  const differ = short.flatMap(formsOf).filter((form) => englishFinal(form) !== withWholeDictionary(form));
  assert.deepEqual(differ.slice(0, 20), []);
});

test("표는 지금 사전에서 만든 그대로다(바뀌었으면 node scripts/build-english-finals.ts)", () => {
  const saved = JSON.parse(fs.readFileSync(FILE, "utf8")) as { source: string };
  assert.deepEqual(saved, tableOf(dictionary, saved.source));
  assert.match(saved.source, /^cmu-pronouncing-dictionary \d+\.\d+\.\d+$/);
});

test("prototype 의 이름(constructor 등)은 표에 없는 낱말로 다룬다", () => {
  for (const word of ["constructor", "toString", "hasOwnProperty", "valueOf"]) assert.equal(englishFinal(word), spellingFinal(word.toLowerCase()), word);
});
