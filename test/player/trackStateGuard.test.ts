// 현재곡·대기열·기록은 src/player/trackState.ts만 바꾼다. 다른 곳에서 직접 바꾸면 저장이 그 변화를 모른다.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const ROOT = path.join(import.meta.dirname, "..", "..");
const DIRS = ["src", "commands", "events", path.join("dashboard", "server")];
const OWNER = path.join("src", "player", "trackState.ts");

const FORBIDDEN = [/\.queue\s*=(?!=)/, /\.queue\.(push|unshift|splice|shift|pop|sort|reverse|fill|copyWithin)\(/, /\.queue\[[^\]]*\]\]?\s*=(?!=)/, /\.currentTrack\s*=(?!=)/, /\.previousTracks\s*=(?!=)/, /\.previousTracks\.(push|unshift|splice|shift|pop)\(/];

// 코드 파일. .ts 로 옮긴 폴더도 빠지면 안 된다(선언 파일은 코드가 아니다)
const isCode = (name: string) => /\.(js|ts)$/.test(name) && !name.endsWith(".d.ts");

function codeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...codeFiles(rel));
    else if (isCode(entry.name)) out.push(rel);
  }
  return out;
}

test("현재곡·대기열·기록을 trackState 밖에서 직접 바꾸지 않는다", () => {
  const roots = ["index.js", "index.ts"].filter((f) => fs.existsSync(path.join(ROOT, f)));
  const files = [...DIRS.flatMap(codeFiles), ...roots].filter((f) => f !== OWNER);
  assert.ok(files.length > 50, `검사 대상이 너무 적다 (${files.length}개)`);

  const hits: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((raw, i) => {
      const line = raw.replace(/(^|\s)\/\/.*$/, "");
      if (FORBIDDEN.some((re) => re.test(line))) hits.push(`${file}:${i + 1}  ${raw.trim()}`);
    });
  }
  assert.deepEqual(hits, [], "trackState의 함수를 쓸 것");
});
