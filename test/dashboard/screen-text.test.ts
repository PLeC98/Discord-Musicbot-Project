// dashboard/src — 화면 문구는 문구표(text/) 한곳에 둔다. 다국어를 추가할 때 그곳만 옮기면 되게.
// 화면 파일의 글(템플릿의 글 · 속성 값 · 식, 스크립트의 문자열)에 한글이 있으면 걸린다. 주석은 보지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { parse } from "@vue/compiler-sfc";

const SRC = path.join(import.meta.dirname, "..", "..", "dashboard", "src");
const HANGUL = /[가-힣ㄱ-ㆎ]/;

// 문구가 아니라 한글을 다루는 자료(이모지 이름)
const NOT_TEXT = new Set(["emoji-list.ts"]);

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(vue|ts)$/.test(e.name) ? [path.join(dir, e.name)] : []));

/** 스크립트의 문자열 가운데 한글이 든 것 */
function scriptStrings(code: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && HANGUL.test(node.text)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return out;
}

type TemplateNode = { type: number; content?: unknown; props?: Array<{ type: number; value?: { content: string }; exp?: { content: string } }>; children?: TemplateNode[] };

/** 템플릿의 글 · 속성 값 · 식 가운데 한글이 든 것(주석 마디는 빼고) */
function templateStrings(node: TemplateNode): string[] {
  const out: string[] = [];
  if (node.type === 2 && typeof node.content === "string" && HANGUL.test(node.content)) out.push(node.content.trim());
  if (node.type === 5) out.push(...scriptStrings((node.content as { content: string }).content));
  for (const p of node.props ?? []) {
    if (p.type === 6 && p.value && HANGUL.test(p.value.content)) out.push(p.value.content);
    if (p.type === 7 && p.exp) out.push(...scriptStrings(p.exp.content));
  }
  for (const child of node.children ?? []) out.push(...templateStrings(child));
  return out;
}

function stringsOf(file: string): string[] {
  const code = fs.readFileSync(file, "utf8");
  if (!file.endsWith(".vue")) return scriptStrings(code);
  const { descriptor } = parse(code);
  return [...(descriptor.template ? templateStrings(descriptor.template.ast as unknown as TemplateNode) : []), ...scriptStrings(descriptor.scriptSetup?.content ?? ""), ...scriptStrings(descriptor.script?.content ?? "")];
}

test("화면 파일에 한글 문구가 없다(문구는 text/ 에)", () => {
  const found: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (rel.startsWith("text/") || NOT_TEXT.has(rel)) continue;
    for (const s of stringsOf(file)) found.push(`${rel}: ${s.slice(0, 60)}`);
  }
  assert.deepEqual(found, [], "문구표(text/)로 옮긴다");
});
