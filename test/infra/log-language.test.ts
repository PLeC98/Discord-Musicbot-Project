// src/infra/log/choose-language.ts, language.ts: 로그 언어를 LOG_LANGUAGE, OS 언어, 기준 언어 차례로 고르고, 적은 값을 쓸 수 없으면 알린다(app/config-check가 찍는다)

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chooseLogLanguage, pickLogLanguage, takeLogLanguageNotice } from "../../src/infra/log/choose-language.ts";
import { LOG_LANGUAGES, logLanguage, setLogLanguage } from "../../src/infra/log/language.ts";
import { BASE_LANGUAGE, LANGUAGES } from "../../src/rules/languages.ts";
import { stopOnConfigProblems } from "../../src/app/config-check.ts";

afterEach(() => {
  setLogLanguage(BASE_LANGUAGE);
  takeLogLanguageNotice();
});

// 화면 언어가 먼저 늘어도(봇, 화면 번역) 로그 문구를 다 옮기기 전에는 로그 언어로 고르지 않는다
test("고를 수 있는 언어는 지원 언어 안에 있고 맨 앞이 기준 언어다", () => {
  assert.equal(LOG_LANGUAGES[0], BASE_LANGUAGE);
  const supported = new Set<string>(LANGUAGES.map((one) => one.tag));
  assert.deepEqual(
    LOG_LANGUAGES.filter((tag) => !supported.has(tag)),
    [],
  );
});

test("유닉스 로케일 꼴(밑줄, 인코딩, 수식)도 받는다", () => {
  assert.deepEqual(pickLogLanguage("ko_KR.UTF-8", undefined), { language: "ko", notice: null });
  assert.deepEqual(pickLogLanguage("ko_KR@euro", undefined), { language: "ko", notice: null });
  assert.deepEqual(pickLogLanguage(undefined, "ko_KR.UTF-8"), { language: "ko", notice: null });
});

test("설정 검사가 고를 때의 알림을 다른 경고보다 먼저 한 번 찍는다(설정 문제로 멈출 때도)", () => {
  chooseLogLanguage({ LOG_LANGUAGE: "zz" });
  const lines: string[] = [];
  const out = { warn: (line: string) => lines.push(`warn ${line}`), error: (line: string) => lines.push(`error ${line}`) };
  let code: number | null = null;
  stopOnConfigProblems({ warnings: ["경고"], problems: ["문제"] }, out, (c) => (code = c));
  assert.equal(code !== null, true);
  assert.match(lines[0], /^warn LOG_LANGUAGE 무시\(zz\): /);
  assert.deepEqual(lines.slice(1), ["warn 경고", "error 문제"]);
  stopOnConfigProblems({ warnings: [], problems: [] }, out, () => {});
  assert.equal(lines.length, 3, "알림은 한 번만");
});

test("정하기 전에는 기준 언어다", () => {
  assert.equal(logLanguage(), BASE_LANGUAGE);
});

test("LOG_LANGUAGE가 OS 언어보다 앞선다. 대소문자와 지역 부분은 가리지 않는다", () => {
  assert.deepEqual(pickLogLanguage("ko", "en-US"), { language: "ko", notice: null });
  assert.deepEqual(pickLogLanguage(" KO-kr ", "en-US"), { language: "ko", notice: null });
});

test("비었거나 공백뿐이면 적지 않은 것으로 보고 OS 언어를 따른다", () => {
  assert.deepEqual(pickLogLanguage("", "ko-KR"), { language: "ko", notice: null });
  assert.deepEqual(pickLogLanguage("   ", "ko-KR"), { language: "ko", notice: null });
  assert.deepEqual(pickLogLanguage(undefined, "ko-KR"), { language: "ko", notice: null });
});

test("OS 언어는 언어 부분으로 맞추고(유닉스 C 로케일의 확장 태그 포함), 문구가 없거나 못 읽으면 기준 언어다. 이때는 알리지 않는다", () => {
  assert.deepEqual(pickLogLanguage(undefined, "ko-KR"), { language: "ko", notice: null });
  assert.deepEqual(pickLogLanguage(undefined, "en-US-u-va-posix"), { language: BASE_LANGUAGE, notice: null });
  assert.deepEqual(pickLogLanguage(undefined, undefined), { language: BASE_LANGUAGE, notice: null });
});

test("적은 값이 태그 형식이 아니거나 그 언어의 문구가 없으면 알리고 OS 언어, 기준 언어 차례로 넘어간다", () => {
  assert.deepEqual(pickLogLanguage("korean!", "ko-KR"), { language: "ko", notice: { kind: "malformed", value: "korean!" } });
  assert.deepEqual(pickLogLanguage("xx", "ko-KR"), { language: "ko", notice: { kind: "unavailable", value: "xx" } });
  assert.deepEqual(pickLogLanguage("xx-YY", undefined), { language: BASE_LANGUAGE, notice: { kind: "unavailable", value: "xx-YY" } });
});

test("고르면 지금 로그 언어가 정해지고, 알림은 한 번만 꺼낸다", () => {
  chooseLogLanguage({ LOG_LANGUAGE: "zz" });
  assert.equal(logLanguage(), BASE_LANGUAGE);
  assert.deepEqual(takeLogLanguageNotice(), { kind: "unavailable", value: "zz" });
  assert.equal(takeLogLanguageNotice(), null);
  chooseLogLanguage({ LOG_LANGUAGE: "ko" });
  assert.equal(logLanguage(), "ko");
  assert.equal(takeLogLanguageNotice(), null);
});
