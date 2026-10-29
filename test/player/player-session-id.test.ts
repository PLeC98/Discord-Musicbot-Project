// src/player/player-session-id.ts: 플레이어 세션 ID 의 형식(URL 에 그대로 쓰는 24자)과 겹치지 않음

import test from "node:test";
import assert from "node:assert/strict";
import { createPlayerSessionId } from "../../src/player/player-session-id.ts";

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
