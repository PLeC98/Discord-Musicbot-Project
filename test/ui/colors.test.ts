// src/ui/palette.ts · colors.ts — 화면의 색은 경고 수준마다 하나. 색 값은 palette 표에만 적는다

import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../../src/config/index.ts";
import { colorOf } from "../../src/ui/colors.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");

test("경고 수준마다 디스코드 기본 팔레트의 색, 운영자 공지는 파랑. brand 는 운영자가 정한 색을 부를 때 읽는다", () => {
  assert.deepEqual((["error", "warning", "done", "notice"] as const).map(colorOf), ["#ED4245", "#FEE75C", "#57F287", "#3498DB"]);
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

test("봇 코드는 색 값을 그 자리에 적지 않는다(ui/colors 의 뜻 · ui/palette 로 고른다)", () => {
  // 운영 조절값 표는 임베드 색의 기본값을 적는 자리다
  const skip = [path.join(ROOT, "src", "rules", "tunables.ts")];
  const files = walk(path.join(ROOT, "src")).filter((f) => !skip.some((s) => f === s || f.startsWith(s)));
  const found = files.filter((f) => !f.endsWith(path.join("ui", "palette.ts"))).flatMap((f) => (fs.readFileSync(f, "utf8").match(/["'`]#[0-9A-Fa-f]{6}["'`]/g) ?? []).map((hex) => `${path.relative(ROOT, f)} ${hex}`));
  assert.deepEqual(found, []);
});
