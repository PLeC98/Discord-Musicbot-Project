// src/usecases/add-tracks.ts: 곡 추가(queueTracks). 첫 곡 재생, 실패, 다음 곡으로 복구, 대기열 상한, 넣을 위치, 안내를 본다.
// 대기열은 진짜 trackState 로 바뀌고, 플레이어의 연결, 재생과 패널 만들기만 가짜다.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import config from "../../src/config/index.ts";
import { NowPlayingPanel } from "../../src/ui/now-playing-panel.ts";
import { queueTracks, type AddResult, type TrackData } from "../../src/usecases/add-tracks.ts";
import type { Responder } from "../../src/ui/now-playing-panel.ts";
import type { Client } from "discord.js";
import type { Player } from "../../src/player/player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer, fakeBot } from "../helpers/fake.ts";
import sink from "../../src/infra/log/sink.ts";
import { networkError } from "../helpers/errors.ts";
import { addFailureMessage } from "../../src/ui/error-messages.ts";
import { plainText } from "../helpers/notice.ts";
import { codedError } from "../../src/rules/error-kind.ts";
import { textOf } from "../helpers/cv2.ts";
import { addedView } from "../../src/ui/added-notice.ts";
import * as errors from "../../src/ui/text/ko/errors.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { sessions } from "../../src/store/player-sessions.ts";
import { SessionPersistence } from "../../src/player/session-mirror.ts";

// 실패 결과에 진입점이 보일 문장을 붙여 본다
const said = (r: AddResult) => (r.success ? r : { ...r, message: plainText(addFailureMessage(r)) });

const track = (id: string, extra: Partial<QueuedTrack> = {}): QueuedTrack => ({ id, title: `곡 ${id}`, pageUrl: `https://youtu.be/${id}`, requestKey: `https://youtu.be/${id}`, platform: "youtube", duration: 0, ...extra });
// 결과의 넣은 것(placed)을 첫 곡 id 로 줄여 비교한다
const withPlaced = (r: AddResult) => (r.success && r.placed ? { ...r, placed: { ...r.placed, first: r.placed.first?.id ?? null } } : r);
const ONE_STARTED = { count: 1, position: null, collection: null, total: null, skipped: 0, first: "a" };
const who = { id: "u1", username: "사용자" };

// 패널 만들기, 갱신은 부른 것만 적는다. embedFails 면 만들기가 던진다
class RecordingPanels extends NowPlayingPanel {
  calls: unknown[];
  embedFails = false;

  constructor(client: Client, players: Map<string, Player>, calls: unknown[]) {
    super(client, players);
    this.calls = calls;
  }
  override async postPlaying(_player: Player, t: QueuedTrack) {
    this.calls.push(["embed", t.id]);
    if (this.embedFails) throw new Error("CV2 수정 제한");
    return { success: true as const };
  }
  override async updatePlaying() {
    this.calls.push("update");
  }
}

// 글 채널에 보낸 안내. 삭제했는지 본다
type Sent = { id: string; content: string; deleted: boolean; delete(): Promise<unknown> };
type Setup = { current?: QueuedTrack | null; queue?: QueuedTrack[]; plays?: Array<{ ok: boolean; code?: string } | Error>; connected?: boolean; connects?: boolean | string };

// 연결, 재생 결과를 테스트마다 정하는 가짜 플레이어
function setup({ current = null, queue = [], plays = [{ ok: true }], connected = false, connects = true }: Setup = {}) {
  const calls: unknown[] = [];
  const sent: Sent[] = [];
  // 앞 플레이어가 남긴 세션을 넘겨받은 때마다 음성에 붙어 있었는지
  const takenOver: boolean[] = [];
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
        if (connects !== true) throw codedError(connects || "voice-failed", "음성 채널에 붙지 못했습니다");
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
    async finishQueue() {
      calls.push("finish");
    },
    takeOverSaved() {
      takenOver.push(Boolean(this.connection));
      return 0;
    },
    async dispose() {
      calls.push("dispose");
    },
  });
  const players = new Map<string, Player>([["g1", player]]);
  const mem = new RecordingPanels(fake<Client>({ user: { id: "bot" } }), players, calls);
  const bot = { players, panels: mem };
  const notices: string[] = [];
  const responder = { notifyQueued: async (view: unknown) => notices.push(textOf(view)), dismissPlaceholder: async () => {} };
  // 이 서버에 곡을 추가한다
  const add = (data: TrackData, requester = who, via?: Responder) => queueTracks(bot, "g1", data, requester, via);
  return { mem, add, player, calls, sent, notices, responder, takenOver };
}

