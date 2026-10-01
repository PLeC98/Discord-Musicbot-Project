// usecases/addTracks 의 곡 담기(queueTracks). 첫 곡 재생 · 실패 · 다음 곡으로 되살리기 · 대기열 상한 · 넣을 자리 · 안내를 본다.
// 대기열은 진짜 trackState 로 바뀌고, 플레이어의 연결 · 재생과 패널 만들기만 가짜다.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import config from "../../config.ts";
import { NowPlayingPanel } from "../../src/ui/nowPlayingPanel.ts";
import { queueTracks, type AddResult, type TrackData } from "../../src/usecases/addTracks.ts";
import type { Responder } from "../../src/ui/nowPlayingPanel.ts";
import type { Client } from "discord.js";
import type { Player } from "../../src/player/Player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";
import sink from "../../src/infra/log/sink.ts";
import { networkError } from "../helpers/errors.ts";
import { addFailureMessage } from "../../src/ui/errorMessages.ts";
import { plainText } from "../../src/ui/frame.ts";
import { codedError } from "../../src/rules/errorKind.ts";
import { textOf } from "../helpers/cv2.ts";
import { addedView } from "../../src/ui/addedNotice.ts";

// 실패 결과에 입구가 보일 문장을 붙여 본다
const said = (r: AddResult) => (r.success ? r : { ...r, message: plainText(addFailureMessage(r)) });

const track = (id: string, extra: Partial<QueuedTrack> = {}): QueuedTrack => ({ id, title: `곡 ${id}`, pageUrl: `https://youtu.be/${id}`, requestKey: `https://youtu.be/${id}`, platform: "youtube", duration: 0, ...extra });
const who = { id: "u1", username: "사용자" };

// 패널 만들기 · 갱신은 부른 것만 적는다. embedFails 면 만들기가 던진다
class RecordingPanels extends NowPlayingPanel {
  calls: unknown[];
  embedFails = false;

  constructor(client: Client, calls: unknown[]) {
    super(client);
    this.calls = calls;
  }
  async postPlaying(_player: Player, t: QueuedTrack) {
    this.calls.push(["embed", t.id]);
    if (this.embedFails) throw new Error("CV2 수정 제한");
    return { success: true as const };
  }
  async updatePlaying() {
    this.calls.push("update");
  }
}

// 글 채널에 보낸 안내. 지웠는지 본다
type Sent = { id: string; content: string; deleted: boolean; delete(): Promise<unknown> };
type Setup = { current?: QueuedTrack | null; queue?: QueuedTrack[]; plays?: Array<{ ok: boolean; code?: string } | Error>; connected?: boolean; connects?: boolean };

// 연결 · 재생 결과를 시험마다 정하는 가짜 플레이어
function setup({ current = null, queue = [], plays = [{ ok: true }], connected = false, connects = true }: Setup = {}) {
  const calls: unknown[] = [];
  const sent: Sent[] = [];
  const player = fakePlayer({
    currentTrack: current,
    queue: [...queue],
    previousTracks: [],
    connection: connected ? {} : null,
    nowPlayingMessage: current ? {} : null,
    textChannel: {
      send: async (p: unknown) => {
        const m: Sent = { id: `info${sent.length}`, content: textOf(p), deleted: false, delete: async () => (m.deleted = true) };
        sent.push(m);
        return m;
      },
    },
    voice: {
      connect: async () => {
        calls.push("connect");
        if (!connects) throw codedError("voice-failed", "음성 채널에 붙지 못했습니다");
        Object.assign(player, { connection: {} });
        return true;
      },
    },
    async play(...args: unknown[]) {
      calls.push(["play", ...args]);
      const next = plays.shift() ?? { ok: true };
      if (next instanceof Error) throw next;
      // 진짜 play() 는 현재 곡이 없으면 대기열에서 꺼낸다
      if (!this.currentTrack && this.queue.length) this.currentTrack = this.queue.shift() ?? null;
      return next;
    },
  });
  const client = fake<Client>({ players: new Map([["g1", player]]), user: { id: "bot" } });
  const mem = new RecordingPanels(client, calls);
  Object.assign(client, { panels: mem });
  const notices: string[] = [];
  const responder = { notifyQueued: async (view: unknown) => notices.push(textOf(view)), dismissPlaceholder: async () => {} };
  // 이 서버에 곡을 담는다
  const add = (data: TrackData, requester = who, via?: Responder) => queueTracks(client, "g1", data, requester, via);
  return { mem, add, player, calls, sent, notices, responder };
}

