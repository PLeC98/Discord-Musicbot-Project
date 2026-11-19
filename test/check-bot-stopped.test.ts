// scripts/check-bot-stopped.ts: pnpm install의 첫 단계로 걸려 있고, 첫 설치(node_modules가 없음)에도 돌게 Node 기본 모듈만 불러온다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { PROJECT } from "../src/infra/project-paths.ts";

const SCRIPT = "scripts/check-bot-stopped.ts";

test("루트 preinstall 이 이 스크립트를 실행한다", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT.root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.preinstall, `node ${SCRIPT}`);
});

test("불러오는 파일을 따라가도 Node 기본 모듈과 저장소 파일뿐이다", () => {
  const seen = new Set<string>();
  const outside: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const [, spec] of text.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
      if (!spec) continue;
      if (spec.startsWith(".")) visit(path.resolve(path.dirname(file), spec));
      else if (!spec.startsWith("node:") && !builtinModules.includes(spec)) outside.push(`${path.relative(PROJECT.root, file)}: ${spec}`);
    }
  };
  visit(path.join(PROJECT.root, SCRIPT));
  assert.ok(seen.size >= 3, `따라간 파일이 너무 적다(${seen.size}개)`);
  assert.deepEqual(outside, []);
});
