// src/rules/languages.ts: 언어 맞추기. 브라우저 언어와 Accept-Language는 언어 부분까지 맞추고, 디스코드 로케일은 적힌 것과 정확히 같은 것만 받는다

import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptedTags, availableLanguages, discordLanguage, matchLanguage, TEST_LANGUAGE } from "../../src/rules/languages.ts";

const only = availableLanguages(false);
const withTest = availableLanguages(true);

test("테스트 언어는 켰을 때만 목록에 든다", () => {
  assert.ok(!only.some((one) => one.tag === TEST_LANGUAGE));
  assert.ok(withTest.some((one) => one.tag === TEST_LANGUAGE));
});

test("matchLanguage: 앞의 태그부터, 정확히 같은 것 다음에 언어 부분이 같은 것. 없으면 null", () => {
  assert.equal(matchLanguage(["ko-KR"], only), "ko");
  assert.equal(matchLanguage(["en-US", "ko"], only), "ko");
  assert.equal(matchLanguage(["en-US", "ja"], only), null);
  assert.equal(matchLanguage(["*"], only), null);
  assert.equal(matchLanguage(["qps-ploc"], withTest), TEST_LANGUAGE);
});

test("discordLanguage: 디스코드 로케일은 정확히 같은 것만(언어 부분으로 넘겨짚지 않는다)", () => {
  assert.equal(discordLanguage("ko", only), "ko");
  assert.equal(discordLanguage("en-US", only), null);
  assert.equal(discordLanguage(undefined, only), null);
  assert.equal(discordLanguage("ko", withTest), "ko", "테스트 언어는 디스코드 로케일을 받지 않는다");
});

test("acceptedTags: q 값이 큰 것부터, 같으면 적힌 순서, q=0은 뺀다", () => {
  assert.deepEqual(acceptedTags("en-US,en;q=0.9,ko;q=0.95"), ["en-US", "ko", "en"]);
  assert.deepEqual(acceptedTags("ko;q=0, ja"), ["ja"]);
  assert.deepEqual(acceptedTags(""), []);
  assert.deepEqual(acceptedTags(undefined), []);
});
