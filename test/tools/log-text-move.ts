// 로그 문구를 코드에서 문구표(locales/ko/log)로 옮기는 도구. 로그 계열 다국어의 옮기기 동안만 쓰고, 끝나면 지운다.
//
//   node test/tools/log-text-move.ts scan <계획.json> <파일...>   옮길 자리를 계획 파일로 뽑는다. 키는 비워 둔다(사람이 채운다)
//   node test/tools/log-text-move.ts apply <계획.json>            계획 파일대로 코드와 문구표를 바꾼다
//   node test/tools/log-text-move.ts verify <ref> <파일...>       ref 버전과 지금 버전의 로그 호출을 짝지어, 문구표 항목에 값 식을 끼운 글이 원래 글과 같은지 확인한다
//
// 기준은 문구표 밖 한글 집계 분류(test/helpers/text-outside 의 koreanSites)다. 도구가 옮기지 않는 한글 자리는 계획 파일의 manual, unplanned에 남긴다.
// 자동으로 옮기는 꼴: 로그 호출의 (글), (바인딩, 글), (err, 글), 글 뒤에 문자열 값(공백으로 이어 붙는다), repeatingFailure 의 라벨, logRuleLine 을 ruleLogText 로.
// 그 밖(예외, 다른 라벨 도우미, 글 뒤의 오류 값, 슬롯 안의 한글 조각, 변수로 만든 글)은 표시만 한다

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { koreanSites } from "../helpers/text-outside.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");
const LOG_DIR = "locales/ko/log";
const LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);
const HANGUL = /[가-힣ㄱ-ㆎ]/;
// 값 식의 타입 중 그대로 넘기는 것. 그 밖은 String(식)으로 감싼다(템플릿 문자열 변환과 같은 결과)
const PLAIN_TYPES = new Set(["string", "number", "boolean"]);

/** 슬롯 하나: 원래 식, 문구 함수의 값 이름, 값 타입 */
type Slot = { expr: string; param: string; type: string };
/** 옮길 자리 하나. start, end: 바꿀 범위(글 인자, 글 뒤 값까지). parts: 고정 글(슬롯 수 + 1, 해석한 글) */
type Site = { file: string; line: number; start: number; end: number; kind: "log" | "label" | "rule"; namespace: string | null; key: string | null; parts: string[]; slots: Slot[] };
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
    const type = typeOf(span.expression);
    const plain = type.split("|").every((one) => PLAIN_TYPES.has(one));
    const text = span.expression.getText();
    slots.push({ expr: plain ? text : `String(${text})`, param: paramName(span.expression, taken), type: plain ? type : "string" });
    parts.push(span.literal.text);
  }
  return { parts, slots };
}

/** 소스 하나에서 옮길 자리, 손으로 볼 자리, 계획에 없는 한글 자리 */
function scanSource(file: string, text: string, typeOf: TypeOf, source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)): Plan {
  const loggers = loggersOf(source);
  const sites: Site[] = [];
  const manual: Manual[] = [];
  const covered: Array<[number, number]> = [];
  const mark = (node: ts.Node, why: string) => {
    manual.push({ file, line: lineOf(source, node.getStart(source)), text: node.getText(source).slice(0, 160), why });
    covered.push([node.getStart(source), node.getEnd()]);
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      const owner = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : null;
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
    out = `${out.slice(0, site.start)}L.${site.namespace}.${site.key}(${args})${out.slice(site.end)}`;
  }
  if (sites.some((site) => site.kind !== "rule")) out = withImport(file, out, "L", "src/infra/log/text.ts");
  if (sites.some((site) => site.kind === "rule")) {
    out = withImport(file, out, "ruleLogText", "src/rules/text/index.ts");
    // logRuleLine 을 더 쓰지 않으면 import 에서 뺀다
    if (!/\blogRuleLine\(/.test(out)) out = out.replace(/(import\s*\{[^}]*?)\blogRuleLine\b,?\s*/, "$1").replace(/import\s*\{\s*\}\s*from\s*"[^"]+";\n?/, "");
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
const unwrap = (expr: string) => /^String\(([\s\S]*)\)$/.exec(expr)?.[1] ?? expr;

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

/** 파일 하나의 원래 판과 지금 판을 대조한 차이 */
function verifySource(file: string, before: string, after: string, catalogs: (namespace: string) => string | null): string[] {
  const old = callsOf(file, before);
  const now = callsOf(file, after);
  if (old.length !== now.length) return [`${file}: 로그 호출 수가 다름(${old.length} → ${now.length})`];
  return old.flatMap((call, i) => {
    const why = sameCall(call, now[i], catalogs);
    return why ? [`${file}:${lineOf(call.getSourceFile(), call.getStart())}: ${why}`] : [];
  });
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

function scanCommand(planFile: string, files: string[]) {
  const { typeOf, sourceOf } = checkerTypeOf(files);
  const plans = files.map((file) => scanSource(file, fs.readFileSync(path.join(ROOT, file), "utf8"), typeOf, sourceOf(file)));
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

if (import.meta.main) {
  const [command, first, ...rest] = process.argv.slice(2);
  if (command === "scan" && first) scanCommand(first, rest);
  else if (command === "apply" && first) applyCommand(first);
  else if (command === "verify" && first) verifyCommand(first, rest);
  else {
    console.error("사용: scan <계획.json> <파일...> | apply <계획.json> | verify <ref> <파일...>");
    process.exitCode = 2;
  }
}

export { scanSource, duplicatesOf, entryOf, withEntries, entryShape, applySource, verifySource };
export type { Site, Plan, TypeOf };
