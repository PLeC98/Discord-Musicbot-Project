import test from "node:test";
import assert from "node:assert/strict";
import createPlayerSessionId from "../../src/player/playerSessionId.js";

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
