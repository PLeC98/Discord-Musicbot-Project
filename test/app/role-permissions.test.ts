// src/app/role-permissions.ts — 봇 역할에 초대 링크가 청하는 권한이 다 있는지

import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { missingPermissions } from "../../src/app/role-permissions.ts";
import { PERMISSIONS } from "../../src/rules/invite-url.ts";

test("봇 역할에 없는 권한의 이름. 다 있거나 관리자면 없다", () => {
  const without =
    (...bits: bigint[]) =>
    (bit: bigint) =>
      (PERMISSIONS & bit) === bit && !bits.includes(bit);
  assert.deepEqual(missingPermissions(without()), []);
  assert.deepEqual(missingPermissions(without(PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MuteMembers)), ["채널 관리", "멤버 음소거"]);
  assert.deepEqual(
    missingPermissions((bit) => bit === PermissionFlagsBits.Administrator),
    [],
  );
});
