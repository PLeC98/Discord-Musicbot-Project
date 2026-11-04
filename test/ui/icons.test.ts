// src/ui/icons.ts: 아이콘 표. 앱 이모지를 동기화하기 전에는 유니코드, 동기화한 뒤에는 앱 이모지

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ICONS, RETIRED_EMOJI_NAMES, buttonEmoji, emojiName, icon, iconEntries, isManagedEmojiName, useUploaded, type IconSpec } from "../../src/ui/icons.ts";

afterEach(() => useUploaded(new Map()));

test("맞추기 전에는 유니코드", () => {
  assert.equal(icon("pause"), "⏸️");
  assert.deepEqual(buttonEmoji("stop"), { name: "⏹️" });
});

test("맞춘 뒤에는 앱 이모지: 문장은 <:이름:id>, 움직이면 <a:…>, 버튼은 id, 이름, 움직임", () => {
  useUploaded(
    new Map([
      ["pause", { id: "1", animated: false }],
      ["progress", { id: "2", animated: true }],
      ["failed_error", { id: "3", animated: false }],
    ]),
  );
  assert.equal(icon("pause"), "<:pause:1>");
  assert.equal(icon("progress"), "<a:progress:2>");
  assert.deepEqual(buttonEmoji("progress"), { id: "2", name: "progress", animated: true });
  assert.equal(icon("failed", "error"), "<:failed_error:3>");
});

test("그려 두지 않은 바탕색을 물으면 그 키의 첫 바탕색으로", () => {
  useUploaded(new Map([["failed_error", { id: "3", animated: false }]]));
  assert.equal(icon("failed", "warning"), "<:failed_error:3>");
  assert.equal(icon("pause", "error"), "⏸️");
});

test("앱 이모지 이름은 2 ~ 32자 [A-Za-z0-9_] 이고 서로 겹치지 않는다", () => {
  const names = iconEntries().map((one) => one.name);
  for (const name of names) assert.match(name, /^[A-Za-z0-9_]{2,32}$/, name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(emojiName("autoplay", "warning"), "autoplay_warning");
});

test("낸 이름은 사라지지 않는다: 아이콘 표에서 빠진 이름은 옛 이름 표에 있다", () => {
  // 설정에 적힌 토큰(<:이름:id>)을 찾고 동기화가 옛 이모지를 지우려면 빠진 이름을 알아야 한다.
  // 새 아이콘을 더했으면 icon-names.json 에 이름을 더하고, 빼거나 이름을 바꿨으면 RETIRED_EMOJI_NAMES 에 더한다
  const shipped = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "icon-names.json"), "utf8")) as string[];
  const current = new Set(iconEntries().map((one) => one.name));
  assert.deepEqual(
    [...current].filter((name) => !shipped.includes(name)),
    [],
    "새 아이콘 이름을 test/ui/icon-names.json 에 더한다",
  );
  assert.deepEqual(
    shipped.filter((name) => !current.has(name) && !RETIRED_EMOJI_NAMES[name]),
    [],
    "빠진 이름을 RETIRED_EMOJI_NAMES 에 더한다",
  );
  assert.deepEqual(
    Object.keys(RETIRED_EMOJI_NAMES).filter((name) => current.has(name)),
    [],
    "옛 이름이 지금 이름과 겹친다",
  );
  for (const [name, to] of Object.entries(RETIRED_EMOJI_NAMES)) if ("renamed" in to) assert.ok(current.has(to.renamed), `${name} → ${to.renamed} 가 지금 표에 없다`);
});

test("관리하는 이름: 지금 이름, 옛 이름, 그 임시 이름(32자로 잘림)", () => {
  assert.ok(isManagedEmojiName("play"));
  assert.ok(isManagedEmojiName("voice"), "옛 이름");
  assert.ok(isManagedEmojiName("play_1"));
  assert.ok(isManagedEmojiName("announce_maintenance_warning".slice(0, 32 - 6) + "_12345"), "잘린 임시 이름");
  assert.ok(!isManagedEmojiName("party"));
  assert.ok(!isManagedEmojiName("party_1"));
  assert.ok(!isManagedEmojiName("autoplays"));
});

test("표의 기호가 모두 data/discord-icons 에 있다(빠지면 scripts/build-discord-icons.ts 를 다시 돌린다). 로고는 그 파일과 회사", () => {
  const dir = path.join(import.meta.dirname, "..", "..", "data", "discord-icons");
  const { glyphs } = JSON.parse(fs.readFileSync(path.join(dir, "glyphs.json"), "utf8")) as { glyphs: Record<string, string> };
  for (const spec of Object.values(ICONS) as IconSpec[]) {
    if (spec.shape === "logo") assert.ok(fs.existsSync(path.join(dir, spec.glyph)) && spec.brand, spec.glyph);
    else assert.ok(spec.glyph === "sponsorblock" || glyphs[spec.glyph], spec.glyph);
  }
  assert.ok(fs.existsSync(path.join(dir, "skipIcon.svg")));
});
