// src/rules/palette.ts: 바탕색에서 색 역할 전부. 화면과 봇 이미지가 같이 쓴다

import { test } from "node:test";
import assert from "node:assert/strict";
import { Hct, argbFromHex } from "@material/material-color-utilities";
import { COLORLESS } from "../../src/rules/art-seed.ts";
import { DEFAULT_SEED, schemeColors } from "../../src/rules/palette.ts";

const chromaOf = (hex: string) => Hct.fromInt(argbFromHex(hex)).chroma;

test("색이 있는 바탕색은 Tonal Spot: 강조색에 색이 있고, 역할은 #rrggbb", () => {
  const c = schemeColors(DEFAULT_SEED, true);
  for (const role of ["primary", "on_surface", "surface_container", "surface_container_high", "outline", "outline_variant", "error", "primary_container", "on_primary_container", "error_container", "on_error_container"]) assert.match(c[role], /^#[0-9a-f]{6}$/, role);
  assert.ok(chromaOf(c.primary) > 20);
});

test("쓸 색이 없으면(COLORLESS, 무채색 임베드 색) 회색 체계", () => {
  for (const seed of [COLORLESS, argbFromHex("#000000"), argbFromHex("#808080"), argbFromHex("#ffffff")]) assert.ok(chromaOf(schemeColors(seed, true).primary) < 5, `seed=${seed}`);
});

test("어두운 테마와 밝은 테마는 surface 색이 다르다", () => {
  assert.notEqual(schemeColors(DEFAULT_SEED, true).surface, schemeColors(DEFAULT_SEED, false).surface);
});
