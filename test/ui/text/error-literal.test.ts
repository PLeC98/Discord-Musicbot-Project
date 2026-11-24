// src/, scripts/: 예외 메시지를 글자 그대로 적지 않는다. 로그로만 가면 로그 문구(logTextError), 화면까지 가면 규칙 문제(ruleError, problemError), 일어날 수 없는 일이면 bug(…).
// 내장 오류(Error, TypeError 등)를 만들 때 메시지 자리가 문자열, 템플릿이거나 그것을 이어 붙인 식이면 막는다. 한글이 없는 글(HTTP 401 등)도 막는다(문구표 밖 한글 지도는 한글만 센다)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
const posix = (p: string) => p.split(path.sep).join("/");

const BUILT_IN = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError", "DOMException"]);
// 메시지가 둘째 인자인 것(첫째는 오류 목록)
const MESSAGE_AT: Readonly<Record<string, number>> = { AggregateError: 1 };

/** 글자 그대로 둬도 되는 자리("파일: 메시지 원문" → 까닭). 비어 있는 것이 목표다 */
const ALLOWED: Readonly<Record<string, string>> = {};

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = posix(path.join(dir, e.name));
    return e.isDirectory() ? walk(rel) : rel.endsWith(".ts") ? [rel] : [];
  });
}

const unwrap = (node: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node) ? unwrap(node.expression) : node);

/** 글자 그대로의 글이 들어가는 식: 문자열, 템플릿, 그것을 이어 붙이거나 고르거나 대신 쓰는 식 */
function hasLiteralText(node: ts.Expression): boolean {
  const at = unwrap(node);
  if (ts.isStringLiteral(at) || ts.isNoSubstitutionTemplateLiteral(at) || ts.isTemplateExpression(at)) return true;
  if (ts.isBinaryExpression(at) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(at.operatorToken.kind)) return hasLiteralText(at.left) || hasLiteralText(at.right);
  if (ts.isConditionalExpression(at)) return hasLiteralText(at.whenTrue) || hasLiteralText(at.whenFalse);
  return false;
}

/** bug(…)의 인자 안(가장 가까운 함수 경계까지) */
function inBug(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isCallExpression(at) && ts.isIdentifier(at.expression) && at.expression.text === "bug") return true;
    if (ts.isFunctionLike(at) || ts.isSourceFile(at)) return false;
  }
  return false;
}

/** 내장 오류를 상속한 클래스 이름(super의 메시지도 본다) */
function builtInParent(node: ts.Node): string | null {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isClassLike(at)) {
      const parent = at.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
      return parent && ts.isIdentifier(parent) && BUILT_IN.has(parent.text) ? parent.text : null;
    }
  }
  return null;
}

/** 소스 하나에서 메시지를 글자 그대로 적은 내장 오류 생성(new Error(…), Error(…), 내장 오류를 상속한 클래스의 super(…)). 줄 번호와 메시지 원문 */
function literalErrors(rel: string, text: string): Array<{ line: number; message: string }> {
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Array<{ line: number; message: string }> = [];
  const visit = (node: ts.Node) => {
    let name: string | null = null;
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression) && BUILT_IN.has(node.expression.text)) name = node.expression.text;
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword) name = builtInParent(node);
    const message = name ? (node as ts.NewExpression | ts.CallExpression).arguments?.[MESSAGE_AT[name] ?? 0] : undefined;
    if (message && hasLiteralText(message) && !inBug(node)) out.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, message: message.getText(source) });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

test("내장 오류를 만들 때 메시지를 글자 그대로 적지 않는다(로그 문구, 규칙 문제, bug(…)로)", () => {
  const found = [...walk("src"), ...walk("scripts")].flatMap((rel) => literalErrors(rel, fs.readFileSync(path.join(ROOT, rel), "utf8")).map((one) => ({ key: `${rel}: ${one.message}`, at: `${rel}:${one.line} ${one.message}` })));
  assert.deepEqual(
    found.filter((one) => !(one.key in ALLOWED)).map((one) => one.at),
    [],
  );
  assert.deepEqual(
    Object.keys(ALLOWED).filter((key) => !found.some((one) => one.key === key)),
    [],
    "없어진 자리는 허용 목록에서도 지운다",
  );
});

test("글자 그대로의 메시지를 꼴마다 찾고, bug(…)와 값으로 받은 메시지는 넘긴다", () => {
  const source = ['throw new Error("HTTP 401");', "throw new TypeError(`잘못된 값 ${value}`);", 'throw Object.assign(new Error("실패 " + code), { code });', 'throw Error(ok ? "a" : reason);', 'throw new AggregateError(errors, "모두 실패");', 'class Gone extends Error { constructor() { super("끝남"); } }', 'throw bug("일어날 수 없는 상태");', "throw new Error(message);", "throw logTextError(L.net.httpStatus({ status }));", 'class Own extends Gone { constructor() { super("값"); } }'].join("\n");
  assert.deepEqual(
    literalErrors("src/example.ts", source).map((one) => one.line),
    [1, 2, 3, 4, 5, 6],
  );
});
