// src/infra/text-fill.ts: 언어 번들에서 빠졌거나 종류가 다른 문구만 기준 언어의 것으로 채우고 그 경로를 알린다

import { test } from "node:test";
import assert from "node:assert/strict";
import { fillFrom } from "../../src/infra/text-fill.ts";

const base = {
  labels: { title: "제목", count: (n: number) => `${n}곡` },
  days: ["일", "월"],
  table: { a: () => "가", b: () => "나" },
  search: { make: () => "이름", read: (s: string) => s },
};

test("모양이 같으면 그대로 쓰고 빠진 것이 없다", () => {
  const given = { labels: { title: "Title", count: (n: number) => `${n} songs` }, days: ["Sun", "Mon"], table: { a: () => "A", b: () => "B" }, search: { make: () => "name", read: (s: string) => s } };
  const { value, missing } = fillFrom(base, given);
  assert.deepEqual(missing, []);
  assert.equal(value.labels.title, "Title");
  assert.equal(value.labels.count(2), "2 songs");
});

test("빠진 키, 종류가 다른 값, 표의 빠진 항목만 기준 언어로 채운다", () => {
  const given = { labels: { title: 3 }, days: "Sun", table: { a: () => "A" }, search: base.search };
  const { value, missing } = fillFrom(base, given);
  assert.deepEqual(missing.sort(), ["days", "labels.count", "labels.title", "table.b"]);
  assert.equal(value.labels.title, "제목");
  assert.equal(value.labels.count(2), "2곡");
  assert.deepEqual(value.days, ["일", "월"], "배열은 통째로 문구 하나");
  assert.equal(value.table.a(), "A");
  assert.equal(value.table.b(), "나");
});

test("whole에 든 경로는 하나라도 빠지면 통째로 기준 언어로 채운다(짝 함수가 갈리지 않게)", () => {
  const given = { ...base, search: { make: () => "name" } };
  const { value, missing } = fillFrom(base, given, new Set(["search"]));
  assert.deepEqual(missing, ["search.read"]);
  assert.equal(value.search.make(), "이름");
});

test("기준 언어에 없는 키는 버리고, 번들이 객체가 아니면 통째로 기준 언어", () => {
  const extra = fillFrom({ a: "가" }, { a: "A", b: "B" });
  assert.deepEqual(extra.value, { a: "A" });
  const broken = fillFrom(base, null);
  assert.equal(broken.value, base);
  assert.deepEqual(broken.missing, [""]);
});
