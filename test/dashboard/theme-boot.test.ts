// dashboard/public/theme-boot.js: 화면 스크립트보다 먼저 밝기 모드와 지난번 바탕색을 깐다. 기억이 없으면 style.css의 기본 바탕색이 보인다.
// 지키는 것: 저장 키가 theme.ts와 같다, CSS 기본값이 기본 색 씨앗의 바탕색과 같다, 망가진 값이나 막힌 저장소에서도 어둡게로 시작한다

import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SEED, schemeColors } from "../../src/rules/palette.ts";

const read = (rel: string) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const BOOT = read("dashboard/public/theme-boot.js");

type Stored = Record<string, string> | "blocked";
function boot(stored: Stored, systemDark = true) {
  const props: Record<string, string> = {};
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: "", setProperty: (name: string, value: string) => (props[name] = value) } };
  const localStorage = {
    getItem: (key: string) => {
      if (stored === "blocked") throw new Error("SecurityError");
      return stored[key] ?? null;
    },
  };
  vm.runInNewContext(BOOT, { document: { documentElement: root }, localStorage, matchMedia: () => ({ matches: systemDark }) });
  return { theme: root.dataset.theme, scheme: root.style.colorScheme, surface: props["--md-surface"] ?? null };
}

test("기억이 없으면 어둡게로 시작하고 바탕색은 CSS 기본값을 쓴다", () => {
  assert.deepEqual(boot({}), { theme: "dark", scheme: "dark", surface: null });
});

test("저장된 모드와 그 모드의 마지막 바탕색을 깐다(시스템은 브라우저 설정을 따른다)", () => {
  const surface = JSON.stringify({ dark: "#101010", light: "#fafafa" });
  assert.deepEqual(boot({ "theme:mode": "light", "theme:surface": surface }), { theme: "light", scheme: "light", surface: "#fafafa" });
  assert.deepEqual(boot({ "theme:mode": "system", "theme:surface": surface }, false), { theme: "light", scheme: "light", surface: "#fafafa" });
  assert.deepEqual(boot({ "theme:mode": "dark", "theme:surface": surface }), { theme: "dark", scheme: "dark", surface: "#101010" });
});

test("망가진 값이나 막힌 저장소에서도 어둡게로 시작한다", () => {
  assert.deepEqual(boot("blocked"), { theme: "dark", scheme: "dark", surface: null });
  assert.deepEqual(boot({ "theme:surface": "{망가짐" }), { theme: "dark", scheme: "dark", surface: null });
  assert.deepEqual(boot({ "theme:surface": "null" }), { theme: "dark", scheme: "dark", surface: null });
  assert.deepEqual(boot({ "theme:surface": JSON.stringify({ dark: "red; background: url(x)" }) }), { theme: "dark", scheme: "dark", surface: null }, "#RRGGBB만 받는다");
});

test("저장 키는 theme.ts와 같고, index.html이 화면 스크립트보다 먼저 부른다", () => {
  const theme = read("dashboard/src/theme/theme.ts");
  for (const key of ["theme:mode", "theme:surface"]) assert.ok(BOOT.includes(`"${key}"`) && theme.includes(`"${key}"`), key);
  const html = read("dashboard/index.html");
  assert.ok(html.indexOf('src="/theme-boot.js"') > 0 && html.indexOf('src="/theme-boot.js"') < html.indexOf('type="module"'));
});

test("style.css의 기본 바탕색은 기본 색 씨앗의 바탕색이다", () => {
  const css = read("dashboard/src/style.css");
  const dark = /:root \{[^}]*--md-surface: (#[0-9a-f]{6});/i.exec(css)?.[1];
  const light = /:root\[data-theme="light"\] \{[^}]*--md-surface: (#[0-9a-f]{6});/i.exec(css)?.[1];
  assert.deepEqual([dark, light], [schemeColors(DEFAULT_SEED, true).surface, schemeColors(DEFAULT_SEED, false).surface]);
});
