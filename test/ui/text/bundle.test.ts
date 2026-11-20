// src/ui/text/index.ts, src/ui/text/bundle.ts: 각 언어의 봇 문구 번들. 한국어는 언어 모듈과 같은 글을 내고, 테스트 언어는 한글만 바꾸며, 오류 안내의 코드별 값 검사가 번들에서도 유지된다

import { test } from "node:test";
import assert from "node:assert/strict";
import { missingText, textFor } from "../../../src/ui/text/index.ts";
import { missingSharedText, sharedTextFor } from "../../../src/ui/text/shared.ts";
import { TEST_LANGUAGE } from "../../../src/rules/languages.ts";
import * as koErrors from "../../../src/ui/text/ko/errors.ts";
import * as koLabels from "../../../src/ui/text/ko/labels.ts";

test("한국어 번들은 언어 모듈과 같은 글을 내고, 빠진 문구가 없다", () => {
  const T = textFor("ko");
  assert.equal(T.labels.songTitle, koLabels.songTitle, "채울 것이 없으면 언어 모듈의 함수를 그대로 쓴다");
  assert.deepEqual(T.errors.notice("no-song"), koErrors.notice("no-song"));
  assert.deepEqual(T.errors.notice("queue-full", { max: 200 }), koErrors.notice("queue-full", { max: 200 }));
  assert.deepEqual(T.errors.noticeFor("queue-full"), koErrors.noticeFor("queue-full"), "값이 빠지면 알 수 없는 오류");
  assert.deepEqual([...missingText()], []);
  assert.deepEqual([...missingSharedText()], []);
});

test("언어마다 번들을 한 번 만들어 둔다", () => {
  assert.equal(textFor("ko"), textFor("ko"));
  assert.equal(sharedTextFor(TEST_LANGUAGE), sharedTextFor(TEST_LANGUAGE));
});

test("테스트 언어: 한글만 바꾸고 코드, 주제, 경고 수준은 그대로, 입력한 글에서 검색어를 꺼내는 함수는 바꾸지 않는다", () => {
  const T = textFor(TEST_LANGUAGE);
  const ko = textFor("ko").errors.notice("no-song");
  const pseudo = T.errors.notice("no-song");
  assert.deepEqual([pseudo.code, pseudo.topic, pseudo.severity], [ko.code, ko.topic, ko.severity]);
  assert.doesNotMatch(pseudo.title, /[가-힣]/);
  assert.equal([...pseudo.title].length, [...ko.title].length);
  assert.equal(T.search.queryOfTyped("검색어"), "검색어");
});

test("번들의 오류 안내도 코드마다 필요한 값을 타입으로 검사한다", () => {
  const T = textFor("ko");
  // @ts-expect-error queue-full은 max가 있어야 한다
  assert.ok(T.errors.notice("queue-full"));
  assert.ok(T.errors.notice("no-song"));
});
