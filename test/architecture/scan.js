// 구조 게이트가 보는 것을 한 번 훑어 모은다. typescript 파서를 쓰는 것은 CommonJS · ESM · .ts 를 같은 코드로 읽기 위해서다.
//
//   node test/architecture/scan.js    지금 숫자와 목록을 찍는다
//
// 부름: require("…") · require.resolve("…") · import … from "…" · export … from "…" · import("…"). 글자로 된 상대 경로만 따라간다.
// import type · export type 은 실행 때 지워지므로 부름이 아니다. 타입은 주인 모듈에서 어느 층이든 가져온다.
// 지연 부름: 함수 안(ts.isFunctionLike)에 있는 글자 경로의 require · import(). 맨 위의 if · try 안은 지연으로 치지 않는다.
// 글자가 아닌 경로(명령 · 이벤트 불러오기)는 따로 목록으로 둔다.
// config 꺼내 두기: 루트 config.js 를 받은 이름에서 함수 밖에서 값을 읽는 곳. 클래스 필드의 초깃값은 만들 때 읽으므로 뺀다.
// 모듈 바꿔 끼우기: 테스트의 require.cache.
// 메서드 바꿔 끼우기: 테스트가 프로젝트 모듈에서 온 이름의 속성에 함수를 넣거나 mock.method 로 덮는 파일.

import fs from "fs";
import path from "path";
import ts from "typescript";

const ROOT = path.join(import.meta.dirname, "..", "..");

// 왼쪽이 오른쪽을 부를 수 있다
const LAYERS = ["app", "입구", "usecases", "ui", "player", "autoplay", "media", "sources", "store", "config", "rules", "infra"];

const posix = (p) => p.split(path.sep).join("/");

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const rel = posix(path.join(dir, e.name));
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(c?js|mjs|ts)$/.test(e.name)) out.push(rel);
  }
  return out;
}

// 루트의 기동 파일과 설정(10단계에서 .ts 가 된다)
const isRootIndex = (rel) => rel === "index.js" || rel === "index.ts";
const isRootConfig = (rel) => rel === "config.js" || rel === "config.ts";

function layerOf(rel) {
  if (isRootIndex(rel)) return "app";
  if (isRootConfig(rel)) return "config";
  if (/^(commands|events|dashboard\/server)\//.test(rel)) return "입구";
  const m = /^src\/([^/]+)\//.exec(rel);
  return m ? m[1] : null;
}

function resolveSpec(fromRel, spec) {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const base = posix(path.join(path.dirname(fromRel), spec));
  for (const cand of [base, `${base}.js`, `${base}.ts`, `${base}/index.js`, `${base}/index.ts`]) {
    if (fs.existsSync(path.join(ROOT, cand)) && fs.statSync(path.join(ROOT, cand)).isFile()) return cand;
  }
  return null;
}

const isRequire = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require";
const isRequireResolve = (n) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "require" && n.expression.name.text === "resolve";
const isDynamicImport = (n) => ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword;
const literalArg = (n) => (n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) ? n.arguments[0].text : null);

// 타입만 가져오기 · 내보내기(실행 때 지워진다)
const typeOnly = (n) => (ts.isImportDeclaration(n) && !!n.importClause?.isTypeOnly) || (ts.isExportDeclaration(n) && n.isTypeOnly);

// 속성 접근 사슬의 맨 앞 이름(a.b.c → a)
function rootName(n) {
  while (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) n = n.expression;
  return ts.isIdentifier(n) ? n.text : null;
}

function parse(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, false, rel.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  return { sf, line };
}

// 봇 코드 한 파일: 부름 · 지연 부름 · 글자가 아닌 부름 · config 꺼내 두기
function scanSource(rel) {
  const { sf, line } = parse(rel);
  const deps = [];
  const unseen = [];
  let lazy = 0;
  const configNames = new Set();
  const captures = [];

  const addDep = (spec, n, inFn) => {
    const to = resolveSpec(rel, spec);
    if (to) deps.push({ to, line: line(n), lazy: inFn });
  };

  // config.js 를 받은 이름(맨 위의 const x = require("…/config") · import x from "…/config.js"). 이름으로 꺼낸 것은 그 자체가 꺼내 두기다
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && !typeOnly(s) && ts.isStringLiteral(s.moduleSpecifier) && isRootConfig(resolveSpec(rel, s.moduleSpecifier.text) ?? "")) {
      const clause = s.importClause;
      if (clause?.name) configNames.add(clause.name.text);
      const named = clause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) configNames.add(named.name.text);
      else if (named) captures.push(line(s));
      continue;
    }
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      if (d.initializer && isRequire(d.initializer) && isRootConfig(resolveSpec(rel, literalArg(d.initializer) ?? "") ?? "")) {
        if (ts.isIdentifier(d.name)) configNames.add(d.name.text);
        else captures.push(line(d));
      }
    }
  }

  const visit = (n, inFn) => {
    if (ts.isFunctionLike(n)) inFn = true;
    if (ts.isPropertyDeclaration(n) && !n.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) inFn = true;

    if (isRequire(n) || isDynamicImport(n)) {
      const spec = literalArg(n);
      if (spec !== null) {
        if (inFn) lazy++;
        addDep(spec, n, inFn);
      } else unseen.push(`${rel}:${line(n)}`);
    } else if (isRequireResolve(n)) {
      const spec = literalArg(n);
      if (spec !== null) addDep(spec, n, inFn);
    } else if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && !typeOnly(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      addDep(n.moduleSpecifier.text, n, false);
    }

    if (!inFn && configNames.size) {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && configNames.has(n.expression.text)) captures.push(line(n));
      // const { a } = config 만. const { a } = config.x 는 위의 속성 접근으로 이미 센다
      if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && ts.isIdentifier(n.initializer) && configNames.has(n.initializer.text)) captures.push(line(n));
    }
    ts.forEachChild(n, (c) => visit(c, inFn));
  };
  visit(sf, false);
  return { rel, layer: layerOf(rel), deps, unseen, lazy, captures };
}

