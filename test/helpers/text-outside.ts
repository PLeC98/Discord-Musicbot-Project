// 봇 코드(src/)에서 언어 모듈(ui/text/<언어>/, rules/text/<언어>/) 밖에 적힌 한글 문자열을 파일마다 센다. 로그와 예외 메시지는 번역하지 않으므로(로그 언어) 세지 않는다.
// 로그인지는 가장 가까운 호출로 가른다: 로거(log.warn 등), 로그 라벨을 받는 함수, Error를 만드는 곳, throw

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { LANGUAGES } from "../../src/rules/languages.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");
const HANGUL = /[가-힣ㄱ-ㆎ]/;

// 로그 라벨, 예외 메시지를 받는 함수(이름이 같으면 어느 모듈의 것이든)
const LOG_CALLS = new Set(["bestEffort", "unlessGone", "repeatingFailure", "failing", "warnOnce", "codedError", "logRejection", "register", "dispose", "describeError"]);
const LOGGER = /^(?:log|logger|console)(?:\.\w+)*\.(?:trace|debug|info|warn|error|fatal|log)$/;

const posix = (p: string) => p.split(path.sep).join("/");

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = posix(path.join(dir, e.name));
    return e.isDirectory() ? walk(rel) : rel.endsWith(".ts") ? [rel] : [];
  });
}

// 언어 모듈 폴더는 문구표라 세지 않는다
const isLanguageFolder = (rel: string) => LANGUAGES.some((one) => rel.startsWith(`src/ui/text/${one.tag}/`) || rel.startsWith(`src/rules/text/${one.tag}/`));

function isLogged(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isThrowStatement(at)) return true;
    if (ts.isNewExpression(at) && /Error$/.test(at.expression.getText())) return true;
    if (ts.isCallExpression(at)) {
      const callee = at.expression.getText();
      const name = callee.split(".").at(-1) ?? callee;
      if (LOGGER.test(callee) || LOG_CALLS.has(name)) return true;
    }
    if (ts.isFunctionLike(at) || ts.isSourceFile(at)) return false;
  }
  return false;
}

/** 파일 하나의 로그 밖 한글 문자열 */
function stringsOf(rel: string): string[] {
  const source = ts.createSourceFile(rel, fs.readFileSync(path.join(ROOT, rel), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (literal && HANGUL.test(node.text) && !isLogged(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** 파일마다 로그 밖 한글 문자열 수(0인 파일은 뺀다) */
function textOutside(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rel of walk("src")) {
    if (isLanguageFolder(rel)) continue;
    const n = stringsOf(rel).length;
    if (n) counts[rel] = n;
  }
  return counts;
}

export { textOutside, stringsOf };
