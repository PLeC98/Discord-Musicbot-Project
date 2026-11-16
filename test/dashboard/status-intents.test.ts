// src/dashboard/status/intents.ts: 봇 상태 탭의 특권 인텐트(로그인한 것과 지금 앱 설정)

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import { fake } from "../helpers/fake.ts";
import { FLAGS, useLoggedIn, _resetIntents } from "../../src/infra/gateway-intents.ts";
import { intentStatus, forgetAppIntents, _resetIntentStatus, APP_FRESH_MS } from "../../src/dashboard/status/intents.ts";

afterEach(() => {
  _resetIntents();
  _resetIntentStatus();
});

function client(app: () => Promise<unknown>) {
  let reads = 0;
  const c = fake<Client>({ isReady: () => true, rest: { get: () => (reads++, app()) } });
  return { c, reads: () => reads };
}
const settle = () => new Promise((done) => setImmediate(done));

test("꺼진 채 로그인했는데 그사이 앱 설정에서 켜졌으면 다시 시작하면 적용(now 가 켜짐). 앱 설정은 백그라운드에서 읽어 잠깐 캐시한다", async () => {
  useLoggedIn({ messageContent: false, guildMembers: true });
  const { c, reads } = client(async () => ({ flags: FLAGS.messageContent.limited | FLAGS.guildMembers.limited, approximate_guild_count: 2 }));
  const first = intentStatus(c, 0);
  assert.deepEqual(first.messageContent, { loggedIn: false, now: null }, "처음에는 아직 모른다(기다리지 않는다)");
  await settle();
  assert.deepEqual(intentStatus(c, 1).messageContent, { loggedIn: false, now: true });
  assert.deepEqual(intentStatus(c, 2).guildMembers, { loggedIn: true, now: true });
  intentStatus(c, APP_FRESH_MS - 1);
  await settle();
  assert.equal(reads(), 1, "기억하는 동안 다시 읽지 않는다");
  forgetAppIntents();
  intentStatus(c, 3);
  await settle();
  assert.equal(reads(), 2, "켜기 뒤에는 다시 읽는다");
});

test("앱 설정 읽기가 실패해도(동기로 던져도) 상태를 만든다. 아는 것이 없으면 now 는 null", async () => {
  const c = fake<Client>({
    isReady: () => true,
    rest: {
      get: () => {
        throw new Error("rest 없음");
      },
    },
  });
  const status = intentStatus(c, 0);
  await settle();
  assert.deepEqual(status, { messageContent: { loggedIn: true, now: null }, guildMembers: { loggedIn: true, now: null }, approval: false });
});
