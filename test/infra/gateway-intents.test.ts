// src/infra/gateway-intents.ts: 앱 설정의 flags 로 켜진 특권 인텐트, 이 프로세스가 로그인한 인텐트

import { test } from "node:test";
import assert from "node:assert/strict";
import { FLAGS, switchesOf, needsApproval, useLoggedIn, loggedInIntents, readsMessageContent, tracksMembers, _resetIntents } from "../../src/infra/gateway-intents.ts";

const { messageContent: mc, guildMembers: gm } = FLAGS;

test("100 서버 미만은 포털 스위치(_LIMITED)나 승인(FULL)이 켜져 있으면 켜짐", () => {
  assert.deepEqual(switchesOf({ flags: mc.limited | gm.limited, approximate_guild_count: 3 }), { messageContent: true, guildMembers: true });
  assert.deepEqual(switchesOf({ flags: mc.full, approximate_guild_count: 3 }), { messageContent: true, guildMembers: false });
  assert.deepEqual(switchesOf({ flags: 0, approximate_guild_count: 3 }), { messageContent: false, guildMembers: false });
  assert.deepEqual(switchesOf({ flags: 1 << 23 }), { messageContent: false, guildMembers: false }, "다른 비트는 보지 않는다");
});

test("100 서버 이상은 승인(FULL)만 켜짐으로 본다(포털 스위치가 켜져 있어도 게이트웨이가 거절한다)", () => {
  const app = { flags: mc.limited | gm.full, approximate_guild_count: 100 };
  assert.equal(needsApproval(app), true);
  assert.deepEqual(switchesOf(app), { messageContent: false, guildMembers: true });
});

test("flags 가 없거나 숫자가 아니면 모른다(null). 꺼짐이 아니다", () => {
  assert.equal(switchesOf(null), null);
  assert.equal(switchesOf({}), null);
  assert.equal(switchesOf({ flags: "262144" }), null);
  assert.equal(needsApproval({ flags: 0 }), false, "서버 수를 모르면 승인이 필요하다고 보지 않는다");
});

test("로그인한 인텐트: 처음은 둘 다 켜짐, 기동이 적은 값을 읽는다(사본)", (t) => {
  t.after(() => _resetIntents());
  assert.deepEqual(loggedInIntents(), { messageContent: true, guildMembers: true });
  const chosen = { messageContent: false, guildMembers: true };
  useLoggedIn(chosen);
  chosen.guildMembers = false;
  assert.equal(readsMessageContent(), false);
  assert.equal(tracksMembers(), true, "적은 뒤 바꿔도 따라가지 않는다");
});
