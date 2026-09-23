"use strict";

// 곡 추가 코어(MusicEmbedManager._processMusic)의 흐름을 고정한다(구조 리팩터링 0-B).
//
// 6단계가 이것을 화면 모듈에서 usecases/addTracks 로 옮긴다. 첫 곡 재생 · 실패 · 다음 곡으로 되살리기 · 대기열 상한 · 넣을 자리 ·
// 안내를 적어 둔다. 대기열은 진짜 trackState 로 바뀌고, 플레이어의 연결 · 재생과 패널 만들기만 가짜다.

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const config = require("../../config");
const MusicEmbedManager = require("../../src/ui/nowPlayingPanel");

const track = (id, extra = {}) => ({ id, title: `곡 ${id}`, url: `https://youtu.be/${id}`, ...extra });
const who = { id: "u1", username: "사용자" };

// 연결 · 재생 결과를 시험마다 정하는 가짜 플레이어
function setup({ current = null, queue = [], plays = [{ success: true }], connected = false } = {}) {
  const calls = [];
  const sent = [];
  const player = {
    currentTrack: current,
    queue: [...queue],
    previousTracks: [],
    connection: connected ? {} : null,
    nowPlayingMessage: current ? {} : null,
    textChannel: {
      send: async (p) => {
        const m = { id: `info${sent.length}`, content: p.content, deleted: false, delete: async () => (m.deleted = true) };
        sent.push(m);
        return m;
      },
    },
    async connect() {
      calls.push("connect");
      this.connection = {};
    },
    async play(...args) {
      calls.push(["play", ...args]);
      const next = plays.shift() ?? { success: true };
      if (next instanceof Error) throw next;
      // 진짜 play() 는 현재 곡이 없으면 대기열에서 꺼낸다
      if (!this.currentTrack && this.queue.length) this.currentTrack = this.queue.shift();
      return next;
    },
  };
  const mem = new MusicEmbedManager({ players: new Map([["g1", player]]), user: { id: "bot" } });
  mem.createNewMusicEmbed = async (p, t) => {
    calls.push(["embed", t.id]);
    if (mem.embedFails) throw new Error("CV2 수정 제한");
    return { success: true, message: "Now playing", isNewEmbed: true };
  };
  mem.updateNowPlayingEmbed = async () => calls.push("update");
  const notices = [];
  const responder = { notifyQueued: async (text) => notices.push(text) };
  return { mem, player, calls, sent, notices, responder };
}

test("쉬고 있으면 첫 곡을 현재 곡으로 두고, 붙고, 틀고, 패널을 만든다. 요청자와 넣은 시각을 붙인다", async () => {
  const { mem, player, calls } = setup();
  const r = await mem.handleMusicData("g1", { tracks: [track("a")] }, who);

  assert.deepEqual(r, { success: true, message: "Now playing", isNewEmbed: true });
  assert.deepEqual(calls, ["connect", ["play"], ["embed", "a"]]);
  assert.equal(player.currentTrack.requestedBy, who);
  assert.equal(typeof player.currentTrack.addedAt, "number");
});

test("이미 붙어 있으면 연결하지 않는다", async () => {
  const { mem, calls } = setup({ connected: true });
  await mem.handleMusicData("g1", { tracks: [track("a")] }, who);
  assert.deepEqual(calls, [["play"], ["embed", "a"]]);
});

test("첫 곡이 실패하면(한 곡) 현재 곡을 비우고 실패를 돌려준다. 패널은 안 만든다", async () => {
  const withMessage = setup({ plays: [{ success: false, message: "스트림 실패" }] });
  assert.deepEqual(await withMessage.mem.handleMusicData("g1", { tracks: [track("a")] }, who), { success: false, message: "스트림 실패" });
  assert.equal(withMessage.player.currentTrack, null);
  assert.ok(!withMessage.calls.some((c) => c[0] === "embed"));

  const noMessage = setup({ plays: [{ success: false }] });
  assert.deepEqual(await noMessage.mem.handleMusicData("g1", { tracks: [track("a")] }, who), { success: false, message: "재생을 시작할 수 없습니다." });

  const thrown = setup({ plays: [new Error("fetch failed")] });
  const r = await thrown.mem.handleMusicData("g1", { tracks: [track("a")] }, who);
  assert.equal(r.success, false);
  assert.match(r.message, /네트워크 오류/, "던진 것은 ErrorHandler 안내문으로");
});

test("재생목록의 첫 곡이 실패하면 대기열의 다음 곡부터 틀어 되살린다", async () => {
  const { mem, player, calls, sent } = setup({ plays: [{ success: false, message: "첫 곡 실패" }, { success: true }] });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = await mem.handleMusicData("g1", { isPlaylist: true, collection: "playlist", tracks: [track("a"), track("b"), track("c")] }, who);

    assert.equal(r.success, true);
    assert.equal(player.currentTrack.id, "b", "실패한 곡은 대기열에 안 넣는다");
    assert.deepEqual(
      player.queue.map((t) => t.id),
      ["c"],
    );
    assert.deepEqual(calls.slice(-3), [["play", 0], ["embed", "b"], "update"]);
    assert.equal(sent[0].content, "✅ 재생목록의 2개 노래가 대기열에 추가되었습니다!");
    mock.timers.tick(10_000);
    await new Promise(setImmediate);
    assert.equal(sent[0].deleted, true, "안내는 10초 뒤 지운다");
  } finally {
    mock.timers.reset();
  }
});