test("쉬고 있으면 첫 곡을 현재 곡으로 두고, 붙고, 틀고, 패널을 만든다. 요청자와 넣은 시각을 붙인다", async () => {
  const { add, player, calls } = setup();
  const r = await add({ tracks: [track("a")] }, who);

  assert.deepEqual(withPlaced(r), { success: true, placed: ONE_STARTED }, "곧바로 튼 곡은 대기열 순번이 없다");
  assert.deepEqual(calls, ["connect", ["play"], ["embed", "a"]]);
  assert.equal(player.currentTrack?.requestedBy, who);
});

test("앞 플레이어가 남긴 세션은 음성에 붙은 뒤 첫 곡을 지정하기 전에 넘겨받는다. 붙지 못하면 넘겨받지 않는다(/join 으로 이어 듣게 남긴다)", async () => {
  const fresh = setup();
  await fresh.add({ tracks: [track("a")] }, who);
  assert.deepEqual(fresh.takenOver, [true]);

  const stranded = setup({ connects: false });
  await stranded.add({ tracks: [track("a"), track("b")] }, who);
  assert.deepEqual(stranded.takenOver, []);
  assert.equal(stranded.player.currentTrack, null, "곡도 지정하지 않았다");
});

test("이미 붙어 있으면 연결하지 않는다", async () => {
  const { add, calls } = setup({ connected: true });
  await add({ tracks: [track("a")] }, who);
  assert.deepEqual(calls, [["play"], ["embed", "a"]]);
});

test("첫 곡의 열기가 다른 재생(음성 복구)에 밀려나면 실패가 아니다. 곡을 지우지 않고 패널을 만든다", async () => {
  const { add, player, calls } = setup({ plays: [{ ok: false, code: "superseded" }] });
  const r = await add({ tracks: [track("a")] }, who);

  assert.deepEqual(withPlaced(r), { success: true, placed: ONE_STARTED });
  assert.equal(player.currentTrack?.title, "곡 a");
  assert.deepEqual(calls.at(-1), ["embed", "a"]);
});

test("첫 곡이 실패하면(한 곡) 현재 곡을 비우고 실패를 돌려준다. 패널은 안 만들고, 틀 곡이 없으니 대기열 소진으로 끝낸다(나갈 예약)", async () => {
  const withCode = setup({ plays: [{ ok: false, code: "live-ended" }] });
  assert.deepEqual(said(await withCode.add({ tracks: [track("a")] }, who)), { success: false, code: "live-ended", message: plainText(errors.notice("live-ended")) });
  assert.equal(withCode.player.currentTrack, null);
  assert.ok(!withCode.calls.some((c) => Array.isArray(c) && c[0] === "embed"));
  assert.equal(withCode.calls.at(-1), "finish");
  assert.equal(withCode.player.finishByCaller, false, "첫 곡을 트는 동안만 끝을 맡는다");

  const noMessage = setup({ plays: [{ ok: false }] });
  const quiet = await noMessage.add({ tracks: [track("a")] }, who);
  assert.deepEqual(quiet, { success: false, code: "play-failed" });
  assert.equal(quiet.success ? "" : plainText(addFailureMessage(quiet)), plainText(errors.notice("cannot-start")));

  const thrown = setup({ plays: [networkError()] });
  const r = await thrown.add({ tracks: [track("a")] }, who);
  assert.equal(r.success, false);
  assert.match(r.success ? "" : plainText(addFailureMessage(r)), /연결 오류가 발생했어요/, "던진 것은 그 오류의 문장으로");
  assert.deepEqual([r.success === false && r.code, r.success === false && r.kind], ["play-threw", "network-error"], "로그에는 까닭과 오류 종류");
});

test("쉬던 중 재생목록을 넣으면 곧바로 튼 첫 곡까지 세어 알린다", async () => {
  const { add, player, sent } = setup();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = await add({ isPlaylist: true, collection: "playlist", tracks: [track("a"), track("b"), track("c")] }, who);

    assert.equal(player.currentTrack?.id, "a");
    assert.deepEqual(withPlaced(r), { success: true, dropped: 0, queueLimited: false, placed: { count: 3, position: null, collection: "playlist", total: null, skipped: 0, first: "a" } }, "튼 곡까지 세고 순번은 없다(첫 곡이 대기열에 없다)");
    assert.deepEqual(
      player.queue.map((t) => t.id),
      ["b", "c"],
    );
    assert.equal(sent[0].content, "### ✅ 곡을 추가했어요!\n재생목록의 3곡을 대기열에 넣었어요.", "받은 3곡 전부. 대기열 2곡만이 아니다");
  } finally {
    mock.timers.reset();
  }
});

