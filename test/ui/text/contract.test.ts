// src/ui/text/contract.ts: 언어 모듈이 맞춰야 할 구조. 문구만 다른 번들은 통과하고, 뜻이 있는 값(아이콘 키)이 틀리거나 export를 빼면 타입 검사가 막는다.
// 타입 검사를 거치지 않은 번들은 실행 중에 빠진 문구만 기준 언어로 채운다(rules/text-fill)

import { test } from "node:test";
import assert from "node:assert/strict";
import * as ko from "../../../src/ui/text/ko/index.ts";
import type { BotSource } from "../../../src/ui/text/index.ts";
import { fillFrom } from "../../../src/rules/text-fill.ts";
import { WHOLE_MODULES } from "../../../src/ui/text/bundle.ts";

// 문구만 다르다
const english: BotSource = { ...ko, labels: { ...ko.labels, songTitle: (title) => title || "Unknown track" } };

// 잘못된 아이콘 키를 넣었다
const wrongIcon = { ...ko, notices: { ...ko.notices, restored: () => ({ icon: "nope" as const, title: "", body: "" }) } };
// @ts-expect-error 아이콘 키는 IconKey여야 한다
const badIcon: BotSource = wrongIcon;

// 모듈 하나를 뺐다
const { labels: _labels, ...noLabels } = ko;
// @ts-expect-error 모든 모듈이 있어야 한다
const missingModule: BotSource = noLabels;

test("문구만 다른 번들은 채울 것이 없다", () => {
  assert.deepEqual(fillFrom(ko, english, WHOLE_MODULES).missing, []);
});

test("타입 검사를 거치지 않은 번들: 빠진 모듈, 빠진 함수는 그 자리만 기준 언어로 채운다", () => {
  const filled = fillFrom(ko, missingModule, WHOLE_MODULES);
  assert.deepEqual(filled.missing, ["labels"]);
  assert.equal(filled.value.labels, ko.labels);
  const { songTitle: _songTitle, ...partialLabels } = ko.labels;
  const partly = fillFrom(ko, { ...ko, labels: partialLabels }, WHOLE_MODULES);
  assert.deepEqual(partly.missing, ["labels.songTitle"]);
  assert.equal(partly.value.labels.collection, ko.labels.collection);
});

test("검색 모듈은 하나라도 빠지면 통째로 기준 언어(선택지 이름과 되읽기가 짝이다)", () => {
  const { queryOfChoice: _query, ...halfSearch } = ko.search;
  const filled = fillFrom(ko, { ...ko, search: { ...halfSearch, resultsChoice: () => "x" } }, WHOLE_MODULES);
  assert.deepEqual(filled.missing, ["search.queryOfChoice"]);
  assert.equal(filled.value.search.resultsChoice, ko.search.resultsChoice);
});

test("아이콘 키가 틀린 번들도 실행 중에는 값의 타입(문자열)만 본다", () => {
  assert.deepEqual(fillFrom(ko, badIcon, WHOLE_MODULES).missing, []);
});