test("쉬고 있으면 첫 곡을 현재 곡으로 두고, 붙고, 틀고, 패널을 만든다. 요청자와 넣은 시각을 붙인다", async () => {
  const { add, player, calls } = setup();
  const r = await add({ tracks: [track("a")] }, who);

  assert.deepEqual(r, { success: true });
  assert.deepEqual(calls, ["connect", ["play"], ["embed", "a"]]);
  assert.equal(player.currentTrack?.requestedBy, who);
  assert.equal(typeof player.currentTrack?.addedAt, "number");
});

test("이미 붙어 있으면 연결하지 않는다", async () => {
  const { add, calls } = setup({ connected: true });
  await add({ tracks: [track("a")] }, who);
  assert.deepEqual(calls, [["play"], ["embed", "a"]]);
});

test("첫 곡이 실패하면(한 곡) 현재 곡을 비우고 실패를 돌려준다. 패널은 안 만든다", async () => {
  const withCode = setup({ plays: [{ ok: false, code: "live-ended" }] });
  assert.deepEqual(said(await withCode.add({ tracks: [track("a")] }, who)), { success: false, code: "live-ended", message: "재생을 시작할 수 없습니다." });
  assert.equal(withCode.player.currentTrack, null);
  assert.ok(!withCode.calls.some((c) => Array.isArray(c) && c[0] === "embed"));

  const noMessage = setup({ plays: [{ ok: false }] });
  const quiet = await noMessage.add({ tracks: [track("a")] }, who);
  assert.deepEqual(quiet, { success: false, code: "play-failed" });
  assert.equal(quiet.success ? "" : plainText(addFailureMessage(quiet)), "재생을 시작할 수 없습니다.");

  const thrown = setup({ plays: [networkError()] });
  const r = await thrown.add({ tracks: [track("a")] }, who);
  assert.equal(r.success, false);
  assert.match(r.success ? "" : plainText(addFailureMessage(r)), /네트워크 오류/, "던진 것은 그 오류의 문장으로");
  assert.deepEqual([r.success === false && r.code, r.success === false && r.kind], ["play-threw", "network"], "로그에는 까닭과 오류 종류");
});

test("쉬던 중 재생목록을 넣으면 곧바로 튼 첫 곡까지 세어 알린다", async () => {
  const { add, player, sent } = setup();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await add({ isPlaylist: true, collection: "playlist", tracks: [track("a"), track("b"), track("c")] }, who);

    assert.equal(player.currentTrack?.id, "a");
    assert.deepEqual(
      player.queue.map((t) => t.id),
      ["b", "c"],
    );
    assert.equal(sent[0].content, "✅ 재생목록의 3개 노래가 대기열에 추가되었습니다!", "받은 3곡 전부. 대기열 2곡만이 아니다");
  } finally {
    mock.timers.reset();
  }
});

test("재생목록의 첫 곡이 실패하면 대기열의 다음 곡부터 틀어 되살린다", async () => {
  const { add, player, calls, sent } = setup({ plays: [{ ok: false }, { ok: true }] });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = await add({ isPlaylist: true, collection: "playlist", tracks: [track("a"), track("b"), track("c")] }, who);

    assert.equal(r.success, true);
    assert.equal(player.currentTrack?.id, "b", "실패한 곡은 대기열에 안 넣는다");
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
  const { add } = setup({ plays: [{ ok: false, code: "live-ended" }, { ok: false }] });
  assert.deepEqual(said(await add({ isPlaylist: true, tracks: [track("a"), track("b")] }, who)), { success: false, code: "live-ended", message: "재생을 시작할 수 없습니다." });
});

test("음성 채널에 붙지 못하면 voice-failed. 틀지 않고, 재생목록이어도 다음 곡을 붙여 보지 않는다", async () => {
  const one = setup({ connects: false });
  assert.deepEqual(said(await one.add({ tracks: [track("a")] }, who)), { success: false, code: "voice-failed", message: "음성 채널에 연결하지 못했습니다!" });
  assert.equal(one.player.currentTrack, null);
  assert.deepEqual(one.calls, ["connect"]);

  const list = setup({ connects: false });
  assert.equal(said(await list.add({ isPlaylist: true, tracks: [track("a"), track("b")] }, who)).success, false);
  assert.deepEqual(list.calls, ["connect"]);
});

test("패널을 못 만들어도 재생은 성공으로 친다", async () => {
  const { mem, add } = setup();
  mem.embedFails = true;
  assert.deepEqual(await add({ tracks: [track("a")] }, who), { success: true });
});

test("틀고 있으면 대기열에 넣고 응답 매체로 알린다. 패널이 있으면 갱신한다", async () => {
  const { add, player, calls, notices, responder } = setup({ current: track("now"), queue: [track("q1")] });
  const r = await add({ tracks: [track("a")] }, who, responder);

  assert.deepEqual(r, { success: true, dropped: 0, queueLimited: false });
  assert.deepEqual(
    player.queue.map((t) => t.id),
    ["q1", "a"],
  );
  assert.deepEqual(calls, ["update"]);
  assert.deepEqual(notices, ["✅ **곡 a**이(가) 대기열에 추가되었습니다!"]);
});