test("재생목록의 첫 곡이 실패하면 대기열의 다음 곡부터 틀어 복구한다", async () => {
  const { add, player, calls, sent } = setup({ plays: [{ ok: false }, { ok: true }] });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const r = await add({ isPlaylist: true, collection: "playlist", tracks: [track("a"), track("b"), track("c")] }, who);

    assert.equal(r.success, true);
    assert.equal(player.currentTrack?.id, "b", "실패한 곡은 대기열에 안 넣는다");
    assert.deepEqual(withPlaced(r), { success: true, dropped: 0, queueLimited: false, placed: { count: 2, position: null, collection: "playlist", total: null, skipped: 0, first: "b" } }, "넣은 것의 첫 곡은 실패한 곡이 아니라 대신 튼 곡");
    assert.deepEqual(
      player.queue.map((t) => t.id),
      ["c"],
    );
    assert.deepEqual(calls.slice(-3), [["play", 0], ["embed", "b"], "update"]);
    assert.equal(sent[0].content, "### ✅ 곡을 추가했어요!\n재생목록의 2곡을 대기열에 넣었어요.");
    mock.timers.tick(10_000);
    await new Promise(setImmediate);
    assert.equal(sent[0].deleted, true, "안내는 10초 뒤 지운다");
  } finally {
    mock.timers.reset();
  }
});

test("복구도 실패하면 첫 곡의 실패를 돌려준다", async () => {
  const { add } = setup({ plays: [{ ok: false, code: "live-ended" }, { ok: false }] });
  assert.deepEqual(said(await add({ isPlaylist: true, tracks: [track("a"), track("b")] }, who)), { success: false, code: "live-ended", message: plainText(errors.notice("live-ended")) });
});

test("음성 채널에 붙지 못하면 voice-failed. 틀지 않고, 재생목록이어도 다음 곡을 붙여 보지 않고, 플레이어를 버린다", async () => {
  const one = setup({ connects: false });
  assert.deepEqual(said(await one.add({ tracks: [track("a")] }, who)), { success: false, code: "voice-failed", message: plainText(errors.notice("voice-failed")) });
  assert.equal(one.player.currentTrack, null);
  assert.deepEqual(one.calls, ["connect", "dispose"]);

  const list = setup({ connects: false });
  assert.equal(said(await list.add({ isPlaylist: true, tracks: [track("a"), track("b")] }, who)).success, false);
  assert.deepEqual(list.calls, ["connect", "dispose"]);
});

// 담기는 세션 미러의 첫 쓰기라 앞 플레이어가 남긴 세션을 지우고 넘겨받는다. 붙지 못했으면 넘겨받을 까닭이 없다
test("종료 중이라 음성 채널에 붙지 않았으면 bot-shutting-down 으로 알린다. 재생하지 않고 플레이어를 정리한다(세션은 남긴다)", async () => {
  const one = setup({ connects: "bot-shutting-down" });
  assert.deepEqual(said(await one.add({ isPlaylist: true, tracks: [track("a"), track("b")] }, who)), { success: false, code: "bot-shutting-down", message: plainText(errors.notice("bot-shutting-down")) });
  assert.equal(one.player.currentTrack, null);
  assert.deepEqual(one.calls, ["connect", "dispose"]);
});

test("음성 채널에 붙지 못하면 재생목록의 나머지도 담지 않는다. 앞 플레이어가 남긴 세션이 남는다(/join 으로 이어 듣기)", async () => {
  const store = openTempStore("queue-tracks-voice-");
  try {
    const list = setup({ connects: false });
    Object.assign(list.player, { guild: { id: "g1", client: { user: { id: "bot" } } } });
    list.player.trackSink = new SessionPersistence(list.player);
    sessions().saveSession("g1", { voiceChannelId: "v1", textChannelId: "c1", volume: 100, loopMode: "off", autoplay: null, userPaused: false, positionMs: 61_000 });
    sessions().setCurrent("g1", { ...track("old"), requestedBy: { id: "u1" } });

    assert.equal((await list.add({ isPlaylist: true, tracks: [track("a"), track("b")] }, who)).success, false);
    assert.deepEqual(list.player.queue, [], "담지 않는다");
    assert.equal(sessions().load("g1")?.current?.title, "곡 old", "앞 세션이 그대로다");
  } finally {
    store.close();
  }
});

// ── 쉬는지의 판정이 갈리는 경우(지금 동작을 묶는다) ──

