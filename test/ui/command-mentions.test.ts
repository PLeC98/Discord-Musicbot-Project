// src/ui/command-mentions.ts: 명령 멘션. 전역 등록은 어느 서버에서나, 한 서버 등록(GUILD_ID)은 그 서버에서만 id 를 쓰고, 나머지는 글자

import { test } from "node:test";
import assert from "node:assert/strict";
import { commandMention, rememberCommandIds } from "../../src/ui/command-mentions.ts";

test("전역 등록은 어느 서버에서나 멘션, 한 서버 등록은 그 서버에서만, 모르는 명령은 글자", () => {
  rememberCommandIds([{ name: "play", id: "11" }]);
  assert.equal(commandMention("play", "a"), "</play:11>");
  assert.equal(commandMention("play"), "</play:11>");
  assert.equal(commandMention("skip", "a"), "`/skip`");

  rememberCommandIds([{ name: "play", id: "22" }], "a");
  assert.equal(commandMention("play", "a"), "</play:22>");
  assert.equal(commandMention("play", "b"), "`/play`", "그 서버의 명령이 아니다");
  rememberCommandIds([]);
});
