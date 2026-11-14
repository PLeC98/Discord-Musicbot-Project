// src/rules/guild-settings-values.ts: 서버 설정 화면이 주고받는 값의 같음

import test from "node:test";
import assert from "node:assert/strict";
import { sameValue } from "../../src/rules/guild-settings-values.ts";

test("역할, 구간은 순서와 중복을 보지 않는다", () => {
  assert.equal(sameValue("djRoleIds", ["a", "b"], ["b", "a", "a"]), true);
  assert.equal(sameValue("djRoleIds", ["a"], ["a", "b"]), false);
  assert.equal(sameValue("sponsorblock.categories", ["intro", "outro"], ["outro", "intro"]), true);
});

test("구간의 undefined(카드가 안 보임), null(운영자 기본을 따름), [](건너뛰지 않음)은 서로 다르다", () => {
  assert.equal(sameValue("sponsorblock.categories", null, []), false);
  assert.equal(sameValue("sponsorblock.categories", undefined, null), false);
  assert.equal(sameValue("sponsorblock.categories", [], []), true);
  assert.equal(sameValue("sponsorblock.categories", null, null), true);
});

test("그 밖의 키는 값 그대로 견준다", () => {
  assert.equal(sameValue("botChannelId", "c1", "c1"), true);
  assert.equal(sameValue("botChannelId", "c1", null), false);
  assert.equal(sameValue("playlistAddMax", null, null), true);
  assert.equal(sameValue("playlistAddMax", 50, null), false);
  assert.equal(sameValue("sponsorblock.enabled", true, false), false);
  assert.equal(sameValue("agePlace", "all", "all"), true);
});