test("지금 곡은 없는데 대기열은 있으면(곡을 넘기는 사이 등) 쉬는 것이 아니다. 틀지 않고 담기만 한다", async () => {
  const { add, calls, notices, responder, player } = setup({ current: null, queue: [track("q1")] });
  const r = await add({ tracks: [track("a")] }, who, responder);
  assert.deepEqual(withPlaced(r), { success: true, dropped: 0, queueLimited: false, placed: { count: 1, position: 2, collection: null, total: null, skipped: 0, first: "a" } });
  assert.deepEqual(calls, [], "붙지도 틀지도 않는다");
  assert.deepEqual(
    player.queue.map((t) => t.id),
    ["q1", "a"],
  );
  assert.equal(notices.length, 1, "담은 것을 응답 매체로 알린다");
});

test("쉬던 중 재생목록이 상한에 걸려 일부만 담기면 첫 곡을 틀고, 안내에 뺀 수를 싣는다", async () => {
  const saved = config.bot.maxQueueSize;
  config.bot.maxQueueSize = 1;
  try {
    const { add, calls, sent } = setup();
    const r = await add({ isPlaylist: true, collection: "playlist", tracks: [track("a"), track("b"), track("c")] }, who);
    assert.deepEqual(withPlaced(r), { success: true, dropped: 1, queueLimited: false, placed: { count: 2, position: null, collection: "playlist", total: null, skipped: 0, first: "a" } });
    assert.deepEqual(calls, ["connect", ["play"], ["embed", "a"], "update"]);
    assert.match(sent[0].content, /1개의 곡을 넣지 못했어요/);
  } finally {
    config.bot.maxQueueSize = saved;
  }
});

test("쉬던 중 재생목록의 첫 곡에서 멈춰 두면(parked) 그 곡으로 패널을 세우고 담은 안내를 낸다", async () => {
  const { add, calls, sent, player } = setup({ plays: [{ ok: false, code: "parked" }] });
  const r = await add({ isPlaylist: true, collection: "playlist", tracks: [track("a"), track("b")] }, who);
  assert.deepEqual(withPlaced(r), { success: true, dropped: 0, queueLimited: false, placed: { count: 2, position: null, collection: "playlist", total: null, skipped: 0, first: "a" } });
  assert.equal(player.currentTrack?.id, "a");
  assert.deepEqual(calls, ["connect", ["play"], ["embed", "a"], "update"]);
  assert.equal(sent.length, 1);
});

test("첫 곡이 실패하고 다음 곡에서 멈춰 두면(parked) 그 곡으로 패널을 세운다", async () => {
  const { add, calls, player } = setup({ plays: [{ ok: false }, { ok: false, code: "parked" }] });
  const r = await add({ isPlaylist: true, collection: "playlist", tracks: [track("a"), track("b"), track("c")] }, who);
  assert.equal(r.success, true);
  assert.equal(player.currentTrack?.id, "b");
  assert.deepEqual(calls, ["connect", ["play"], ["play", 0], ["embed", "b"], "update"]);
});

test("패널을 못 만들어도 재생은 성공으로 친다", async () => {
  const { mem, add } = setup();
  mem.embedFails = true;
  assert.deepEqual(withPlaced(await add({ tracks: [track("a")] }, who)), { success: true, placed: ONE_STARTED });
});

test("틀고 있으면 대기열에 넣고 응답 매체로 알린다. 패널이 있으면 갱신한다", async () => {
  const { add, player, calls, notices, responder } = setup({ current: track("now"), queue: [track("q1")] });
  const r = await add({ tracks: [track("a")] }, who, responder);

  assert.deepEqual(withPlaced(r), { success: true, dropped: 0, queueLimited: false, placed: { count: 1, position: 2, collection: null, total: null, skipped: 0, first: "a" } });
  assert.deepEqual(
    player.queue.map((t) => t.id),
    ["q1", "a"],
  );
  assert.deepEqual(calls, ["update"]);
  assert.deepEqual(notices, ["### ✅ 곡을 추가했어요!\n**곡 a**를 대기열 2번째에 넣었어요."]);
});

test("넣을 위치: 맨 앞, 특정 곡 뒤, 기본은 자동재생이 선택해 둔 곡 앞", async () => {
  const auto = track("auto", { autoplay: true });
  const front = setup({ current: track("now"), queue: [track("q1"), auto] });
  await front.add({ insertFirst: true, tracks: [track("a")] }, who, front.responder);
  assert.deepEqual(
    front.player.queue.map((t) => t.id),
    ["a", "q1", "auto"],
  );
  assert.deepEqual(front.notices, ["### ⏫ 곡을 추가했어요!\n**곡 a**를 대기열 맨 앞에 넣었어요."]);

  const after = setup({ current: track("now"), queue: [track("q1"), track("q2")] });
  await after.add({ insertAfterId: "q1", tracks: [track("a")] }, who, after.responder);
  assert.deepEqual(
    after.player.queue.map((t) => t.id),
    ["q1", "a", "q2"],
  );

  const normal = setup({ current: track("now"), queue: [track("q1"), auto] });
  const r = await normal.add({ tracks: [track("a")] }, who, normal.responder);
  assert.deepEqual(
    normal.player.queue.map((t) => t.id),
    ["q1", "a", "auto"],
  );
  assert.equal(r.success && r.placed?.position, 2, "자동재생이 선택해 둔 곡 앞에 선 자리");
});

