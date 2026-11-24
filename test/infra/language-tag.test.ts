// src/infra/language-tag.ts: 원하는 태그 목록에서 가진 언어 가운데 가장 가까운 것. 정확히 같은 것, 그다음 문자 체계가 같은 가장 가까운 지역

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTag } from "../../src/infra/language-tag.ts";

test("정확히 같은 것은 대소문자와 상관없이 맞고, 가진 쪽의 철자를 돌려준다", () => {
  assert.equal(matchTag(["KO"], ["ko"]), "ko");
  assert.equal(matchTag(["qps-ploc"], ["ko", "qps-ploc"]), "qps-ploc", "Intl이 qps-Ploc으로 바꾸는 태그도 목록의 철자로");
  assert.equal(matchTag(["qps"], ["qps-ploc"]), null, "문자 체계가 다르면 맞지 않는다(qps는 Latn, qps-ploc은 Ploc)");
});

test("언어만 적은 쪽과 지역을 붙인 쪽은 서로 맞는다", () => {
  assert.equal(matchTag(["ko-KR"], ["ko"]), "ko");
  assert.equal(matchTag(["ko"], ["ko-KR"]), "ko-KR");
  assert.equal(matchTag(["en-US-u-va-posix"], ["en"]), "en", "C 로케일");
});

test("중국어: 문자 체계로 나뉜다. 홍콩, 마카오는 번체(zh-TW), 싱가포르는 간체(zh-CN)", () => {
  const zh = ["zh-CN", "zh-TW"];
  assert.equal(matchTag(["zh-HK"], zh), "zh-TW");
  assert.equal(matchTag(["zh-MO"], zh), "zh-TW");
  assert.equal(matchTag(["zh-Hant"], zh), "zh-TW");
  assert.equal(matchTag(["zh-SG"], zh), "zh-CN");
  assert.equal(matchTag(["zh"], zh), "zh-CN");
  assert.equal(matchTag(["zh-MO"], ["zh-TW", "zh-HK"]), "zh-HK", "홍콩과 마카오는 같은 묶음");
});

test("문자 체계가 다르면 맞추지 않고 다음 태그로 넘어간다", () => {
  assert.equal(matchTag(["zh-TW"], ["zh", "en"]), null, "번체를 원하는데 간체(zh)만 있다");
  assert.equal(matchTag(["zh-HK", "en"], ["zh-CN", "en-US"]), "en-US");
  assert.equal(matchTag(["sr-Latn"], ["sr"]), null);
});

test("같은 언어, 문자 체계 안에서는 지역이 같은 것, 그다음 CLDR의 가까운 지역 묶음, 그다음 목록 차례", () => {
  const en = ["en-US", "en-GB"];
  assert.equal(matchTag(["en-AU"], en), "en-GB", "미국 밖의 영어는 en-GB");
  assert.equal(matchTag(["en-IN"], ["en-US", "en-AU", "en-GB"]), "en-GB");
  assert.equal(matchTag(["en-CA"], ["en-GB", "en-US"]), "en-US", "캐나다는 미국 쪽 묶음");
  assert.equal(matchTag(["en"], ["en-GB", "en-US"]), "en-US", "en은 en-US로 채워진다");
  const es = ["es-ES", "es-419"];
  assert.equal(matchTag(["es-MX"], es), "es-419");
  assert.equal(matchTag(["es-AR"], es), "es-419");
  assert.equal(matchTag(["es"], ["es-419", "es-ES"]), "es-ES");
  assert.equal(matchTag(["es-419"], ["es-ES", "es-MX"]), "es-MX");
  assert.equal(matchTag(["pt-PT"], ["pt-BR", "pt-AO"]), "pt-AO", "아메리카 밖 지역끼리");
  assert.equal(matchTag(["pt"], ["pt-PT", "pt-BR"]), "pt-BR", "pt는 pt-BR로 채워진다");
  assert.equal(matchTag(["fr-CA"], ["fr-FR", "fr-BE"]), "fr-FR", "묶음이 없는 언어는 목록 차례");
});

test("앞 태그가 먼저다. 앞 태그가 못 찾을 때만 다음 태그", () => {
  assert.equal(matchTag(["ja", "ko"], ["ko", "ja"]), "ja");
  assert.equal(matchTag(["fr", "ko"], ["ko"]), "ko");
  assert.equal(matchTag(["fr"], ["ko"]), null);
});

test("인식하지 못하는 태그와 모름(und)은 정확히 같은 것만 본다. 옛 코드는 Intl이 바꾼 대로 맞춘다", () => {
  assert.equal(matchTag(["*", "x-test", "", "  ", "korean!"], ["ko"]), null);
  assert.equal(matchTag(["und"], ["en"]), null, "채우면 en-Latn-US가 되지만 모름을 영어로 보지 않는다");
  assert.equal(matchTag(["x-test"], ["x-test"]), "x-test");
  assert.equal(matchTag(["iw"], ["he"]), "he");
  assert.equal(matchTag(["ko"], ["bogus!", "ko"]), "ko", "가진 쪽에 인식하지 못하는 태그가 있어도 깨지지 않는다");
});
