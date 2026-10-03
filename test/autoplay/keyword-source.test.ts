// src/autoplay/sources/keyword.ts — 유튜브 검색 결과를 자동재생 후보로

import { test } from "node:test";
import assert from "node:assert/strict";
import { keyword } from "../../src/autoplay/sources/keyword.ts";
import type { GenreSource } from "../../src/config/genres.ts";
import { fake } from "../helpers/fake.ts";

test("제목 없는 곡 · 라이브 · 주소 없는 결과는 후보로 삼지 않는다", async () => {
  const source = fake<GenreSource>({ type: "keyword", keywords: ["아무거나"] });
  const search = async () => [
    { id: "1", audioUrl: "https://y/1", title: null },
    { id: "2", audioUrl: "https://y/2", title: "곡", duration: 200 },
    { id: "3", audioUrl: "https://y/3", title: "라이브", isLive: true },
    { id: "4", audioUrl: null, title: "주소 없음" },
  ];
  const candidates = await keyword(source, { search });
  assert.deepEqual(
    candidates.map((c) => c.title),
    ["곡"],
  );
});