// 테스트 한 파일: require.cache · 메서드 바꿔 끼우기
function scanTest(rel) {
  const { sf, line } = parse(rel);
  let requireCache = 0;
  const swaps = [];
  const project = new Set(); // 프로젝트 모듈에서 온 이름

  const fromProject = (e) => {
    if (!e) return false;
    // (await import("./x")).default · await import("./x")
    while (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e)) e = e.expression;
    if (isRequire(e) || isDynamicImport(e)) return (literalArg(e) ?? "").startsWith(".");
    const r = ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) ? e.expression : null;
    if (r && (isRequire(r) || ts.isPropertyAccessExpression(r) || ts.isParenthesizedExpression(r))) return fromProject(r);
    return project.has(rootName(e) ?? "");
  };
  const bind = (name, init) => {
    if (!fromProject(init)) return;
    if (ts.isIdentifier(name)) project.add(name.text);
    else if (ts.isObjectBindingPattern(name)) for (const el of name.elements) if (ts.isIdentifier(el.name)) project.add(el.name.text);
  };

  // 이름부터 모은다(before() 안에서 받는 것까지). import 로 받은 이름도
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith(".")) continue;
    const clause = st.importClause;
    if (clause?.name) project.add(clause.name.text);
    const named = clause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) project.add(named.name.text);
    else if (named) for (const el of named.elements) project.add(el.name.text);
  }
  const collect = (n) => {
    if (ts.isVariableDeclaration(n)) bind(n.name, n.initializer);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) bind(n.left, n.right);
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "require" && n.name.text === "cache") requireCache++;
    const isFn = (e) => e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e));
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && isFn(n.right) && project.has(rootName(n.left) ?? "")) swaps.push(line(n));
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "method" && /(^|\.)mock$/.test(n.expression.expression.getText(sf)) && project.has(rootName(n.arguments[0] ?? n) ?? "")) swaps.push(line(n));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { rel, requireCache, swaps };
}

// 순환: 강하게 이어진 덩어리(Tarjan) 안의 선
function cycleEdges(graph) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const comp = new Map();
  const strong = (v) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.set(w, v);
      } while (w !== v);
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) strong(v);
  const edges = [];
  for (const [v, ws] of graph) for (const w of ws) if (comp.get(v) === comp.get(w)) edges.push(`${v} -> ${w}`);
  return edges.sort();
}

function scan() {
  const sources = [...walk("src"), ...walk("commands"), ...walk("events"), ...walk("dashboard/server"), ...["index.js", "index.ts", "config.js", "config.ts"].filter((f) => fs.existsSync(path.join(ROOT, f)))].map(scanSource);
  const tests = walk("test").map(scanTest);

  const direction = [];
  const graph = new Map();
  for (const f of sources) {
    const targets = new Set();
    for (const d of f.deps) {
      targets.add(d.to);
      // 루트 config.js 는 어느 층이든 읽는 환경이라 방향에서 뺀다. 순환에는 넣는다
      if (isRootConfig(d.to)) continue;
      const from = LAYERS.indexOf(f.layer);
      const to = LAYERS.indexOf(layerOf(d.to));
      if (from >= 0 && to >= 0 && from > to) direction.push(`${f.rel} -> ${d.to}`);
    }
    graph.set(f.rel, targets);
  }

  const perFile = (list, pick) => Object.fromEntries(list.map((f) => [f.rel, pick(f)]).filter(([, n]) => n > 0));
  return {
    files: sources.length,
    unknownLayer: sources.filter((f) => !LAYERS.includes(f.layer)).map((f) => f.rel),
    unseen: sources.flatMap((f) => f.unseen),
    direction: [...new Set(direction)].sort(),
    cycles: cycleEdges(graph),
    lazyRequire: perFile(sources, (f) => f.lazy),
    configCapture: perFile(sources, (f) => f.captures.length),
    requireCache: perFile(tests, (f) => f.requireCache),
    methodSwap: tests.filter((f) => f.swaps.length).map((f) => f.rel),
  };
}

const exported = { scan, LAYERS, layerOf };
export default exported;
export { exported as "module.exports" };

if (import.meta.main) {
  const r = scan();
  const total = (o) => Object.values(o).reduce((s, n) => s + n, 0);
  console.log(`파일 ${r.files} · 층 모름 ${r.unknownLayer.length} · 글자가 아닌 부름 ${r.unseen.length}`);
  console.log(`방향 위반 ${r.direction.length} · 순환 선 ${r.cycles.length}`);
  console.log(`지연 부름 ${total(r.lazyRequire)}(${Object.keys(r.lazyRequire).length}개 파일) · config 꺼내 두기 ${total(r.configCapture)}(${Object.keys(r.configCapture).length}개 파일)`);
  console.log(`require.cache ${total(r.requireCache)}(${Object.keys(r.requireCache).length}개 파일) · 메서드 바꿔 끼우기 ${r.methodSwap.length}개 파일`);
  if (process.argv[2] === "--json") console.log(JSON.stringify(r, null, 2));
}
