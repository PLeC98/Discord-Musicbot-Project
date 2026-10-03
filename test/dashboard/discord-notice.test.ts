// src/dashboard/discord-notice.ts — 대시보드에서 한 조작을 디스코드의 패널 채널에 알린다

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { announcer, dashboardActor, dashboardResponder } from "../../src/dashboard/discord-notice.ts";
import { LIFETIME } from "../../src/ui/delivery.ts";
import { frame } from "../../src/ui/frame.ts";
import type { Player } from "../../src/player/player.ts";
import { textsOf } from "../helpers/cv2.ts";
import { fake, fakeBot } from "../helpers/fake.ts";

type Sent = { components: Array<{ toJSON(): unknown }> };

// 패널 채널을 찾은 횟수와 보낸 것 · 지운 것을 적는 가짜
function world(found = true) {
  const sent: string[] = [];
  const deleted: string[] = [];
  let lookups = 0;
  const channel = {
    send: async (p: Sent) => {
      const text = textsOf(p).join("\n");
      sent.push(text);
      return { id: `m${sent.length}`, delete: async () => deleted.push(text) };
    },
  };
  const player = fake<Player>({ guild: { id: "g1" } });
  const bot = fakeBot({
    players: new Map([["g1", player]]),
    panels: {
      panelChannel: async () => {
        lookups++;
        return found ? channel : null;
      },
    },
  });
  return { bot, player, sent, deleted, lookups: () => lookups };
}

const settle = () => new Promise(setImmediate);

test("누가 했나: 로그인한 사람의 멘션 뒤에 (대시보드)", () => {
  assert.equal(dashboardActor(fake<Request>({ session: { user: { id: "u1" } } })), "<@u1> (대시보드)");
});

test("조작 안내: 패널 채널에 보내고 수명 뒤 지운다. 채널은 알리기 전에 찾아 둔다(정지 뒤에는 플레이어가 없다)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const w = world();
  const announce = announcer(w.bot, w.player);
  assert.equal(w.lookups(), 1, "만들 때 찾는다");
  announce(frame({ title: "결과" }), LIFETIME.farewell);
  await settle();
  assert.deepEqual(w.sent, ["### 결과"]);
  t.mock.timers.tick(LIFETIME.farewell - 1);
  await settle();
  assert.deepEqual(w.deleted, []);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(w.deleted, ["### 결과"]);
});

test("조작 안내: 플레이어나 패널 채널이 없으면 알리지 않는다", async () => {
  const none = world();
  announcer(none.bot, null)(frame({ title: "결과" }));
  const lost = world(false);
  announcer(lost.bot, lost.player)(frame({ title: "결과" }));
  await settle();
  assert.deepEqual([none.sent, none.lookups(), lost.sent], [[], 0, []]);
});

test("곡 넣기: 담은 안내를 그때의 패널 채널에 잠깐 보인다. 자리표시자는 없다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const w = world();
  const responder = dashboardResponder(w.bot, "g1");
  assert.equal(w.lookups(), 0, "곡을 넣기 전에는 찾지 않는다(글자 채널은 코어가 정한다)");
  await responder.notifyQueued(frame({ title: "담았어요" }));
  await responder.dismissPlaceholder();
  assert.deepEqual(w.sent, ["### 담았어요"]);
  t.mock.timers.tick(LIFETIME.glance);
  await settle();
  assert.deepEqual(w.deleted, ["### 담았어요"]);

  const empty = world();
  await dashboardResponder(empty.bot, "없는 서버").notifyQueued(frame({ title: "담았어요" }));
  assert.deepEqual(empty.sent, []);
});
