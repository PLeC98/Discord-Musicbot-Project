// src/ui/menu-fit.ts: 곡을 고르는 메뉴를 메시지 크기 상한 안에 맞춘다. 넘칠 때만 긴 설명 칸들을 고르게 줄이고, 길이와 이름은 지킨다

import { test } from "node:test";
import assert from "node:assert/strict";
import { ActionRowBuilder, StringSelectMenuBuilder, type StringSelectMenuOptionBuilder } from "discord.js";
import { clipBytes, fitMenu, type MenuEntry } from "../../src/ui/menu-fit.ts";
import { componentsBytes } from "../../src/ui/message-size.ts";

const build = (options: StringSelectMenuOptionBuilder[]) => new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("menu").addOptions(options));
const entryOf = (n: number, artist: string, requester = "요청자"): MenuEntry => ({
  label: `${n}. 제목 ${n}`,
  value: `entry:${n}`,
  parts: [
    { text: artist, cut: true },
    { text: "1:40", cut: false },
    { text: requester, cut: true },
  ],
});
const optionsOf = (row: ActionRowBuilder<StringSelectMenuBuilder> | null) => row?.toJSON().components[0].options ?? [];

test("상한 안이면 설명을 그대로 둔다", () => {
  const row = fitMenu([entryOf(1, "가수")], { separator: " | ", budget: 10_000, build });
  assert.deepEqual(
    optionsOf(row).map((one) => one.description),
    ["가수 | 1:40 | 요청자"],
  );
});

test("넘치면 긴 칸들만 같은 수위까지 줄인다. 짧은 칸, 길이, 이름은 그대로", () => {
  const entries = [entryOf(1, "가".repeat(60)), entryOf(2, "나".repeat(40)), entryOf(3, "짧음")];
  const whole = componentsBytes(fitMenu(entries, { separator: " | ", budget: 10_000, build })!);
  const budget = whole - 150;
  const row = fitMenu(entries, { separator: " | ", budget, build });
  assert.ok(row && componentsBytes(row) <= budget, `${row && componentsBytes(row)}바이트`);
  const [first, second, third] = optionsOf(row).map((one) => one.description ?? "");
  const artistOf = (text: string) => text.split(" | ")[0];
  // 두 긴 아티스트가 같은 바이트 수위로 잘린다(한 글자 차이 이내)
  assert.ok(artistOf(first).endsWith("…") && artistOf(second).endsWith("…"), `${first} / ${second}`);
  assert.ok(Math.abs(Buffer.byteLength(artistOf(first)) - Buffer.byteLength(artistOf(second))) <= 3);
  assert.equal(third, "짧음 | 1:40 | 요청자");
  assert.ok(first.endsWith(" | 1:40 | 요청자") && second.endsWith(" | 1:40 | 요청자"));
  assert.deepEqual(
    optionsOf(row).map((one) => one.label),
    ["1. 제목 1", "2. 제목 2", "3. 제목 3"],
  );
});

test("설명을 다 줄여도 넘치면 뒤 항목부터 빼고(least까지), 그래도 넘치면 null", () => {
  const entries = Array.from({ length: 10 }, (_, i) => entryOf(i + 1, "가".repeat(30), "나".repeat(20)));
  const row = fitMenu(entries, { separator: " | ", budget: 600, build, least: 1 });
  const options = optionsOf(row);
  assert.ok(row && componentsBytes(row) <= 600);
  assert.ok(options.length > 0 && options.length < 10, `${options.length}개`);
  assert.deepEqual(
    options.map((one) => one.value),
    entries.slice(0, options.length).map((one) => one.value),
    "앞 항목부터 남긴다",
  );
  assert.equal(fitMenu(entries, { separator: " | ", budget: 600, build }), null, "least를 주지 않으면 항목을 빼지 않는다");
  assert.equal(fitMenu(entries, { separator: " | ", budget: 50, build, least: 1 }), null);
});

test("바이트 자르기: 글자 묶음을 가르지 않고 …까지 상한 안, 자리가 없으면 빈 문자열", () => {
  assert.equal(clipBytes("가나다", 9), "가나다");
  assert.equal(clipBytes("가나다라", 9), "가나…");
  assert.equal(clipBytes("🇰🇷🇰🇷", 11), "🇰🇷…");
  assert.equal(clipBytes("🇰🇷🇰🇷", 10), "");
  assert.equal(clipBytes("가나다라", 5), "");
  // JSON으로 이스케이프되는 글자는 이스케이프된 크기로 센다
  assert.equal(clipBytes('"""', 6), '"""');
  assert.equal(clipBytes('""""', 6), '"…');
});
