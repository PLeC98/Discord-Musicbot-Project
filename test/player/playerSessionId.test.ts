// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
import test from "node:test";
import assert from "node:assert/strict";
import { createPlayerSessionId } from "../../src/player/playerSessionId.ts";

test("creates compact URL-safe player session IDs", () => {
  const id = createPlayerSessionId();
  assert.match(id, /^[A-Za-z0-9_-]{24}$/);
});

test("does not repeat player session IDs across a sample", () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) {
    ids.add(createPlayerSessionId());
  }
  assert.equal(ids.size, 1000);
});
