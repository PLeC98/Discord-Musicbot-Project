// 곡을 고르는 메뉴(재생 패널의 곡으로 건너뛰기, /queue 편집)를 메시지 크기 상한(ui/message-size) 안에 맞춘다.
// 항목 설명은 칸(아티스트, 길이, 요청자)으로 받아, 넘칠 때만 줄일 수 있는 칸들을 같은 수위까지 줄인다(rules/water-level).
// 짧은 칸은 그대로, 긴 칸들만 고르게 짧아진다. 길이 칸과 항목 이름은 줄이지 않는다. 그래도 넘치면 뒤 항목부터 뺀다(뺄 수 있을 때만)

import { ActionRowBuilder, StringSelectMenuOptionBuilder, type StringSelectMenuBuilder } from "discord.js";
import { clipText, ELLIPSIS, GRAPHEMES } from "../rules/clip-text.ts";
import { waterLevel } from "../rules/water-level.ts";
import { componentsBytes } from "./message-size.ts";

/** 메뉴 항목 이름, 설명의 상한(UTF-16 글자). 넘으면 디스코드가 메뉴째 거부한다 */
const OPTION_MAX = 100;
/** 넘칠 때 같은 항목 수로 다시 줄여 보는 횟수. 한 번에 거의 맞고, 글자 묶음 단위로 자르며 생긴 오차를 바로잡는다 */
const ROUNDS = 4;

/** 설명의 한 칸. cut이 false인 칸(길이)은 줄이지 않는다 */
type Part = { text: string; cut: boolean };
/** 메뉴 항목. label은 화면 폭으로 이미 자른 이름 */
type MenuEntry = { label: string; value: string; parts: Part[]; picked?: boolean };
type Build = (options: StringSelectMenuOptionBuilder[]) => ActionRowBuilder<StringSelectMenuBuilder>;

/** JSON 문자열 안에서 차지하는 바이트(따옴표 제외). 컴포넌트 크기는 JSON으로 잰다 */
const jsonBytes = (text: string) => Buffer.byteLength(JSON.stringify(text)) - 2;

/** JSON 바이트 max 안으로 글자 묶음 단위로 잘라 …를 붙인다. … 하나도 못 붙이면 빈 문자열 */
function clipBytes(text: string, max: number): string {
  if (jsonBytes(text) <= max) return text;
  const room = max - jsonBytes(ELLIPSIS);
  let out = "";
  let used = 0;
  for (const { segment } of GRAPHEMES.segment(text)) {
    const size = jsonBytes(segment);
    if (used + size > room) break;
    out += segment;
    used += size;
  }
  return out ? out + ELLIPSIS : "";
}

const joined = (parts: readonly Part[], separator: string) =>
  parts
    .map((part) => part.text)
    .filter(Boolean)
    .join(separator);

/** 합친 설명이 디스코드 상한(OPTION_MAX)을 넘으면 줄일 수 있는 칸들을 글자 수 기준 같은 수위까지 줄인 칸들 */
function fitParts(parts: readonly Part[], separator: string): Part[] {
  const length = joined(parts, separator).length;
  if (length <= OPTION_MAX) return [...parts];
  const level = waterLevel(
    parts.filter((part) => part.cut).map((part) => part.text.length),
    length - OPTION_MAX,
  );
  return parts.map((part) => (part.cut && part.text.length > level ? { ...part, text: level > 0 ? clipText(part.text, level) : "" } : part));
}

/** 칸들을 합친 설명(디스코드 상한 안). 내용이 없으면 undefined */
const descriptionOf = (parts: readonly Part[], separator: string) => clipText(joined(fitParts(parts, separator), separator), OPTION_MAX) || undefined;

const optionsOf = (entries: readonly MenuEntry[], separator: string) =>
  entries.map((entry) => {
    const option = new StringSelectMenuOptionBuilder().setLabel(clipText(entry.label, OPTION_MAX)).setValue(entry.value);
    const description = descriptionOf(entry.parts, separator);
    if (description) option.setDescription(description);
    if (entry.picked) option.setDefault(true);
    return option;
  });

/** 줄일 수 있는 칸들을 JSON 바이트 수위 level까지 줄인 항목들 */
const cutTo = (entries: readonly MenuEntry[], level: number) => entries.map((entry) => ({ ...entry, parts: entry.parts.map((part) => (part.cut ? { ...part, text: clipBytes(part.text, level) } : part)) }));

/** 항목 수 그대로 budget 안에 들도록 설명을 줄인 메뉴 줄. 줄일 칸을 다 비워도 넘치면 null */
function fitCount(entries: readonly MenuEntry[], separator: string, budget: number, build: Build) {
  // 디스코드 상한에 맞춘 칸에서 줄인다(원문 길이로 수위를 잡으면 상한에서 이미 잘린 몫까지 줄인 셈으로 쳐서 덜 줄인다)
  let shown = entries.map((entry) => ({ ...entry, parts: fitParts(entry.parts, separator) }));
  for (let round = 0; round < ROUNDS; round++) {
    const row = build(optionsOf(shown, separator));
    const over = componentsBytes(row) - budget;
    if (over <= 0) return row;
    const lengths = shown.flatMap((entry) => entry.parts.filter((part) => part.cut && part.text).map((part) => jsonBytes(part.text)));
    if (lengths.length === 0) return null;
    shown = cutTo(shown, waterLevel(lengths, over));
  }
  const row = build(optionsOf(shown, separator));
  return componentsBytes(row) <= budget ? row : null;
}

/**
 * entries로 만든 메뉴 줄을 컴포넌트 바이트 budget 안에 맞춘다. build는 항목들로 메뉴 줄을 만든다.
 * 설명을 다 줄여도 넘치면 뒤 항목부터 빼서 least개까지 줄여 본다. 항목 수를 지키는 쪽이 설명을 지키는 쪽보다 우선이다. 못 맞추면 null
 */
function fitMenu(entries: readonly MenuEntry[], { separator, budget, build, least = entries.length }: { separator: string; budget: number; build: Build; least?: number }) {
  for (let count = entries.length; count >= Math.max(1, least); count--) {
    const row = fitCount(entries.slice(0, count), separator, budget, build);
    if (row) return row;
  }
  return null;
}

export { OPTION_MAX, fitMenu, descriptionOf, clipBytes };
export type { Part, MenuEntry };
