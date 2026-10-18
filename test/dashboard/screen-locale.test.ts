// dashboard/src — 화면의 숫자 · 시각 · 날짜 · 상대 시각 · 정렬은 언어를 한 곳(utils/locale)에서 선택한다. 다국어를 추가할 때 그곳만 바꾸면 되게

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(import.meta.dirname, "..", "..", "dashboard", "src");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(vue|ts)$/.test(e.name) ? [path.join(dir, e.name)] : []));

// 언어를 선택하는 호출: toLocale…(…) · Intl 의 언어별 형식 · localeCompare
const LOCALE_CALL = /\.toLocale(?:String|DateString|TimeString)\(|new Intl\.(?:Collator|DateTimeFormat|NumberFormat|RelativeTimeFormat|PluralRules|ListFormat)\(|\.localeCompare\(/g;
// 디자인으로 영어 표기를 쓰는 곳(잠금 화면 결 · 터미널 결). 그 위치에서 "en-US" 를 적는다
const ENGLISH_BY_DESIGN = new Set(["views/LoginView.vue", "components/BotInfo.vue"]);

test("언어를 선택하는 호출은 utils/locale 에만(디자인으로 영어인 두 곳은 en-US 를 적는다)", () => {
  const stray: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (rel === "utils/locale.ts" || rel === "emoji-list.ts") continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      for (const m of line.matchAll(LOCALE_CALL)) {
        const english = ENGLISH_BY_DESIGN.has(rel) && line.slice(m.index).startsWith(`${m[0]}"en-US"`);
        if (!english) stray.push(`${rel}: ${line.trim().slice(0, 120)}`);
      }
    }
  }
  assert.deepEqual(stray, []);
});
