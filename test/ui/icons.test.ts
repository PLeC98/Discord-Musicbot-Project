import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ICONS, buttonEmoji, emojiName, icon, iconEntries, useUploaded } from "../../src/ui/icons.ts";

afterEach(() => useUploaded(new Map()));

test("맞추기 전에는 유니코드", () => {
  assert.equal(icon("pause"), "⏸️");
  assert.deepEqual(buttonEmoji("stop"), { name: "⏹️" });
});

test("맞춘 뒤에는 앱 이모지: 문장은 <:이름:id>, 움직이면 <a:…>, 버튼은 id · 이름 · 움직임", () => {
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

test("표의 기호가 모두 data/discord-icons 에 있다(빠지면 scripts/build-discord-icons.ts 를 다시 돌린다)", () => {
  const dir = path.join(import.meta.dirname, "..", "..", "data", "discord-icons");
  const { glyphs } = JSON.parse(fs.readFileSync(path.join(dir, "glyphs.json"), "utf8")) as { glyphs: Record<string, string> };
  for (const { glyph } of Object.values(ICONS)) assert.ok(glyph === "sponsorblock" || glyphs[glyph], glyph);
  assert.ok(fs.existsSync(path.join(dir, "skipIcon.svg")));
});
