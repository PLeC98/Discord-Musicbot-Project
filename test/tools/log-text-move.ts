// 로그 문구를 코드에서 문구표(locales/ko/log)로 옮기는 도구. 로그 계열 다국어의 옮기기 동안만 쓰고, 끝나면 지운다.
//
//   node test/tools/log-text-move.ts scan [--literals] <계획.json> <파일...>   옮길 자리를 계획 파일로 뽑는다. 키는 비워 둔다(사람이 채운다).
//     --literals: 다른 꼴이 잡지 않은 한글 글도 그 자리에서 문구 호출로(돌려주는 이유 글, 표). 글이 서술자로 바뀌면 깨지는 자리(Map 키, 글 비교)는 사람이 뺀다
//   node test/tools/log-text-move.ts apply <계획.json>            계획 파일대로 코드와 문구표를 바꾼다
//   node test/tools/log-text-move.ts verify <ref> <파일...>       ref 버전과 지금 버전의 로그 호출을 짝지어, 문구표 항목에 값 식을 끼운 글이 원래 글과 같은지 확인한다
//   node test/tools/log-text-move.ts rebase ["<파일> <종류>"...]  문구표 밖 한글 지도의 기준표를 지금 수로(늘어난 것은 적은 것만 받는다)
//
// 기준은 문구표 밖 한글 집계 분류(test/helpers/text-outside 의 koreanSites)다. 도구가 옮기지 않는 한글 자리는 계획 파일의 manual, unplanned에 남긴다.
// 자동으로 옮기는 꼴: 로그 호출의 (글), (바인딩, 글), (err, 글), 글 뒤에 문자열 값(공백으로 이어 붙는다), repeatingFailure 의 라벨, logRuleLine 을 ruleLogText 로.
// 예외: new Error(글, 옵션) 를 logTextError(문구, 옵션) 로, 예외 도우미(codedError, timeoutError 등)와 서술자를 받는 Error 클래스(SsrfError)의 글 인자를 문구로.
// 그 밖(Error 를 이은 클래스, 다른 라벨 도우미, 글 뒤의 오류 값, 슬롯 안의 한글 조각, 변수로 만든 글)은 표시만 한다

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { koreanMap, koreanSites, type KoreanCounts } from "../helpers/text-outside.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");
const LOG_DIR = "locales/ko/log";
const LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);
const HANGUL = /[가-힣ㄱ-ㆎ]/;
// 값 식의 타입 중 그대로 넘기는 것. 그 밖은 String(식)으로 감싼다(템플릿 문자열 변환과 같은 결과)
const PLAIN_TYPES = new Set(["string", "number", "boolean"]);
// 글 인자를 서술자로도 받는 예외 도우미와 그 인자 자리
const MESSAGE_ARGS: Readonly<Record<string, number>> = { codedError: 1, timeoutError: 0 };
// 파일 안에서만 예외 도우미로 보는 이름(이름이 흔하다)
const MESSAGE_ARGS_IN: Readonly<Record<string, Readonly<Record<string, number>>>> = { "src/infra/zip.ts": { bad: 0 } };
// 생성자의 첫 인자로 서술자도 받는 Error 클래스
const MESSAGE_CLASSES = new Set(["SsrfError"]);
/** 예외 도우미면 글 인자 자리, 아니면 -1 */
const messageArgOf = (file: string, name: string) => MESSAGE_ARGS[name] ?? MESSAGE_ARGS_IN[file]?.[name] ?? -1;

/** 슬롯 하나: 원래 식, 문구 함수의 값 이름, 값 타입 */
type Slot = { expr: string; param: string; type: string };
/**
 * 옮길 자리 하나. start, end: 바꿀 범위(글 인자, 글 뒤 값까지). parts: 고정 글(슬롯 수 + 1, 해석한 글).
 * kind: log(로그 호출의 글), label(라벨, 예외 도우미 codedError, timeoutError 의 글 인자), rule(logRuleLine), error(new Error 전체를 logTextError 로. rest: 글 뒤 인자의 원문)
 */
type Site = { file: string; line: number; start: number; end: number; kind: "log" | "label" | "rule" | "error"; namespace: string | null; key: string | null; parts: string[]; slots: Slot[]; rest?: string[] };
type Manual = { file: string; line: number; text: string; why: string };
type Plan = { sites: Site[]; manual: Manual[]; unplanned: Array<{ file: string; line: number; text: string }>; duplicates: string[][] };
/** 슬롯 식의 타입 이름(PLAIN_TYPES 의 이름들을 | 로 잇거나, 그 밖이면 "other") */
type TypeOf = (expr: ts.Expression) => string;

