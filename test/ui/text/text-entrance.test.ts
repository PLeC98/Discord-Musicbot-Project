// src/ui/text/: 봇 문구는 진입점(ui/text/index, ui/text/shared)으로만 부른다. 언어 폴더(ui/text/<언어>/)를 밖에서 직접 부르면 언어 선택을 건너뛴다.
// 모듈 맨 위에서 문구표를 꺼내 두는 것도 같은 까닭으로 막는다(글자는 같아도 그 자리는 늘 한 언어가 된다)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LANGUAGES } from "../../../src/rules/languages.ts";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
const posix = (p: string) => p.split(path.sep).join("/");
const LANGUAGE_DIRS = LANGUAGES.map((one) => one.tag);

/** 아직 언어를 받을 수 없어 기준 언어로 부르는 자리. 언어를 받게 되면 뺀다 */
const NOT_YET: ReadonlySet<string> = new Set([
  // 슬래시 명령 정의는 불러올 때 만들어 배포한다. 명령 문구를 언어마다 싣는 일과 함께 옮긴다
  "src/discord/commands/help.ts",
]);

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const child = posix(path.join(rel, entry.name));
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|vue)$/.test(entry.name)) out.push(child);
    }
  };
  walk(dir);
  return out;
}

// import, export ... from, import()의 경로(타입 import 포함)
const specifiersOf = (source: string) => [...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"';]*?from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1] ?? m[2]);

/** 그 파일이 부른 언어 폴더(src/ui/text/<언어>/) */
function languageDirsCalled(file: string): string[] {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  return specifiersOf(source)
    .filter((spec) => spec.startsWith("."))
    .map((spec) => posix(path.join(path.dirname(file), spec)))
    .filter((target) => LANGUAGE_DIRS.some((tag) => target.startsWith(`src/ui/text/${tag}/`)))
    .map((target) => target.split("/").slice(0, 4).join("/"));
}

/** 언어 폴더를 불러도 되는 파일: 같은 언어 폴더, 진입점, 그 언어의 문구표 테스트 */
function allowed(file: string, dir: string): boolean {
  const tag = dir.split("/")[3];
  if (file.startsWith(`${dir}/`)) return true;
  if (["src/ui/text/index.ts", "src/ui/text/shared.ts", "src/ui/text/contract.ts"].includes(file)) return true;
  // 그 언어의 문구표 테스트, 문구 번들 자체를 시험하는 테스트
  if (file.startsWith(`test/ui/text/${tag}/`) || /^test\/ui\/text\/[^/]+\.test\.ts$/.test(file)) return true;
  return NOT_YET.has(file);
}

test("언어 폴더는 진입점, 같은 언어 폴더, 그 언어의 문구표 테스트에서만 부른다", () => {
  const wrong = [...filesUnder("src"), ...filesUnder("dashboard/src"), ...filesUnder("test"), ...filesUnder("scripts")].flatMap((file) =>
    languageDirsCalled(file)
      .filter((dir) => !allowed(file, dir))
      .map((dir) => `${file} → ${dir}`),
  );
  assert.deepEqual([...new Set(wrong)], []);
});

test("허용 목록에 든 파일은 아직 언어 폴더를 부른다(옮겼으면 목록에서 뺀다)", () => {
  const stale = [...NOT_YET].filter((file) => !fs.existsSync(path.join(ROOT, file)) || languageDirsCalled(file).length === 0);
  assert.deepEqual(stale, []);
});

// 화면의 봇 문구(text.bot)는 화면 문구 진입점이 한 번 정한다
const TOP_ALLOWED: ReadonlySet<string> = new Set(["dashboard/src/text/index.ts"]);

test("모듈 맨 위에서 문구표를 꺼내 두지 않는다", () => {
  const TOP = /^(?:export\s+)?(?:const|let|var)\s+[^=]+=\s*(?:textFor|sharedTextFor|publicText|privateText|audienceText)\(/m;
  const wrong = [...filesUnder("src"), ...filesUnder("dashboard/src")].filter((file) => !TOP_ALLOWED.has(file) && TOP.test(fs.readFileSync(path.join(ROOT, file), "utf8")));
  assert.deepEqual(wrong, []);
});
