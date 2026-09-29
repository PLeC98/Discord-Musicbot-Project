// src/ui/colors.ts — 화면의 색은 뜻마다 하나. 색 값은 이 표에만 적는다

import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../../config.ts";
import { colorOf } from "../../src/ui/colors.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");

test("뜻마다 디스코드 기본 팔레트의 색. brand 는 운영자가 정한 색을 부를 때 읽는다", () => {
  assert.deepEqual((["error", "done", "closed", "working", "settings"] as const).map(colorOf), ["#ED4245", "#57F287", "#99AAB5", "#FEE75C", "#5865F2"]);
  const saved = config.bot.embedColor;
  try {
    config.bot.embedColor = "#123456";
    assert.equal(colorOf("brand"), "#123456");
  } finally {
    config.bot.embedColor = saved;
  }
});

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

test("봇 코드는 색 값을 그 자리에 적지 않는다(ui/colors 의 뜻으로 고른다)", () => {
  const files = ["commands", "interactions", "events", "src"].flatMap((d) => walk(path.join(ROOT, d)));
  const found = files.filter((f) => !f.endsWith(path.join("ui", "colors.ts"))).flatMap((f) => (fs.readFileSync(f, "utf8").match(/["'`]#[0-9A-Fa-f]{6}["'`]/g) ?? []).map((hex) => `${path.relative(ROOT, f)} ${hex}`));
  assert.deepEqual(found, []);
});
