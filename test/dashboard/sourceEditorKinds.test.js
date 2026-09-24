// SPEC 이 내는 칸 종류를 편집기가 다 그릴 수 있는가.
//
// 둘이 딴 파일에 있어서 한쪽만 고치면 그 칸이 조용히 일반 텍스트 입력으로 떨어진다.
// 값이 정해진 칸인데 자유 입력이 되면 오타가 저장되고 그 소스가 빈손이 된다.

import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { SPEC } from "../../src/autoplay/sources/index.ts";

const EDITOR = path.join(import.meta.dirname, "..", "..", "dashboard", "client", "src", "components", "SourceEditor.vue");

test("편집기가 SPEC 의 칸 종류를 전부 안다", () => {
  const src = fs.readFileSync(EDITOR, "utf8");
  const drawn = new Set([...src.matchAll(/field\.kind === '([a-zA-Z]+)'/g)].map((m) => m[1]));
  assert.ok(drawn.size > 3, `편집기에서 kind 를 못 읽었다 (찾은 것 ${drawn.size}개)`);

  const used = new Set();
  for (const spec of Object.values(SPEC)) for (const one of spec.fields || []) used.add(one.kind);

  // text·url 은 마지막 v-else 가 받는다. 그 둘만 예외다.
  const fallback = new Set(["text", "url"]);
  const missing = [...used].filter((kind) => !drawn.has(kind) && !fallback.has(kind));
  assert.deepEqual(missing, [], `편집기가 모르는 칸 종류: ${missing.join(", ")}`);
});

test("값이 정해진 칸은 선택지를 들고 있다", () => {
  const needsOptions = new Set(["enum", "enumList", "enumDrop", "enumSearch"]);
  for (const [type, spec] of Object.entries(SPEC)) {
    for (const one of spec.fields || []) {
      if (!needsOptions.has(one.kind)) continue;
      assert.ok(Array.isArray(one.options), `${type}.${one.key} 에 options 가 없다`);
    }
  }
});

test("구간 칸은 짝이 되는 칸을 가리킨다", () => {
  for (const [type, spec] of Object.entries(SPEC)) {
    for (const one of spec.fields || []) {
      if (one.kind !== "range") continue;
      assert.ok(one.to, `${type}.${one.key} 에 to 가 없다`);
      assert.ok(
        (spec.fields || []).every((other) => other.key !== one.to),
        `${type}.${one.to} 는 칸으로 따로 두면 안 된다 — 슬라이더가 둘을 같이 쓴다`,
      );
    }
  }
});
