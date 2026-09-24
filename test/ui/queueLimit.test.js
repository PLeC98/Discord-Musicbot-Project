// 대기열 상한 — 추가 구간(MusicEmbedManager._processMusic)이 넘치는 곡을 빼고 몇 곡을 뺐는지 알린다.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import config from "../../config.ts";
import * as trackState from "../../src/player/trackState.ts";
import { MusicEmbedManager } from "../../src/ui/nowPlayingPanel.ts";

const realMax = config.bot.maxQueueSize;
afterEach(() => {
  config.bot.maxQueueSize = realMax;
});

const t = (title) => ({ title, url: `https://y/${title}` });
const titles = (arr) => arr.map((x) => x.title);
const many = (prefix, n) => Array.from({ length: n }, (_, i) => t(`${prefix}${i}`));

function setup({ max, queued = 0, playing = true }) {
  config.bot.maxQueueSize = max;
  const player = {
    textChannel: null,
    nowPlayingMessage: null,
    connection: {},
    async play() {
      return { success: true };
    },
  };
  trackState.init(player);
  if (playing) trackState.setCurrent(player, t("now"));
  trackState.enqueue(player, many("old", queued));

  const mem = new MusicEmbedManager({ players: new Map([["g", player]]) });
  mem.updateNowPlayingEmbed = async () => {};
  const notices = [];
  const responder = { notifyQueued: async (text) => notices.push(text), dismissPlaceholder: async () => {} };
  const add = (tracks, extra = {}) => mem._processMusic("g", { success: true, isPlaylist: tracks.length > 1, collection: "playlist", tracks, ...extra }, { id: "u1" }, responder);
  return { player, add, notices };
}

test("넘치는 곡은 빼고, 몇 곡을 뺐는지 결과와 안내에 싣는다", async () => {
  const { player, add, notices } = setup({ max: 30, queued: 25 });
  const result = await add(many("new", 10));

  assert.equal(result.success, true);
  assert.equal(result.dropped, 5);
  assert.equal(player.queue.length, 30);
  assert.deepEqual(titles(player.queue.slice(25)), ["new0", "new1", "new2", "new3", "new4"], "목록의 앞부분부터 들어간다");
  assert.match(notices[0], /5개 노래가 대기열에 추가/);
  assert.match(notices[0], /5곡은 넣지 못했습니다 \(최대 30곡\)/);
});

test("대기열이 가득 차 한 곡도 못 넣으면 실패로 돌려준다", async () => {
  const { player, add, notices } = setup({ max: 30, queued: 30 });
  const result = await add([t("x")]);

  assert.equal(result.success, false);
  assert.match(result.message, /대기열이 가득 찼습니다 \(최대 30곡\)/);
  assert.equal(player.queue.length, 30);
  assert.deepEqual(notices, [], "추가 안내는 보내지 않는다 — 진입점이 실패를 알린다");
});

test("맨 앞에 넣을 때도 새 목록의 앞부분이 들어간다", async () => {
  const { player, add } = setup({ max: 30, queued: 28 });
  const result = await add(many("new", 5), { insertFirst: true });

  assert.equal(result.dropped, 3);
  assert.deepEqual(titles(player.queue.slice(0, 3)), ["new0", "new1", "old0"]);
});

test("이어 넣기: 앵커 곡 뒤에 들어가고, 넘치면 역시 뒤쪽이 빠진다", async () => {
  const { player, add } = setup({ max: 30 });
  // 맨 앞에 넣었던 목록(p0, p1) 뒤에 기존 대기열이 있는 모양
  trackState.enqueue(player, [{ title: "p0", id: "p0" }, { title: "p1", id: "p1" }, ...many("old", 26)]);
  const result = await add(many("new", 5), { insertAfterId: "p1" });

  assert.equal(result.dropped, 3);
  assert.deepEqual(titles(player.queue.slice(0, 5)), ["p0", "p1", "new0", "new1", "old0"]);
});

test("현재곡은 세지 않는다 — 비어 있을 때 넣으면 첫 곡은 재생되고 대기열이 상한만큼 찬다", async () => {
  const { player, add } = setup({ max: 25, playing: false });
  const result = await add(many("new", 26));

  assert.equal(player.currentTrack.title, "new0");
  assert.equal(player.queue.length, 25);
  assert.equal(result.dropped, 0);
});

test("0이면 상한이 꺼진다", async () => {
  const { player, add, notices } = setup({ max: 0, queued: 300 });
  const result = await add(many("new", 50));

  assert.equal(result.dropped, 0);
  assert.equal(player.queue.length, 350);
  assert.doesNotMatch(notices[0], /넣지 못했습니다/);
});