test("되살리기도 실패하면 첫 곡의 실패를 돌려준다", async () => {
  const { mem } = setup({ plays: [{ success: false, message: "첫 곡 실패" }, { success: false }] });
  assert.deepEqual(await mem.handleMusicData("g1", { isPlaylist: true, tracks: [track("a"), track("b")] }, who), { success: false, message: "첫 곡 실패" });
});

test("패널을 못 만들어도 재생은 성공으로 친다", async () => {
  const { mem } = setup();
  mem.embedFails = true;
  assert.deepEqual(await mem.handleMusicData("g1", { tracks: [track("a")] }, who), { success: true, message: "Now playing", isNewEmbed: false });
});

test("틀고 있으면 대기열에 넣고 응답 매체로 알린다. 패널이 있으면 갱신한다", async () => {
  const { mem, player, calls, notices, responder } = setup({ current: track("now"), queue: [track("q1")] });
  const r = await mem.handleMusicData("g1", { tracks: [track("a")] }, who, responder);

  assert.deepEqual(r, { success: true, message: "Added to queue", isNewEmbed: false, dropped: 0, queueLimited: false });
  assert.deepEqual(
    player.queue.map((t) => t.id),
    ["q1", "a"],
  );
  assert.deepEqual(calls, ["update"]);
  assert.deepEqual(notices, ["✅ **곡 a**가 대기열에 추가되었습니다!"]);
});

test("넣을 자리: 맨 앞 · 특정 곡 뒤 · 기본은 자동재생이 뽑아 둔 곡 앞", async () => {
  const auto = track("auto", { autoplay: true });
  const front = setup({ current: track("now"), queue: [track("q1"), auto] });
  await front.mem.handleMusicData("g1", { insertFirst: true, tracks: [track("a")] }, who, front.responder);
  assert.deepEqual(
    front.player.queue.map((t) => t.id),
    ["a", "q1", "auto"],
  );
  assert.deepEqual(front.notices, ["⏫ **곡 a**가 대기열 맨 앞에 추가되었습니다!"]);

  const after = setup({ current: track("now"), queue: [track("q1"), track("q2")] });
  await after.mem.handleMusicData("g1", { insertAfterId: "q1", tracks: [track("a")] }, who, after.responder);
  assert.deepEqual(
    after.player.queue.map((t) => t.id),
    ["q1", "a", "q2"],
  );

  const normal = setup({ current: track("now"), queue: [track("q1"), auto] });
  await normal.mem.handleMusicData("g1", { tracks: [track("a")] }, who, normal.responder);
  assert.deepEqual(
    normal.player.queue.map((t) => t.id),
    ["q1", "a", "auto"],
  );
});

test("대기열 상한: 넘치는 곡은 빼고 몇 곡 뺐는지 알린다. 하나도 못 넣으면 가득 찼다고 실패", async () => {
  const saved = config.bot.maxQueueSize;
  config.bot.maxQueueSize = 2;
  try {
    const some = setup({ current: track("now"), queue: [track("q1")] });
    const r = await some.mem.handleMusicData("g1", { isPlaylist: true, collection: "album", total: 30, tracks: [track("a"), track("b")] }, who, some.responder);
    assert.equal(r.dropped, 1);
    assert.deepEqual(some.notices, ["✅ 앨범의 1개 노래가 대기열에 추가되었습니다! (전체 30곡)\n⚠️ 대기열이 가득 차 1곡은 넣지 못했습니다 (최대 2곡)"]);

    const full = setup({ current: track("now"), queue: [track("q1"), track("q2")] });
    assert.deepEqual(await full.mem.handleMusicData("g1", { tracks: [track("a")] }, who, full.responder), { success: false, message: "대기열이 가득 찼습니다 (최대 2곡)", dropped: 1 });
  } finally {
    config.bot.maxQueueSize = saved;
  }
});

test("자리가 모자라 덜 받았으면(queueLimited) 그렇다고 덧붙인다", () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  assert.equal(mem.createQueueAdditionMessage([track("a")], "재생목록", false, { queueLimited: true }), `✅ 재생목록의 1개 노래가 대기열에 추가되었습니다!\n⚠️ 대기열이 가득 차 목록의 일부만 넣었습니다 (최대 ${config.bot.maxQueueSize}곡)`);
});

test("플레이어가 없거나 처리 중 던지면 실패 문장", async () => {
  const mem = new MusicEmbedManager({ players: new Map() });
  assert.deepEqual(await mem.handleMusicData("g1", { tracks: [] }, who), { success: false, message: "음악 플레이어를 찾을 수 없습니다." });

  const { mem: m2 } = setup({ current: track("now") });
  assert.deepEqual(await m2.handleMusicData("g1", { tracks: null }, who), { success: false, message: "음악을 처리하는 중 오류가 발생했습니다." });
});

test("재생목록 안내는 텍스트 채널이 없으면(대시보드) 보내지 않는다", async () => {
  const { mem, player } = setup();
  player.textChannel = null;
  await mem.showPlaylistAdditionMessage(player, [track("a")], "재생목록");
});
