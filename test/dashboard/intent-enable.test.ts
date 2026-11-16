// src/dashboard/intent-enable.ts: 운영자 패널에서 포털 스위치(_LIMITED)를 켠다. 보낼 값은 여기서 셈하고 켜기만 한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { FLAGS } from "../../src/infra/gateway-intents.ts";
import { enableIntent, flagsToEnable, type AppRest } from "../../src/dashboard/intent-enable.ts";

const BADGE = 1 << 23; // API 로 바꿀 수 없는 다른 비트(앱 명령 배지)

function rest(app: object, patch: (flags: number) => void = () => {}) {
  const sent: number[] = [];
  const r: AppRest = {
    get: async () => app,
    patch: async (_route, { body }) => {
      const { flags } = body as { flags: number };
      sent.push(flags);
      patch(flags);
      return app;
    },
  };
  return { r, sent };
}
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

test("보낼 값: 지금 flags 전부 + 켤 비트, 거절되면 바꿀 수 있는 비트(_LIMITED)만 + 켤 비트", () => {
  const current = BADGE | FLAGS.guildMembers.limited;
  assert.deepEqual(flagsToEnable(current, "messageContent"), [current | FLAGS.messageContent.limited, FLAGS.guildMembers.limited | FLAGS.messageContent.limited]);
});

test("꺼져 있으면 켠다. 첫 값이 받아지면 한 번만 보낸다", async () => {
  const { r, sent } = rest({ flags: BADGE, approximate_guild_count: 2 });
  assert.equal(await enableIntent(r, "messageContent"), "enabled");
  assert.deepEqual(sent, [BADGE | FLAGS.messageContent.limited]);
});

test("첫 값이 4xx 로 거절되면 _LIMITED 비트만 보낸다. 5xx 면 다시 보내지 않고 던진다", async () => {
  const refusedOnce = rest({ flags: BADGE, approximate_guild_count: 2 }, (flags) => {
    if (flags & BADGE) throw httpError(400);
  });
  assert.equal(await enableIntent(refusedOnce.r, "guildMembers"), "enabled");
  assert.deepEqual(refusedOnce.sent, [BADGE | FLAGS.guildMembers.limited, FLAGS.guildMembers.limited]);

  const down = rest({ flags: 0, approximate_guild_count: 2 }, () => {
    throw httpError(503);
  });
  await assert.rejects(enableIntent(down.r, "guildMembers"), /503/);
  assert.equal(down.sent.length, 1);
});

test("401, 403 처럼 값과 상관없는 거절은 다른 값으로 다시 보내지 않는다", async () => {
  const forbidden = rest({ flags: 0, approximate_guild_count: 2 }, () => {
    throw httpError(403);
  });
  await assert.rejects(enableIntent(forbidden.r, "messageContent"), /403/);
  assert.equal(forbidden.sent.length, 1);
});

test("바꾸기 직전에 확인(go)을 부르고, 던지면 보내지 않는다(그사이 세션이 끝났다)", async () => {
  const { r, sent } = rest({ flags: 0, approximate_guild_count: 2 });
  await assert.rejects(
    enableIntent(r, "messageContent", () => {
      throw new Error("세션 끝");
    }),
    /세션 끝/,
  );
  assert.deepEqual(sent, []);
});

test("겹친 켜기는 차례로 한다(읽고 고쳐 쓰기가 겹쳐 앞에서 켠 비트를 지우지 않게)", async () => {
  let flags = 0;
  const order: string[] = [];
  const r: AppRest = {
    get: async () => (order.push("get"), { flags, approximate_guild_count: 2 }),
    patch: async (_route, { body }) => {
      await new Promise((done) => setTimeout(done, 5));
      flags = (body as { flags: number }).flags;
      order.push("patch");
      return {};
    },
  };
  await Promise.all([enableIntent(r, "messageContent"), enableIntent(r, "guildMembers")]);
  assert.deepEqual(order, ["get", "patch", "get", "patch"]);
  assert.equal(flags, FLAGS.messageContent.limited + FLAGS.guildMembers.limited, "둘 다 켜져 있다");
});

test("flags 가 2^31 이상이어도 비트를 잃지 않는다(비트 연산은 32비트로 잘린다)", () => {
  const big = 2 ** 33 + BADGE;
  assert.deepEqual(flagsToEnable(big, "messageContent"), [big + FLAGS.messageContent.limited, FLAGS.messageContent.limited]);
});

test("이미 켜져 있거나, 100 서버 이상(승인 필요)이거나, flags 를 모르면 아무것도 보내지 않는다", async () => {
  for (const [app, expected] of [
    [{ flags: FLAGS.messageContent.limited, approximate_guild_count: 2 }, "already"],
    [{ flags: 0, approximate_guild_count: 120 }, "approval"],
    [{ approximate_guild_count: 2 }, "unknown"],
  ] as const) {
    const { r, sent } = rest(app);
    assert.equal(await enableIntent(r, "messageContent"), expected);
    assert.deepEqual(sent, [], expected);
  }
});
