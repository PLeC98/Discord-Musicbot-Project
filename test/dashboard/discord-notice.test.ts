// src/dashboard/discord-notice.ts: 대시보드에서 한 조작을 디스코드의 패널 채널에 알린다

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { announcer, dashboardActor, dashboardResponder, restartNotices } from "../../src/dashboard/discord-notice.ts";
import { LIFETIME } from "../../src/ui/delivery.ts";
import { frame } from "../../src/ui/frame.ts";
import type { Player } from "../../src/player/player.ts";
import { textsOf } from "../helpers/cv2.ts";
import { fake, fakeBot } from "../helpers/fake.ts";

type Sent = { components: Array<{ toJSON(): unknown }> };

// 패널 채널을 찾은 횟수와 보낸 것, 삭제한 것을 적는 가짜
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

test("조작 안내: 패널 채널에 보내고 수명 뒤 삭제한다. 채널은 알리기 전에 찾아 둔다(정지 뒤에는 플레이어가 없다)", async (t) => {
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

test("곡 넣기: 추가 안내를 그때의 패널 채널에 잠깐 보인다. 자리표시자는 없다", async (t) => {
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

test("다시 시작 공지: 소리를 내는 서버만 패널 채널에 보내고 지우지 않는다. 채널이 없거나 보내지 못하면 false(거절하지 않는다)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent: string[] = [];
  const channel = (fails = false) => ({
    send: async (p: Sent) => {
      if (fails) throw new Error("권한 없음");
      sent.push(textsOf(p).join(" / "));
      return { id: "m1", delete: async () => assert.fail("다시 시작 공지는 지우지 않는다") };
    },
  });
  const sound = (paused = false) => ({ audioPlayer: { state: { status: "playing" } }, paused });
  const players = new Map([
    ["g1", fake<Player>({ guild: { id: "g1", name: "하나" }, ...sound(), textChannel: channel() })],
    ["g2", fake<Player>({ guild: { id: "g2", name: "둘" }, ...sound(true), textChannel: channel() })],
    ["g3", fake<Player>({ guild: { id: "g3", name: "셋" }, audioPlayer: { state: { status: "idle" } }, textChannel: channel() })],
    ["g4", fake<Player>({ guild: { id: "g4", name: "넷" }, ...sound(), textChannel: null })],
    ["g5", fake<Player>({ guild: { id: "g5", name: "다섯" }, ...sound(), textChannel: channel(true) })],
  ]);
  const bot = fakeBot({ players, panels: { panelChannel: async (player: Player) => player.textChannel } });
  assert.deepEqual(await Promise.all(restartNotices(bot)), [true, false, false], "재생 중인 셋(g1, g4, g5)만. 일시정지, 곡 없음은 보내지 않는다");
  assert.equal(sent.length, 1);
  assert.match(sent[0], /봇을 잠깐 다시 시작해요[^]*재생이 잠깐 끊겼다가 이어져요\./);
  t.mock.timers.tick(24 * 60 * 60 * 1000);
});
