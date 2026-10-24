// src/ui/shield-svg.ts — SponsorBlock 하이라이트 방패(원본 그대로 둔 파일)에서 경로만. 디스코드 앱 이모지와 대시보드가 같이 쓴다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { shieldOf } from "../../src/ui/shield-svg.ts";

test("원본에서 viewBox · 크기 · 경로 둘(바깥 테두리 · 안쪽 >>)만 꺼낸다. 편집기 속성 · 색은 따라오지 않는다", () => {
  const shield = shieldOf(fs.readFileSync(path.join(import.meta.dirname, "../../data/discord-icons/skipIcon.svg"), "utf8"));
  assert.equal(shield.viewBox, "0 0 565.15 568");
  assert.deepEqual([shield.width, shield.height], [565.15, 568]);
  assert.equal(shield.paths.length, 2);
  for (const d of shield.paths) assert.match(d, /^[mM][\d\s.,a-zA-Z-]+$/, "경로 글자만");
});