test("대기열 상한: 넘치는 곡은 빼고 몇 곡 뺐는지 알린다. 하나도 못 넣으면 가득 찼다고 실패", async () => {
  const saved = config.bot.maxQueueSize;
  config.bot.maxQueueSize = 2;
  try {
    const some = setup({ current: track("now"), queue: [track("q1")] });
    const r = await some.add({ isPlaylist: true, collection: "album", total: 30, tracks: [track("a"), track("b")] }, who, some.responder);
    assert.equal(r.dropped, 1);
    assert.deepEqual(some.notices, ["### ⚠️ 일부 곡을 추가했어요!\n앨범 30곡 중 1곡을 대기열 2번째에 넣었어요.\n**대기열이 가득 찼어요!** 1개의 곡을 넣지 못했어요. (최대 2곡)"]);

    const full = setup({ current: track("now"), queue: [track("q1"), track("q2")] });
    assert.deepEqual(said(await full.add({ tracks: [track("a")] }, who, full.responder)), { success: false, code: "queue-full", message: "곡을 추가하지 못했어요!\n대기열이 가득 찼어요... (최대 2곡)", dropped: 1 });
  } finally {
    config.bot.maxQueueSize = saved;
  }
});

test("자리가 모자라 덜 불러왔으면(queueLimited) 그렇다고 덧붙인다", () => {
  assert.equal(textOf(addedView({ tracks: [track("a")], collection: "playlist", notice: { queueLimited: true } })), `### ⚠️ 일부 곡을 추가했어요!\n재생목록의 1곡을 대기열에 넣었어요.\n**대기열이 가득 찼어요!** 목록의 일부만 넣었어요. (최대 ${config.bot.maxQueueSize}곡)`);
});

// 사운드클라우드 세트는 불러올 수 없는 곡(미리듣기, 지역 제한)을 빼고 넣는다. 조용히 빼지 않는다
test("출처가 불러올 수 없어 뺀 곡(skipped)이 있으면 그렇다고 덧붙인다", async () => {
  assert.equal(textOf(addedView({ tracks: [track("a")], collection: "playlist", notice: { skipped: 3, total: 41 } })), "### ⚠️ 일부 곡을 추가했어요!\n재생목록 41곡 중 1곡을 대기열에 넣었어요.\n재생할 수 없는 3곡은 제외됐어요. (미리듣기, 지역 제한 등)");

  const { add: live, notices, responder } = setup({ current: track("now") });
  await live({ tracks: [track("a"), track("b")], isPlaylist: true, collection: "playlist", skipped: 2 }, who, responder);
  assert.match(String(notices.at(-1)), /재생할 수 없는 2곡/, "곡 찾기가 넘긴 수가 안내까지 간다");
});

test("플레이어가 없거나 처리 중 던지면 실패 문장", async () => {
  assert.deepEqual(said(await queueTracks(fakeBot(), "g1", { tracks: [] }, who)), { success: false, code: "ended-while-adding", message: "그 사이에 재생이 끝나버렸어요!\n플레이어가 만료됐어요. 링크를 다시 넣어서 재생해주세요." });

  // 곡 목록이 없는 요청(처리 중 던진다)
  const { add: m2 } = setup({ current: track("now") });
  assert.deepEqual(await m2(fake<TrackData>({ tracks: null }), who), { success: false, code: "add-failed", kind: "unknown-error" });
});

test("재생목록 안내는 텍스트 채널이 없으면(대시보드) 보내지 않는다", async () => {
  const { mem, player, sent } = setup();
  const channel = player.textChannel;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    player.textChannel = null;
    const from = sink.buffer.length;
    await mem.postAddedNotice(player, [track("a")], "playlist");
    assert.deepEqual(sent, []);
    assert.deepEqual(sink.buffer.slice(from), [], "보내려다 실패한 것이 아니라 아예 보내지 않는다");

    // 대조: 채널이 있으면 보낸다
    player.textChannel = channel;
    await mem.postAddedNotice(player, [track("a")], "playlist");
    assert.equal(sent.length, 1);
  } finally {
    mock.timers.reset();
  }
});
