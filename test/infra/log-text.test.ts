// src/infra/log/log-text.ts, text.ts: 로그 문구 서술자와 진입점. 문구 코드와 값을 들고 그릴 때의 로그 언어로 그리며, 그리기는 던지지 않는다

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import ts from "typescript";
import { FAILED_MARK, isLogText, logText, plainArgs, renderLogText, takeRenderFailures } from "../../src/infra/log/log-text.ts";
import { L, missingLogText } from "../../src/infra/log/text.ts";
import { LOG_TEST_LANGUAGE, useTestLogLanguage } from "../../src/infra/log/language.ts";
import { TEST_LANGUAGE } from "../../src/rules/languages.ts";
import sink from "../../src/infra/log/sink.ts";

afterEach(() => useTestLogLanguage(false));

test("서술자는 코드와 값을 들고, 글은 그릴 때 만든다", () => {
  let calls = 0;
  const text = logText("demo.line", { n: 1 }, () => `줄 ${++calls}`);
  assert.equal(calls, 0, "만들 때는 그리지 않는다");
  assert.equal(renderLogText(text), "줄 1");
  assert.equal(text.event, "demo.line");
  assert.deepEqual(text.args, { n: 1 });
  assert.ok(isLogText(text));
  assert.ok(!isLogText({ event: "demo.line", args: {} }), "모양만 같은 객체는 서술자가 아니다");
});

test("문구 함수가 던지면 표식이 붙은 대체 글을 내고 던지지 않는다", () => {
  const text = logText("demo.broken", { name: "a" }, () => {
    throw new Error("x");
  });
  assert.equal(renderLogText(text), `${FAILED_MARK} demo.broken {"name":"a"}`);
  // 실패한 문구 코드가 남고, 꺼내면 비워진다(실행 전체 검사가 이 테스트를 실패시키지 않게)
  assert.deepEqual(takeRenderFailures(), ["demo.broken"]);
  assert.deepEqual(takeRenderFailures(), []);
});

test("글을 받는 자리에 잘못 넘어가도 객체 덤프 대신 글이 나온다(템플릿, util.format, inspect)", () => {
  const text = logText("demo.line", {}, () => "글");
  assert.equal(`${String(text)}`, "글");
  assert.equal(util.format("%s|%o", text, text), "글|글");
  assert.equal(util.inspect(text), "글");
});

test("서술자와 값은 얼려 있다(가리기, 자르기가 맨 위에 만들어 둔 서술자를 바꾸지 못한다)", () => {
  const text = logText("demo.line", { secret: "x" }, () => "");
  assert.ok(Object.isFrozen(text) && Object.isFrozen(text.args));
  assert.deepEqual(JSON.parse(JSON.stringify(text)), { event: "demo.line", args: { secret: "x" } }, "직렬화하면 코드와 값만");
});

test("값 안의 서술자(라벨)는 글로 바꿔 문구 함수에 넘긴다", () => {
  const label = logText("demo.label", {}, () => "라벨");
  assert.deepEqual(plainArgs({ label, n: 2, on: true, none: null }), { label: "라벨", n: 2, on: true, none: null });
});

test("진입점은 <이름공간>.<키> 코드의 서술자를 내고 지금 로그 언어로 그린다", () => {
  const text = L.config.logLanguageIgnored({ value: "zz", malformed: false, language: "ko" });
  assert.equal(text.event, "config.logLanguageIgnored");
  assert.deepEqual(text.args, { value: "zz", malformed: false, language: "ko" });
  assert.equal(renderLogText(text), "LOG_LANGUAGE 무시(zz): 그 언어의 로그 문구가 없음. 로그 언어: ko");
  useTestLogLanguage(true);
  assert.doesNotMatch(renderLogText(text), /[가-힣]/, "테스트 언어는 같은 서술자를 그릴 때 바꾼 글로 그린다");
  assert.match(renderLogText(text), /^LOG_LANGUAGE /);
});

test("로그 테스트 언어의 태그는 규칙, 봇 문구의 테스트 언어와 같다", () => {
  assert.equal(LOG_TEST_LANGUAGE, TEST_LANGUAGE);
});

test("저장소의 로그 문구는 빠진 것이 없다", () => {
  assert.deepEqual([...missingLogText()], []);
});

// 값만 홀로 있는 비밀은 가리기 패턴(앞말이 붙어야 걸린다)으로 못 잡으므로, 비밀 같은 이름의 값을 받는 문구를 두지 않는다
test("로그 문구 함수의 값 이름이 가리기 키 이름이 아니다", () => {
  const dir = path.join(import.meta.dirname, "..", "..", "locales", "ko", "log");
  const names = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const source = ts.createSourceFile(file, fs.readFileSync(path.join(dir, file), "utf8"), ts.ScriptTarget.Latest, true);
      const found: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) found.push(node.name.text);
        if (ts.isPropertySignature(node) && ts.isIdentifier(node.name)) found.push(node.name.text);
        ts.forEachChild(node, visit);
      };
      visit(source);
      return found;
    });
  assert.ok(names.includes("value"), "값 이름을 모은다");
  const redact = sink._internals.REDACT_KEYS;
  assert.deepEqual(
    names.filter((name) => redact.has(name.toLowerCase())),
    [],
  );
});
