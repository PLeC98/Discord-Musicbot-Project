// src/ui/palette.ts의 DASHBOARD_COLORS: /system 이미지가 쓰는 고정 색이 화면 CSS의 어두운 테마 값과 같은지

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROJECT } from "../../src/infra/project-paths.ts";
import { DASHBOARD_COLORS } from "../../src/ui/palette.ts";

// 어두운 테마 값은 밝은 테마([data-theme="light"])가 아닌 :root 블록에 있다
function darkValue(css: string, name: string) {
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const found = blocks.map((body) => body.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()).filter(Boolean);
  assert.equal(found.length, 1, `--${name} 의 :root 값이 하나여야 한다`);
  return found[0];
}

test("주의 노랑, 저장공간 색이 style.css 의 어두운 테마 값과 같다", () => {
  const css = fs.readFileSync(path.join(PROJECT.root, "dashboard", "src", "style.css"), "utf8");
  assert.equal(darkValue(css, "warn-ink"), DASHBOARD_COLORS.warnInk);
  assert.equal(darkValue(css, "store-cache"), DASHBOARD_COLORS.storeCache);
  assert.equal(darkValue(css, "store-other"), DASHBOARD_COLORS.storeOther);
});
