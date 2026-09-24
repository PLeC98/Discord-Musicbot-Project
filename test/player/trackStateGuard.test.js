// 현재곡·대기열·기록은 src/player/trackState.ts만 바꾼다. 다른 곳에서 직접 바꾸면 저장이 그 변화를 모른다.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const ROOT = path.join(import.meta.dirname, "..", "..");
const DIRS = ["src", "commands", "events", path.join("dashboard", "server")];
const OWNER = path.join("src", "player", "trackState.js");

const FORBIDDEN = [/\.queue\s*=(?!=)/, /\.queue\.(push|unshift|splice|shift|pop|sort|reverse|fill|copyWithin)\(/, /\.queue\[[^\]]*\]\]?\s*=(?!=)/, /\.currentTrack\s*=(?!=)/, /\.previousTracks\s*=(?!=)/, /\.previousTracks\.(push|unshift|splice|shift|pop)\(/];

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(rel));
    else if (entry.name.endsWith(".js")) out.push(rel);
  }
  return out;
}

test("현재곡·대기열·기록을 trackState 밖에서 직접 바꾸지 않는다", () => {
  const files = [...DIRS.flatMap(jsFiles), "index.js"].filter((f) => f !== OWNER);
  assert.ok(files.length > 50, `검사 대상이 너무 적다 (${files.length}개)`);

  const hits = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((raw, i) => {
      const line = raw.replace(/(^|\s)\/\/.*$/, "");
      if (FORBIDDEN.some((re) => re.test(line))) hits.push(`${file}:${i + 1}  ${raw.trim()}`);
    });
  }
  assert.deepEqual(hits, [], "trackState의 함수를 쓸 것");
});
