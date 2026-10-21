// src/rules/invite-url.ts — 봇 초대 링크(/help · 대시보드 초대 화면이 같은 바탕)

import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteUrl } from "../../src/rules/invite-url.ts";

test("바탕: 권한 · 범위. 서버를 주면 그 서버를 미리 고르고 바꾸지 못하게", () => {
  assert.equal(inviteUrl("123"), "https://discord.com/oauth2/authorize?client_id=123&permissions=8&scope=bot%20applications.commands");
  assert.equal(inviteUrl("123", "456"), "https://discord.com/oauth2/authorize?client_id=123&permissions=8&scope=bot%20applications.commands&guild_id=456&disable_guild_select=true");
});
