// 화면 글꼴(Google Sans Flex, Pretendard, Twemoji): 언어마다 화면이 그리는 글자가 글꼴의 unicode-range 안에 있는지 검사한다.
// 범위 밖 글자는 시스템 글꼴로 대체되어 모양이 달라진다. 다른 문자를 쓰는 언어를 추가했을 때 여기서 걸리면 해당 문자의 글꼴(서브셋)을 추가한다.
// 화면 문구 파일은 Vue를 부르는 모듈이라 import하지 않고 TypeScript 파서로 문자열만 추출한다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { codepointsOf } from "../../scripts/unicode-range.ts";
import { BASE_LANGUAGE, LANGUAGES, TEST_LANGUAGE, infoOf, type Language, type TextLanguage } from "../../src/rules/languages.ts";
import { pseudoString } from "../../src/rules/pseudo-text.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");
const posix = (p: string) => p.split(path.sep).join("/");

// 본문 글꼴 목록(style.css의 --font-sans)이 쓰는 글꼴의 CSS
const FONT_CSS = ["dashboard/src/twemoji.css", "dashboard/src/google-sans-flex.css", "node_modules/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"];

// 한자(CJK 통합 한자)는 글꼴 목록 끝의 시스템 글꼴(system-ui)이 그린다. Pretendard에는 한자가 없다.
// 한국어 화면의 한자는 외부 사이트의 용어 인용(VocaDB의 "評価")과 이모지 이름 데이터(emojibase)뿐이다
const SYSTEM_HAN = codepointsOf("U+4E00-9FFF");

function covered(): Set<number> {
  const out = new Set<number>(SYSTEM_HAN);
  for (const file of FONT_CSS) {
    const css = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of css.matchAll(/unicode-range:\s*([^;]+);/g)) for (const cp of codepointsOf(m[1].replace(/\s+/g, " "))) out.add(cp);
  }
  return out;
}
const COVERED = covered();

/** 화면 번들이 부르는 그 언어 폴더의 파일: screen/index.ts에서 상대 경로로 따라간 locales/<언어>/ 안의 파일과 이모지 이름 */
function screenFiles(tag: TextLanguage): string[] {
  const base = `locales/${tag}/`;
  const seen = new Set<string>();
  const visit = (rel: string) => {
    if (seen.has(rel) || !rel.startsWith(base) || !fs.existsSync(path.join(ROOT, rel))) return;
    seen.add(rel);
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"';]*?from\s+"(\.{1,2}\/[^"]+)"/g)) visit(posix(path.join(path.dirname(rel), m[1])));
  };
  visit(`${base}screen/index.ts`);
  visit(`${base}screen/emoji.ts`);
  return [...seen].sort();
}

/** 파일 내 문자열 텍스트(문자열 리터럴, 템플릿 리터럴의 고정 문자열 부분). import 경로는 제외한다 */
function stringsOf(rel: string): string[] {
  const sf = ts.createSourceFile(rel, fs.readFileSync(path.join(ROOT, rel), "utf8"), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
}

/** 해당 언어의 형식 로케일로 포맷한 숫자, 날짜, 시각, 상대 시각(dashboard/src/utils/locale과 같은 형식) */
function formatted(language: Language): string[] {
  const locale = infoOf(language).locale;
  const at = new Date(Date.UTC(2026, 10, 21, 15, 4, 5));
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return [(1234567.891).toLocaleString(locale), at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }), at.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric", weekday: "long" }), at.toLocaleDateString(locale, { month: "short", day: "numeric" }), ...(["second", "minute", "hour", "day", "week", "month", "year"] as const).flatMap((unit) => [-1, 0, 1, -3, 5].map((n) => relative.format(n, unit)))];
}

/** 화면 글꼴 범위 밖의 글자(공백, 제어 문자 제외) */
const outside = (texts: string[]) => [...new Set([...texts.join("")])].filter((ch) => /\S/u.test(ch) && !COVERED.has(ch.codePointAt(0)!));
const label = (ch: string) => `${ch} U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;

// 테스트 언어는 기준 언어의 문구를 변환해 만들고(rules/pseudo-text), 날짜와 숫자는 해당 형식 로케일을 그대로 따른다
function screenTexts(language: Language): string[] {
  const literals = language === TEST_LANGUAGE ? screenFiles(BASE_LANGUAGE).flatMap(stringsOf).map(pseudoString) : screenFiles(language).flatMap(stringsOf);
  return [...literals, ...formatted(language)];
}

test("화면 번들이 부르는 파일을 찾는다(경로가 틀리면 아무것도 검사하지 않고 통과하는 것을 막는다)", () => {
  for (const { tag } of LANGUAGES) {
    const files = screenFiles(tag);
    assert.ok(files.includes(`locales/${tag}/screen/index.ts`) && files.includes(`locales/${tag}/screen/emoji.ts`), tag);
    assert.ok(files.some((file) => file.startsWith(`locales/${tag}/bot/`)) && files.some((file) => file.startsWith(`locales/${tag}/rules/`)), `${tag}: 화면에서도 쓰는 봇 문구와 규칙 문장`);
  }
});

for (const language of [...LANGUAGES.map((one) => one.tag), TEST_LANGUAGE] as Language[]) {
  test(`화면이 그리는 글자는 화면 글꼴의 범위 안에 포함된다(${language})`, () => {
    assert.deepEqual(outside(screenTexts(language)).map(label), []);
  });
}

test("화면 글꼴 범위 밖의 글자는 걸린다(검사가 실제로 동작한다)", () => {
  // 정해 둔 문자가 나중에 범위에 포함되더라도 검사가 유효하도록, 범위 밖의 글자를 계산해 넣는다
  const absent = Array.from({ length: 0x3000 }, (_, i) => String.fromCodePoint(0x0400 + i)).find((ch) => /\S/u.test(ch) && !COVERED.has(ch.codePointAt(0)!));
  assert.ok(absent, "범위 밖의 글자를 찾았다");
  assert.deepEqual(outside([...screenTexts(LANGUAGES[0].tag), absent]), [absent]);
});