test("넣을 자리: 맨 앞 · 특정 곡 뒤 · 기본은 자동재생이 뽑아 둔 곡 앞", async () => {
  const auto = track("auto", { autoplay: true });
  const front = setup({ current: track("now"), queue: [track("q1"), auto] });
  await front.add({ insertFirst: true, tracks: [track("a")] }, who, front.responder);
  assert.deepEqual(
    front.player.queue.map((t) => t.id),
    ["a", "q1", "auto"],
  );
  assert.deepEqual(front.notices, ["⏫ **곡 a**이(가) 대기열 맨 앞에 추가되었습니다!"]);

  const after = setup({ current: track("now"), queue: [track("q1"), track("q2")] });
  await after.add({ insertAfterId: "q1", tracks: [track("a")] }, who, after.responder);
  assert.deepEqual(
    after.player.queue.map((t) => t.id),
    ["q1", "a", "q2"],
  );

  const normal = setup({ current: track("now"), queue: [track("q1"), auto] });
  await normal.add({ tracks: [track("a")] }, who, normal.responder);
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
    const r = await some.add({ isPlaylist: true, collection: "album", total: 30, tracks: [track("a"), track("b")] }, who, some.responder);
    assert.equal(r.dropped, 1);
    assert.deepEqual(some.notices, ["✅ 앨범 전체 30곡 중 1곡이 대기열에 추가되었습니다!\n⚠️ 대기열이 가득 차 1곡은 넣지 못했습니다 (최대 2곡)"]);

    const full = setup({ current: track("now"), queue: [track("q1"), track("q2")] });
    assert.deepEqual(said(await full.add({ tracks: [track("a")] }, who, full.responder)), { success: false, code: "queue-full", message: "대기열이 가득 찼습니다 (최대 2곡)", dropped: 1 });
  } finally {
    config.bot.maxQueueSize = saved;
  }
});

test("자리가 모자라 덜 받았으면(queueLimited) 그렇다고 덧붙인다", () => {
  assert.equal(textOf(addedView({ tracks: [track("a")], collection: "playlist", notice: { queueLimited: true } })), `✅ 재생목록의 1개 노래가 대기열에 추가되었습니다!\n⚠️ 대기열이 가득 차 목록의 일부만 넣었습니다 (최대 ${config.bot.maxQueueSize}곡)`);
});

// 사운드클라우드 세트는 받을 수 없는 곡(미리듣기 · 지역 제한)을 빼고 넣는다. 조용히 빼지 않는다
test("출처가 받을 수 없어 뺀 곡(skipped)이 있으면 그렇다고 덧붙인다", async () => {
  assert.equal(textOf(addedView({ tracks: [track("a")], collection: "playlist", notice: { skipped: 3, total: 41 } })), "✅ 재생목록 전체 41곡 중 1곡이 대기열에 추가되었습니다!\n⚠️ 받을 수 없는 3곡(미리듣기 · 지역 제한 등)은 뺐습니다");

  const { add: live, notices, responder } = setup({ current: track("now") });
  await live({ tracks: [track("a"), track("b")], isPlaylist: true, collection: "playlist", skipped: 2 }, who, responder);
  assert.match(String(notices.at(-1)), /받을 수 없는 2곡/, "곡 찾기가 넘긴 수가 안내까지 간다");
});

test("플레이어가 없거나 처리 중 던지면 실패 문장", async () => {
  assert.deepEqual(said(await queueTracks(fake<Client>({ players: new Map() }), "g1", { tracks: [] }, who)), { success: false, code: "no-player", message: "음악 플레이어를 찾을 수 없습니다." });

  // 곡 목록이 없는 요청(처리 중 던진다)
  const { add: m2 } = setup({ current: track("now") });
  assert.deepEqual(await m2(fake<TrackData>({ tracks: null }), who), { success: false, code: "threw", kind: "unknown" });
});

test("재생목록 안내는 텍스트 채널이 없으면(대시보드) 보내지 않는다", async () => {
  const { mem, player, sent } = setup();
  const channel = player.textChannel;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    player.textChannel = null;
    const from = sink.buffer.length;
    await mem.showPlaylistAdditionMessage(player, [track("a")], "playlist");
    assert.deepEqual(sent, []);
    assert.deepEqual(sink.buffer.slice(from), [], "보내려다 실패한 것이 아니라 아예 보내지 않는다");

    // 대조: 채널이 있으면 보낸다
    player.textChannel = channel;
    await mem.showPlaylistAdditionMessage(player, [track("a")], "playlist");
    assert.equal(sent.length, 1);
  } finally {
    mock.timers.reset();
  }
});
