// 봇과 대시보드(브라우저)가 같이 쓰는 오류 · 거절 안내(src/ui/text/ko/errors.ts).
// 부르는 모듈을 따라가며 discord.js · Node 내장 모듈 · 바깥 패키지가 없는지, 문장에 디스코드에서만 읽히는 형식이 없는지 본다
// (공유 문장의 꾸밈은 굵게 · 코드 두 가지)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROBLEMS, type Code, type Params } from "../../../src/rules/problems.ts";
import { notice, noticeFor } from "../../../src/ui/text/ko/errors.ts";
import { DISCORD_LOOK } from "../../../src/ui/mentions.ts";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
const ENTRY = "src/ui/text/ko/errors.ts";

const posix = (p: string) => p.split(path.sep).join("/");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// 실행 때 남는 부름(import type 은 지워진다)
const specifiersOf = (source: string) => [...source.matchAll(/^\s*(?:import|export)(?!\s+type\b)[^"';]*?from\s+"([^"]+)"|^\s*import\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]);

function graph() {
  const seen = new Set<string>();
  const outside: Array<[string, string]> = [];
  const visit = (rel: string) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    for (const spec of specifiersOf(read(rel))) {
      if (!spec.startsWith(".")) outside.push([rel, spec]);
      else if (spec.endsWith(".ts")) visit(posix(path.join(path.dirname(rel), spec)));
    }
  };
  visit(ENTRY);
  return { seen, outside };
}

test("공유 안내가 부르는 모듈에는 discord.js · Node 내장 모듈 · 바깥 패키지가 없다", () => {
  const { seen, outside } = graph();
  assert.ok(seen.has("src/rules/josa.ts") && seen.has("src/rules/english-final.ts"), "따라가기가 조사 헬퍼까지 닿는다");
  assert.deepEqual(outside, []);
});

test("공유 문장에는 디스코드에서만 읽히는 형식(멘션 · 헤더 · 작은 글씨 · 링크 · 가림 · 취소선)이 없다", () => {
  const SAMPLE: Required<Params> = { max: 100, min: 1, queueCap: 50, size: 3, skipped: 7, durationMs: 185000, genre: "가요", keys: "Last.fm", channelId: "42", length: 2100, left: 2 };
  for (const [code, spec] of Object.entries(PROBLEMS) as Array<[Code, (typeof PROBLEMS)[Code]]>) {
    const params = Object.fromEntries(("params" in spec ? spec.params : []).map((name) => [name, SAMPLE[name]]));
    const { title, body = "" } = noticeFor(code, params);
    assert.doesNotMatch(`${title}\n${body}`, /<[#@:]|<t:|^#{1,3} |^-# |\]\(|\|\||~~/m, code);
  }
});

test("디스코드는 채널을 멘션으로 그린다", () => {
  assert.match(notice("only-in-bot-channel", { channelId: "42" }, DISCORD_LOOK).body ?? "", /<#42> 채널에서만/);
  assert.match(notice("only-in-bot-channel", { channelId: "42" }).body ?? "", /#42 채널에서만/);
});