const lineOf = (source: ts.SourceFile, pos: number) => source.getLineAndCharacterOfPosition(pos).line + 1;
const hasHangul = (node: ts.Node) => {
  let found = false;
  const visit = (n: ts.Node) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && HANGUL.test(n.text)) found = true;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
};

/** 로거 변수와 그 네임스페이스(child({ category })의 분류. 모르면 null) */
function loggersOf(source: ts.SourceFile): Map<string, string | null> {
  const out = new Map<string, string | null>([
    ["log", null],
    ["logger", null],
  ]);
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && /\.child\(/.test(node.initializer.getText(source))) {
      const category = /category:\s*"([a-z][a-zA-Z0-9]*)"/.exec(node.initializer.getText(source))?.[1] ?? null;
      out.set(node.name.text, category);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** 값 식에서 값 이름을 짓는다: 식별자면 그 이름, 속성 접근이면 마지막 이름, 호출이면 호출한 함수 이름. 겹치면 뒤에 숫자를 붙인다 */
function paramName(expr: ts.Expression, taken: Set<string>): string {
  let base = "value";
  if (ts.isIdentifier(expr)) base = expr.text;
  else if (ts.isPropertyAccessExpression(expr)) base = expr.name.text;
  else if (ts.isCallExpression(expr)) base = ts.isPropertyAccessExpression(expr.expression) ? expr.expression.name.text : ts.isIdentifier(expr.expression) ? expr.expression.text : "value";
  base = base.replace(/^_+/, "") || "value";
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
  taken.add(name);
  return name;
}

/** 글 인자(문자열이나 템플릿)를 고정 글과 슬롯으로. 슬롯 안에 한글이 있으면 null */
function partsOf(node: ts.Expression, typeOf: TypeOf): { parts: string[]; slots: Slot[] } | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { parts: [node.text], slots: [] };
  if (!ts.isTemplateExpression(node)) return null;
  const taken = new Set<string>();
  const parts = [node.head.text];
  const slots: Slot[] = [];
  for (const span of node.templateSpans) {
    if (hasHangul(span.expression)) return null;
    const text = span.expression.getText();
    // 규칙 문제의 글(logRuleLine(문제))은 규칙 문제 서술자로 넘겨 그 코드가 값 안에 남게 한다(글은 같다)
    const rule = ts.isCallExpression(span.expression) && span.expression.expression.getText() === "logRuleLine" && span.expression.arguments.length === 1;
    if (rule) {
      slots.push({ expr: `ruleLogText(${(span.expression as ts.CallExpression).arguments[0].getText()})`, param: paramName((span.expression as ts.CallExpression).arguments[0], taken), type: "string" });
      parts.push(span.literal.text);
      continue;
    }
    const type = typeOf(span.expression);
    const plain = type.split("|").every((one) => PLAIN_TYPES.has(one));
    slots.push({ expr: plain ? text : `String(${text})`, param: paramName(span.expression, taken), type: plain ? type : "string" });
    parts.push(span.literal.text);
  }
  return { parts, slots };
}

/** 소스 하나에서 옮길 자리, 손으로 볼 자리, 계획에 없는 한글 자리 */
/** literals: 다른 꼴이 잡지 않은 한글 글(데이터, bug 빼고)도 그 자리에서 문구 호출로 바꿀 자리로 뽑는다(돌려주는 이유 글, 표, 모아 찍는 줄) */
function scanSource(file: string, text: string, typeOf: TypeOf, source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), { literals = false }: { literals?: boolean } = {}): Plan {
  const loggers = loggersOf(source);
  const sites: Site[] = [];
  const manual: Manual[] = [];
  const covered: Array<[number, number]> = [];
  const mark = (node: ts.Node, why: string) => {
    manual.push({ file, line: lineOf(source, node.getStart(source)), text: node.getText(source).slice(0, 160), why });
    covered.push([node.getStart(source), node.getEnd()]);
  };
  // 예외의 네임스페이스: 파일의 로거 분류가 하나면 그것(없거나 여럿이면 사람이 채운다)
  const categories = [...new Set([...loggers.values()].filter((one) => one !== null))];
  const errorSpace = categories.length === 1 ? categories[0] : null;
  const errorSite = (node: ts.Node, message: ts.Expression, kind: "label" | "error", rest: ts.Expression[] = []) => {
    const parsed = partsOf(message, typeOf);
    if (!parsed) return mark(node, "예외 글 슬롯 안의 한글 조각");
    const [start, end] = kind === "error" ? [node.getStart(source), node.getEnd()] : [message.getStart(source), message.getEnd()];
    sites.push({ file, line: lineOf(source, message.getStart(source)), start, end, kind, namespace: errorSpace, key: null, ...parsed, ...(kind === "error" ? { rest: rest.map((arg) => arg.getText(source)) } : {}) });
    covered.push([start, end]);
  };
  const visit = (node: ts.Node) => {
    // new Error(글, 옵션) → logTextError(문구, 옵션). Error 를 이은 클래스는 생성자가 달라 손으로 본다
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Error" && node.arguments?.length && hasHangul(node.arguments[0])) {
      errorSite(node, node.arguments[0], "error", node.arguments.slice(1));
      return;
    }
    // 서술자를 받는 Error 클래스: 글 인자만 문구로
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && MESSAGE_CLASSES.has(node.expression.text) && node.arguments?.length && hasHangul(node.arguments[0])) {
      errorSite(node, node.arguments[0], "label");
      node.arguments.slice(1).forEach(visit);
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      const owner = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : null;
      // 예외 도우미의 글 인자: codedError(코드, 글), timeoutError(글) 등(MESSAGE_ARGS)
      const messageAt = messageArgOf(file, name);
      if (messageAt >= 0 && ts.isIdentifier(callee) && node.arguments.length > messageAt && hasHangul(node.arguments[messageAt])) {
        errorSite(node, node.arguments[messageAt], "label");
        node.arguments.forEach((arg, i) => i !== messageAt && visit(arg));
        return;
      }
      // 로그 호출: logger.level(...)
      if (owner && loggers.has(owner) && LEVELS.has(name)) {
        const namespace = loggers.get(owner) ?? null;
        const at = node.arguments.findIndex((arg) => ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) || ts.isTemplateExpression(arg) || (ts.isCallExpression(arg) && arg.expression.getText(source) === "logRuleLine"));
        const msg = at >= 0 && at <= 1 ? node.arguments[at] : undefined;
        if (msg && ts.isCallExpression(msg)) {
          sites.push({ file, line: lineOf(source, msg.getStart(source)), start: msg.expression.getStart(source), end: msg.expression.getEnd(), kind: "rule", namespace, key: null, parts: [], slots: [] });
        } else if (msg && hasHangul(msg)) {
          const extras = node.arguments.slice(at + 1);
          const parsed = partsOf(msg, typeOf);
          const extrasPlain = extras.every((extra) => typeOf(extra) === "string" && !hasHangul(extra));
          if (!parsed) mark(node, "슬롯 안의 한글 조각");
          else if (extras.length && (!extrasPlain || parsed.parts.some((part) => part.includes("%")))) mark(node, "글 뒤의 값(오류, 글 아닌 값, % 가 든 글)");
          else {
            // 글 뒤의 문자열 값은 util.format처럼 공백 하나로 이어 붙인다
            const taken = new Set(parsed.slots.map((slot) => slot.param));
            for (const extra of extras) {
              parsed.parts[parsed.parts.length - 1] += " ";
              parsed.slots.push({ expr: extra.getText(source), param: paramName(extra, taken), type: "string" });
              parsed.parts.push("");
            }
            const last = extras.at(-1) ?? msg;
            sites.push({ file, line: lineOf(source, msg.getStart(source)), start: msg.getStart(source), end: last.getEnd(), kind: "log", namespace, key: null, ...parsed });
            covered.push([msg.getStart(source), last.getEnd()]);
          }
        } else if (hasHangul(node)) mark(node, "변수로 만든 글이나 다른 꼴의 로그 호출");
        // repeatingFailure(로그 함수들, 라벨)의 라벨
      } else if (name === "repeatingFailure" && node.arguments.length >= 2 && hasHangul(node.arguments[1])) {
        const label = node.arguments[1];
        const parsed = partsOf(label, typeOf);
        const owners = [...loggers.keys()].filter((logger) => new RegExp(`\\b${logger}\\.`).test(node.arguments[0].getText(source)));
        if (!parsed) mark(label, "라벨 슬롯 안의 한글 조각");
        else {
          sites.push({ file, line: lineOf(source, label.getStart(source)), start: label.getStart(source), end: label.getEnd(), kind: "label", namespace: owners.length === 1 ? (loggers.get(owners[0]) ?? null) : null, key: null, ...parsed });
          covered.push([label.getStart(source), label.getEnd()]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const inside = (pos: number) => covered.some(([from, to]) => pos >= from && pos < to);
  if (literals) {
    // 옮길 글 자리: 집계 분류가 로그 계열이나 그 밖인 한글 글. 가장 바깥 글만(안쪽 글은 슬롯 안의 한글 조각이다)
    const wanted = new Set(
      koreanSites(file, text)
        .filter((site) => (site.kind === "log" || site.kind === "outside") && !inside(site.start))
        .map((site) => site.start),
    );
    const visitLiteral = (node: ts.Node) => {
      const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
      if (literal && hasHangul(node) && [...wanted].some((at) => at >= node.getStart(source) && at < node.getEnd()) && !inside(node.getStart(source))) {
        const parsed = partsOf(node as ts.Expression, typeOf);
        if (!parsed) mark(node, "슬롯 안의 한글 조각");
        else {
          sites.push({ file, line: lineOf(source, node.getStart(source)), start: node.getStart(source), end: node.getEnd(), kind: "label", namespace: errorSpace, key: null, ...parsed });
          covered.push([node.getStart(source), node.getEnd()]);
        }
        return;
      }
      ts.forEachChild(node, visitLiteral);
    };
    visitLiteral(source);
  }
  const unplanned = koreanSites(file, text)
    .filter((site) => site.kind !== "data" && !inside(site.start))
    .map(({ line, text: value }) => ({ file, line, text: value }));
  return { sites, manual, unplanned, duplicates: [] };
}

/** 고정 글이 같은 자리(키를 함께 쓸 수 있다) */
function duplicatesOf(sites: Site[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const site of sites.filter((one) => one.kind !== "rule")) {
    const id = JSON.stringify([site.namespace, site.parts]);
    groups.set(id, [...(groups.get(id) ?? []), `${site.file}:${site.line}`]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

// ── 문구표 ─────────────────────────────────────────────────────────────

/** 템플릿 안에 그대로 쓸 수 있게 글을 이스케이프한다 */
const escapeTemplate = (text: string) => text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");

/** 문구표 항목 한 줄 */
function entryOf(site: Site): string {
  const body = `\`${site.parts.map((part, i) => escapeTemplate(part) + (i < site.slots.length ? `\${${site.slots[i].param}}` : "")).join("")}\``;
  if (!site.slots.length) return `  ${site.key}: () => ${body},`;
  const names = site.slots.map((slot) => slot.param);
  return `  ${site.key}: ({ ${names.join(", ")} }: { ${site.slots.map((slot) => `${slot.param}: ${slot.type.split("|").join(" | ")}`).join("; ")} }) => ${body},`;
}

/** 문구표 파일(네임스페이스 하나)에 항목을 더한 글. 파일이 없으면 새로 */
function withEntries(namespace: string, current: string | null, entries: string[]): string {
  if (current === null) return `// 로그 문구: ${namespace} 분류\n\nconst ${namespace} = {\n${entries.join("\n")}\n};\n\nexport { ${namespace} };\n`;
  const close = current.lastIndexOf("\n};");
  if (close < 0) throw new Error(`${namespace} 문구표에서 객체의 끝을 찾지 못함`);
  return `${current.slice(0, close)}\n${entries.join("\n")}${current.slice(close)}`;
}

/** 문구표에서 항목 하나를 읽는다: 값 이름과 본문의 고정 글. 본문이 템플릿 하나가 아니면(직접 쓴 문구) null */
function entryShape(catalog: string, key: string): { params: string[]; parts: string[] } | null {
  const source = ts.createSourceFile("catalog.ts", catalog, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found: { params: string[]; parts: string[] } | null = null;
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === key && ts.isArrowFunction(node.initializer)) {
      const fn = node.initializer;
      const binding = fn.parameters[0]?.name;
      const order = binding && ts.isObjectBindingPattern(binding) ? binding.elements.map((element) => element.name.getText(source)) : [];
      const body = fn.body;
      if (ts.isNoSubstitutionTemplateLiteral(body) || ts.isStringLiteral(body)) found = { params: order, parts: [body.text] };
      else if (ts.isTemplateExpression(body) && body.templateSpans.every((span) => ts.isIdentifier(span.expression))) found = { params: body.templateSpans.map((span) => span.expression.getText(source)), parts: [body.head.text, ...body.templateSpans.map((span) => span.literal.text)] };
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// ── 바꾸기 ─────────────────────────────────────────────────────────────

/** 상대 경로의 import 지정자 */
const specifierTo = (fromFile: string, target: string) => {
  const rel = path.posix.relative(path.posix.dirname(fromFile), target);
  return rel.startsWith(".") ? rel : `./${rel}`;
};

/** 소스에 import 를 더한다(이미 있으면 그대로). 마지막 import 문 뒤에 */
function withImport(file: string, text: string, name: string, target: string): string {
  const spec = specifierTo(file, target);
  if (new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(text)) return text;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = source.statements.filter(ts.isImportDeclaration);
  const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
  return `${text.slice(0, at)}\nimport { ${name} } from "${spec}";${text.slice(at)}`;
}

/** 호출부를 바꾼 소스. sites 는 한 파일의 것 */
function applySource(file: string, text: string, sites: Site[]): string {
  let out = text;
  for (const site of [...sites].sort((a, b) => b.start - a.start)) {
    if (site.kind === "rule") {
      out = `${out.slice(0, site.start)}ruleLogText${out.slice(site.end)}`;
      continue;
    }
    if (!site.namespace || !site.key) throw new Error(`${file}:${site.line}: 네임스페이스와 키를 채워야 한다`);
    const args = site.slots.length ? `{ ${site.slots.map((slot) => (slot.param === slot.expr ? slot.param : `${slot.param}: ${slot.expr}`)).join(", ")} }` : "";
    const text = `L.${site.namespace}.${site.key}(${args})`;
    const replaced = site.kind === "error" ? `logTextError(${[text, ...(site.rest ?? [])].join(", ")})` : text;
    out = `${out.slice(0, site.start)}${replaced}${out.slice(site.end)}`;
  }
  if (sites.some((site) => site.kind !== "rule")) out = withImport(file, out, "L", "src/infra/log/text.ts");
  if (sites.some((site) => site.kind === "error")) out = withImport(file, out, "logTextError", "src/infra/log/log-text.ts");
  if (sites.some((site) => site.kind === "rule" || site.slots.some((slot) => slot.expr.startsWith("ruleLogText(")))) {
    out = withImport(file, out, "ruleLogText", "src/rules/text/index.ts");
    // logRuleLine 을 더 쓰지 않으면 import 에서 뺀다(부르지 않고 값으로 넘기는 곳도 쓰는 곳이다: problems.map(logRuleLine))
    const uses = out.replace(/import\s*\{[^}]*\}\s*from\s*"[^"]+";/g, "").match(/\blogRuleLine\b/g)?.length ?? 0;
    if (!uses) out = out.replace(/(import\s*\{[^}]*?)\blogRuleLine\b,?\s*/, "$1").replace(/import\s*\{\s*\}\s*from\s*"[^"]+";\n?/, "");
  }
  return out;
}

// ── 대조 ──────────────────────────────────────────────────────────────

/** 로그 호출과 repeatingFailure 호출을 소스 차례대로 */
function callsOf(file: string, text: string): ts.CallExpression[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const loggers = loggersOf(source);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      const owner = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : null;
      if ((owner && loggers.has(owner) && LEVELS.has(name)) || name === "repeatingFailure") calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

// String(식)은 안쪽 식으로 본다(옮길 때 그것만 감쌀 수 있다)
// ruleLogText(문제)는 logRuleLine(문제)와 같은 글이다
const unwrap = (expr: string) => (/^String\(([\s\S]*)\)$/.exec(expr)?.[1] ?? expr).replace(/^ruleLogText\(/, "logRuleLine(");

/** 글 인자가 그리는 것: 고정 글과 값 식(문자열, 템플릿, L.ns.key({ ... })) */
function messageOf(arg: ts.Expression, catalogs: (namespace: string) => string | null): { parts: string[]; exprs: string[] } | string {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return { parts: [arg.text], exprs: [] };
  if (ts.isTemplateExpression(arg)) return { parts: [arg.head.text, ...arg.templateSpans.map((span) => span.literal.text)], exprs: arg.templateSpans.map((span) => unwrap(span.expression.getText())) };
  const called = ts.isCallExpression(arg) ? /^L\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/.exec(arg.expression.getText()) : null;
  if (!called || !ts.isCallExpression(arg)) return "문구 호출이 아님";
  const catalog = catalogs(called[1]);
  if (catalog === null) return `문구표 ${called[1]} 없음`;
  const shape = entryShape(catalog, called[2]);
  if (!shape) return `${called[1]}.${called[2]}: 직접 쓴 문구(실행 대조로 본다)`;
  const given = new Map<string, string>();
  const object = arg.arguments[0];
  if (object && ts.isObjectLiteralExpression(object)) {
    for (const prop of object.properties) {
      if (ts.isPropertyAssignment(prop)) given.set(prop.name.getText(), unwrap(prop.initializer.getText()));
      else if (ts.isShorthandPropertyAssignment(prop)) given.set(prop.name.text, prop.name.text);
    }
  }
  return { parts: shape.parts, exprs: shape.params.map((param) => given.get(param) ?? `(값 ${param} 없음)`) };
}

/** 원래 호출과 바꾼 호출이 같은 글을 찍는지 확인한다. 같으면 null, 다르면 까닭 */
function sameCall(before: ts.CallExpression, after: ts.CallExpression, catalogs: (namespace: string) => string | null): string | null {
  if (before.getText() === after.getText()) return null;
  if (before.expression.getText() !== after.expression.getText()) return `부르는 것이 다름: ${before.expression.getText()} → ${after.expression.getText()}`;
  const isMessage = (arg: ts.Expression) => ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) || ts.isTemplateExpression(arg);
  const at = before.arguments.findIndex(isMessage);
  const ruleSwap = before.arguments.map((arg) => arg.getText().replace(/\blogRuleLine\(/g, "ruleLogText(")).join(", ") === after.arguments.map((arg) => arg.getText()).join(", ");
  if (ruleSwap) return null;
  if (at < 0) return "원래 호출에 글이 없음";
  const prefix = (call: ts.CallExpression) => call.arguments.slice(0, at).map((arg) => arg.getText());
  if (JSON.stringify(prefix(before)) !== JSON.stringify(prefix(after))) return "글 앞 인자(바인딩, 오류)가 다름";
  if (after.arguments.length !== at + 1) return "글 뒤에 인자가 남음";
  const old = messageOf(before.arguments[at], catalogs);
  const now = messageOf(after.arguments[at], catalogs);
  if (typeof old === "string") return old;
  if (typeof now === "string") return now;
  // 원래 글 뒤의 값은 공백 하나로 이어 붙었다
  for (const extra of before.arguments.slice(at + 1)) {
    old.parts[old.parts.length - 1] += " ";
    old.exprs.push(extra.getText());
    old.parts.push("");
  }
  if (JSON.stringify(old.parts) !== JSON.stringify(now.parts)) return `고정 글이 다름: ${JSON.stringify(old.parts)} → ${JSON.stringify(now.parts)}`;
  if (JSON.stringify(old.exprs) !== JSON.stringify(now.exprs)) return `값 식이 다름: ${JSON.stringify(old.exprs)} → ${JSON.stringify(now.exprs)}`;
  return null;
}

/** 예외를 만드는 식을 소스 차례대로: new Error, 서술자를 받는 Error 클래스, logTextError, 예외 도우미 */
function errorsOf(file: string, text: string): Array<ts.NewExpression | ts.CallExpression> {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: Array<ts.NewExpression | ts.CallExpression> = [];
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "Error" || MESSAGE_CLASSES.has(node.expression.text))) found.push(node);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "logTextError" || messageArgOf(file, node.expression.text) >= 0)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** 예외 식 하나의 메시지 인자 자리 */
const messageIndex = (file: string, node: ts.NewExpression | ts.CallExpression) => (ts.isCallExpression(node) ? Math.max(0, messageArgOf(file, node.expression.getText())) : 0);

/** 원래 예외 식과 바꾼 예외 식이 같은 메시지와 나머지 인자를 갖는지. 같으면 null, 다르면 까닭 */
function sameError(file: string, before: ts.NewExpression | ts.CallExpression, after: ts.NewExpression | ts.CallExpression, catalogs: (namespace: string) => string | null): string | null {
  if (before.getText() === after.getText()) return null;
  const callee = (node: ts.NewExpression | ts.CallExpression) => (ts.isNewExpression(node) ? `new ${node.expression.getText()}` : node.expression.getText());
  const [was, now] = [callee(before), callee(after)];
  // new Error(글, 옵션) 은 logTextError(문구, 옵션) 으로만 바뀐다. 도우미는 그대로다
  if (was !== now && !(was === "new Error" && now === "logTextError")) return `만드는 것이 다름: ${was} → ${now}`;
  const at = messageIndex(file, before);
  const oldArgs = [...(before.arguments ?? [])];
  const newArgs = [...(after.arguments ?? [])];
  const others = (args: ts.Expression[]) => args.filter((_, i) => i !== at).map((arg) => arg.getText());
  if (JSON.stringify(others(oldArgs)) !== JSON.stringify(others(newArgs))) return "메시지 밖의 인자가 다름";
  if (!oldArgs[at] || !newArgs[at]) return "메시지 인자가 없음";
  const old = messageOf(oldArgs[at], catalogs);
  const fresh = messageOf(newArgs[at], catalogs);
  if (typeof old === "string") return old;
  if (typeof fresh === "string") return fresh;
  if (JSON.stringify(old.parts) !== JSON.stringify(fresh.parts)) return `고정 글이 다름: ${JSON.stringify(old.parts)} → ${JSON.stringify(fresh.parts)}`;
  if (JSON.stringify(old.exprs) !== JSON.stringify(fresh.exprs)) return `값 식이 다름: ${JSON.stringify(old.exprs)} → ${JSON.stringify(fresh.exprs)}`;
  return null;
}

/** 글 자리를 소스 차례대로: 한글 글(가장 바깥 것)과 문구 호출(L.ns.key). 안으로 들어가지 않는다. 로그 호출, 예외 식의 안쪽은 그 대조가 본다 */
function textsOf(file: string, text: string): ts.Expression[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const owned = [...callsOf(file, text), ...errorsOf(file, text)].map((node) => [node.getStart(), node.getEnd()] as const);
  const isOwned = (node: ts.Node) => owned.some(([from, to]) => node.getStart(source) >= from && node.getEnd() <= to);
  const counted = new Set(
    koreanSites(file, text)
      .filter((site) => site.kind === "log" || site.kind === "outside")
      .map((site) => site.start),
  );
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    const literal = (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && hasHangul(node) && [...counted].some((at) => at >= node.getStart(source) && at < node.getEnd());
    const call = ts.isCallExpression(node) && /^L\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(node.expression.getText(source));
    if (literal || call) {
      if (!isOwned(node)) found.push(node as ts.Expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** 파일 하나의 원래 판과 지금 판을 대조한 차이(로그 호출, 예외 식, 글 자리) */
function verifySource(file: string, before: string, after: string, catalogs: (namespace: string) => string | null): string[] {
  const old = callsOf(file, before);
  const now = callsOf(file, after);
  if (old.length !== now.length) return [`${file}: 로그 호출 수가 다름(${old.length} → ${now.length})`];
  const oldErrors = errorsOf(file, before);
  const newErrors = errorsOf(file, after);
  if (oldErrors.length !== newErrors.length) return [`${file}: 예외 식 수가 다름(${oldErrors.length} → ${newErrors.length})`];
  const at = (node: ts.Node) => `${file}:${lineOf(node.getSourceFile(), node.getStart())}`;
  const oldTexts = textsOf(file, before);
  const newTexts = textsOf(file, after);
  if (oldTexts.length !== newTexts.length) return [`${file}: 글 자리 수가 다름(${oldTexts.length} → ${newTexts.length})`];
  const textProblems = oldTexts.flatMap((node, i) => {
    if (node.getText() === newTexts[i].getText()) return [];
    const old = messageOf(node, catalogs);
    const now = messageOf(newTexts[i], catalogs);
    if (typeof old === "string") return [`${at(node)}: ${old}`];
    if (typeof now === "string") return [`${at(node)}: ${now}`];
    if (JSON.stringify(old.parts) !== JSON.stringify(now.parts)) return [`${at(node)}: 고정 글이 다름: ${JSON.stringify(old.parts)} → ${JSON.stringify(now.parts)}`];
    if (JSON.stringify(old.exprs) !== JSON.stringify(now.exprs)) return [`${at(node)}: 값 식이 다름: ${JSON.stringify(old.exprs)} → ${JSON.stringify(now.exprs)}`];
    return [];
  });
  return [
    ...textProblems,
    ...old.flatMap((call, i) => {
      const why = sameCall(call, now[i], catalogs);
      return why ? [`${at(call)}: ${why}`] : [];
    }),
    ...oldErrors.flatMap((node, i) => {
      const why = sameError(file, node, newErrors[i], catalogs);
      return why ? [`${at(node)}: ${why}`] : [];
    }),
  ];
}

// ── 명령 ──────────────────────────────────────────────────────────────

/** 프로젝트 설정으로 만든 타입 검사기의 값 타입 이름 */
function checkerTypeOf(files: string[]): { typeOf: TypeOf; sourceOf: (file: string) => ts.SourceFile } {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  if (!parsed) throw new Error("tsconfig.json 을 읽지 못함");
  const program = ts.createProgram(
    files.map((file) => path.join(ROOT, file)),
    parsed.options,
  );
  const checker = program.getTypeChecker();
  const nameOf = (type: ts.Type): string[] => {
    if (type.isUnion()) return type.types.flatMap(nameOf);
    const flags = type.getFlags();
    if (flags & ts.TypeFlags.StringLike) return ["string"];
    if (flags & ts.TypeFlags.NumberLike) return ["number"];
    if (flags & ts.TypeFlags.BooleanLike) return ["boolean"];
    return ["other"];
  };
  const typeOf: TypeOf = (expr) => [...new Set(nameOf(checker.getTypeAtLocation(expr)))].sort().join("|");
  return { typeOf, sourceOf: (file) => program.getSourceFile(path.join(ROOT, file))! };
}

const readCatalog = (namespace: string) => {
  const file = path.join(ROOT, LOG_DIR, `${namespace}.ts`);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
};

function scanCommand(planFile: string, files: string[], literals: boolean) {
  const { typeOf, sourceOf } = checkerTypeOf(files);
  const plans = files.map((file) => scanSource(file, fs.readFileSync(path.join(ROOT, file), "utf8"), typeOf, sourceOf(file), { literals }));
  const sites = plans.flatMap((one) => one.sites);
  const plan: Plan = { sites, manual: plans.flatMap((one) => one.manual), unplanned: plans.flatMap((one) => one.unplanned), duplicates: duplicatesOf(sites) };
  fs.mkdirSync(path.dirname(planFile), { recursive: true });
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`옮길 자리 ${sites.length}, 손으로 볼 자리 ${plan.manual.length}, 계획에 없는 한글 ${plan.unplanned.length}, 같은 글 ${plan.duplicates.length}묶음`);
}

function applyCommand(planFile: string) {
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8")) as Plan;
  const byFile = Map.groupBy(plan.sites, (site) => site.file);
  const entries = new Map<string, Map<string, string>>();
  for (const site of plan.sites.filter((one) => one.kind !== "rule")) {
    if (!site.namespace || !site.key) throw new Error(`${site.file}:${site.line}: 네임스페이스와 키를 채워야 한다`);
    const space = entries.get(site.namespace) ?? new Map<string, string>();
    const entry = entryOf(site);
    const prior = space.get(site.key);
    if (prior && prior !== entry) throw new Error(`${site.namespace}.${site.key}: 같은 키에 다른 글`);
    space.set(site.key, entry);
    entries.set(site.namespace, space);
  }
  for (const [file, sites] of byFile) fs.writeFileSync(path.join(ROOT, file), applySource(file, fs.readFileSync(path.join(ROOT, file), "utf8"), sites));
  const indexFile = path.join(ROOT, LOG_DIR, "index.ts");
  for (const [namespace, space] of entries) {
    const current = readCatalog(namespace);
    const fresh = [...space].filter(([key]) => !current || !entryShape(current, key)).map(([, entry]) => entry);
    if (fresh.length) fs.writeFileSync(path.join(ROOT, LOG_DIR, `${namespace}.ts`), withEntries(namespace, current, fresh));
    const index = fs.readFileSync(indexFile, "utf8");
    if (!new RegExp(`export \\{ ${namespace} \\}`).test(index)) fs.writeFileSync(indexFile, `${index.trimEnd()}\nexport { ${namespace} } from "./${namespace}.ts";\n`);
  }
  console.log(`바꾼 파일 ${byFile.size}, 문구표 ${entries.size}개`);
}

function verifyCommand(ref: string, files: string[]) {
  const problems = files.flatMap((file) => {
    const before = execFileSync("git", ["show", `${ref}:${file}`], { cwd: ROOT, encoding: "utf8" });
    return verifySource(file, before, fs.readFileSync(path.join(ROOT, file), "utf8"), readCatalog);
  });
  for (const line of problems) console.log(line);
  console.log(problems.length ? `다름 ${problems.length}` : `같음: 파일 ${files.length}`);
  if (problems.length) process.exitCode = 1;
}

/** 문구표 밖 한글 지도의 기준표(test/ui/text/text-outside.json)를 지금 수로 고친다. 늘어난 것은 allowed(파일 종류)에 적은 것만 받는다 */
function rebaseCommand(allowed: string[]) {
  const file = path.join(ROOT, "test/ui/text/text-outside.json");
  const old = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, KoreanCounts>;
  const now = koreanMap();
  const more = Object.entries(now).flatMap(([name, counts]) => Object.entries(counts).flatMap(([kind, n]) => (n > (old[name]?.[kind as keyof KoreanCounts] ?? 0) && !allowed.includes(`${name} ${kind}`) ? [`${name} ${kind}`] : [])));
  if (more.length) throw new Error(`늘어난 것: ${more.join(", ")}`);
  const sorted = Object.fromEntries(
    Object.keys(now)
      .sort()
      .map((name) => [name, now[name]]),
  );
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log("기준표를 지금 수로 고침");
}

if (import.meta.main) {
  const [command, first, ...rest] = process.argv.slice(2);
  if (command === "scan" && first === "--literals" && rest[0]) scanCommand(rest[0], rest.slice(1), true);
  else if (command === "scan" && first) scanCommand(first, rest, false);
  else if (command === "apply" && first) applyCommand(first);
  else if (command === "verify" && first) verifyCommand(first, rest);
  else if (command === "rebase") rebaseCommand([first, ...rest].filter(Boolean));
  else {
    console.error('사용: scan [--literals] <계획.json> <파일...> | apply <계획.json> | verify <ref> <파일...> | rebase ["<파일> <종류>"...]');
    process.exitCode = 2;
  }
}

export { scanSource, duplicatesOf, entryOf, withEntries, entryShape, applySource, verifySource };
export type { Site, Plan, TypeOf };
