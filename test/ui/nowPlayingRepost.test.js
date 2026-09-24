// 현재 재생 임베드의 자가 복구 — 지워졌으면 다시 올리고, 전용 채널에서는 맨 아래에 둔다.
// 회귀 대상: 사용자가 임베드를 지우면 5초 갱신마다 10008(Unknown Message)을 error로 찍던 도배.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import MusicEmbedManager from "../../src/ui/nowPlayingPanel.js";
import tempStore from "../helpers/tempStore.ts";

import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const BOT_CHANNEL = "chan-1";

// 패널 채널을 정할 때 전용 채널을 묻는다. 임시 DB 에 두고, 기본은 "전용 채널 없음"
const store = tempStore.openTempStore("repost-");
after(() => store.close());
const gone = () => Object.assign(new Error("Unknown Message"), { code: 10008 });

// 웹훅으로 보내고 편집하는 실사용 경로. state로 호출 내역과 실패를 조종한다.
function makeSetup(state = {}) {
  const calls = { sent: [], edited: [], deleted: [] };
  let nextId = 200;

  const webhook = {
    async send() {
      if (state.sendError) throw state.sendError;
      if (state.onSend) await state.onSend();
      const message = { id: String(nextId++) };
      calls.sent.push(message.id);
      return message;
    },
    async editMessage(id) {
      calls.edited.push(id);
      if (state.editError) throw state.editError;
    },
    async deleteMessage(id) {
      calls.deleted.push(id);
    },
  };

  const mem = new MusicEmbedManager({
    players: new Map(),
    user: { username: "bot", displayName: "bot", displayAvatarURL: () => "https://example.org/a.png" },
  });
  mem.getOrCreateWebhook = async () => webhook;
  // 패널 자리 기록은 메모리로 — 실제 DB를 열지 않는다
  const records = new Map([["g1", { channelId: BOT_CHANNEL, messageId: "100" }]]);
  mem.panel.store = { getPanel: async (g) => records.get(g) ?? null, setPanel: async (g, channelId, messageId) => records.set(g, messageId ? { channelId, messageId } : null) };

  const player = {
    guild: { id: "g1" },
    sessionId: "s1",
    requesterId: "u1",
    queue: [],
    previousTracks: [],
    loop: false,
    paused: false,
    volume: 100,
    getCurrentTime: () => 1000,
    isPlaybackActive: () => true,
    getStatus: () => ({ playing: true, paused: false, volume: 100, loop: false }),
    currentTrack: { title: "곡", url: "https://example.org/a.mp3", duration: 100, platform: "direct" },
    nowPlayingMessage: { id: "100" },
    nowPlayingWebhook: webhook,
    textChannel: {
      id: BOT_CHANNEL,
      send: async () => ({ id: String(nextId++) }),
      messages: { cache: new Collection(), delete: async (id) => calls.deleted.push(id) },
    },
  };

  return { mem, player, calls, state };
}

test("지워진 임베드는 다시 올린다 — 같은 오류를 반복하지 않는다", async () => {
  const { mem, player, calls, state } = makeSetup({ editError: gone() });

  await mem.updateNowPlayingEmbed(player);

  assert.equal(calls.sent.length, 1, "새 메시지를 한 번 보낸다");
  assert.equal(player.nowPlayingMessage.id, calls.sent[0], "참조가 새 메시지로 바뀐다");
  assert.ok(calls.deleted.includes("100"), "지워진 옛 메시지도 정리를 시도한다");

  // 다음 갱신은 새 메시지를 편집한다 — 사라진 id로 계속 두드리지 않는다
  state.editError = null;
  await mem.updateNowPlayingEmbed(player);
  assert.deepEqual(calls.edited, ["100", calls.sent[0]]);
});

test("다시 올리는 중 들어온 갱신은 메시지를 겹쳐 올리지 않는다", async () => {
  let release;
  const blocked = new Promise((r) => (release = r));
  const { mem, player, calls } = makeSetup({ editError: gone(), onSend: () => blocked });

  const first = mem.updateNowPlayingEmbed(player);
  const second = mem.updateNowPlayingEmbed(player);
  release();
  await Promise.all([first, second]);

  assert.equal(calls.sent.length, 1, "동시 갱신이 있어도 새 메시지는 하나");
});

test("보내는 사이 재생이 끝나면 방금 올린 메시지를 도로 지운다", async () => {
  const { mem, player, calls } = makeSetup();

  // 전송이 끝나기 직전 handlePlaybackEnd가 참조를 비우는 상황
  mem._sendNowPlaying = async () => {
    player.nowPlayingMessage = null;
    player.currentTrack = null;
    return { message: { id: "999" }, webhook: player.nowPlayingWebhook };
  };

  await mem._repostNowPlaying(player, "테스트");

  assert.equal(player.nowPlayingMessage, null, "끝난 재생의 임베드를 되살리지 않는다");
  assert.ok(calls.deleted.includes("999"), "뒤늦게 올라간 메시지는 지운다");
});

test("다시 올리지 못하면 참조를 버리고 갱신을 멈춘다", async () => {
  const { mem, player } = makeSetup({ editError: gone(), sendError: new Error("Missing Permissions") });
  mem.updateIntervals.set(
    "g1",
    setInterval(() => {}, 60000),
  );

  await mem.updateNowPlayingEmbed(player);

  assert.equal(player.nowPlayingMessage, null);
  assert.equal(mem.updateIntervals.has("g1"), false, "5초 타이머도 멈춘다");
});

test("전용 채널에서 임베드가 묻혔는지 판정한다", async () => {
  const { mem, player } = makeSetup();
  tempStore.setGuild("g1", { botChannel: BOT_CHANNEL });
  const now = Date.now();
  const cache = player.textChannel.messages.cache;

  try {
    assert.equal(await mem._isBuried(player, now), false, "혼자면 맨 아래다");

    cache.set("50", { id: "50", createdTimestamp: now - 60000 });
    assert.equal(await mem._isBuried(player, now), false, "위쪽의 옛 메시지는 상관없다");

    cache.set("150", { id: "150", createdTimestamp: now - 3000 });
    assert.equal(await mem._isBuried(player, now), false, "곧 스스로 지워질 안내는 쫓지 않는다");

    cache.set("155", { id: "155", createdTimestamp: now - 20000 });
    require("../../src/ui/transientMessages").markTransient("155", 30000, now - 20000);
    assert.equal(await mem._isBuried(player, now), false, "오래 떠 있어도 스스로 지워질 메시지(더 넣기 메뉴)는 세지 않는다");

    cache.set("160", { id: "160", createdTimestamp: now - 30000 });
    assert.equal(await mem._isBuried(player, now), true, "남아 있는 새 메시지 밑이면 묻힌 것");

    player.textChannel.id = "other";
    assert.equal(await mem._isBuried(player, now), false, "전용 채널이 아니면 건드리지 않는다");
  } finally {
    tempStore.setGuild("g1", { botChannel: null });
  }
});
