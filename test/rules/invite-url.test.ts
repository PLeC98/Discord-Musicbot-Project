// src/rules/invite-url.ts — 봇 초대 링크(/help · 대시보드 초대 화면이 같은 바탕)

import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { inviteUrl, FLAGS, PERMISSIONS } from "../../src/rules/invite-url.ts";

test("바탕: 권한 · 범위. 서버를 주면 그 서버를 미리 고르고 바꾸지 못하게", () => {
  assert.equal(inviteUrl("123"), `https://discord.com/oauth2/authorize?client_id=123&permissions=${PERMISSIONS}&scope=bot%20applications.commands`);
  assert.equal(inviteUrl("123", "456"), `https://discord.com/oauth2/authorize?client_id=123&permissions=${PERMISSIONS}&scope=bot%20applications.commands&guild_id=456&disable_guild_select=true`);
});

test("권한: 적은 비트가 discord.js 의 값과 같고, 관리자 · 멤버 옮기기는 청하지 않는다", () => {
  for (const [name, bit] of Object.entries(FLAGS)) assert.equal(bit, PermissionFlagsBits[name as keyof typeof PermissionFlagsBits], name);
  assert.equal(PERMISSIONS & PermissionFlagsBits.Administrator, 0n);
  assert.equal(PERMISSIONS & PermissionFlagsBits.MoveMembers, 0n);
  assert.equal(PERMISSIONS, 281750394760192n);
});
