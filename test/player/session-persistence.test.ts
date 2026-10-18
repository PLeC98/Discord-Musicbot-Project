// src/player/session-mirror.ts — 트랙 변경을 DB로 옮기는 미러, 세션 행, 복원.
// 임시 DB로 연다 — 운영 DB(database/cache.db)는 건드리지 않는다.

import { sessions, type RestoredSession } from "../../src/store/player-sessions.ts";
import * as playerEvents from "../../src/player/events.ts";
import * as playerNotices from "../../src/ui/player-notices.ts";
import * as transientMessages from "../../src/ui/transient-messages.ts";
import config from "../../src/config/index.ts";
import type { GuildTextBasedChannel } from "discord.js";
import { Player } from "../../src/player/player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { stateDb } from "../../src/store/state-db.ts";
import * as stores from "../../src/store/stores.ts";
import { textOf } from "../helpers/cv2.ts";

const DB_DIR = path.join(os.tmpdir(), `musicbot-session-test-${process.pid}`);
const removeDb = () => {
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 5 });
};

const audioCache = await import("../../src/store/audio-cache.ts");
const SessionPersistence = (await import("../../src/player/session-mirror.ts")).SessionPersistence;
const trackState = await import("../../src/player/track-state.ts");

// 플레이어가 알린 일은 진짜 문장 보내기(ui/player-notices)로 채널에 간다. 조립(main.ts)이 거는 것과 같다
playerEvents.on("notice", playerNotices.sendNotice);

before(() => {
  removeDb();
  stores.open(DB_DIR);
  audioCache.initialize();
});

after(() => {
  audioCache.close();
  stores.close();
  removeDb();
});

let guildSerial = 0;
// 가짜 플레이어. 테스트가 재생 위치(position)와 부른 것(calls)을 정하고 본다
function makePlayer(overrides: object = {}) {
  const p = fakePlayer({
    bindChannels: Player.prototype.bindChannels,
    movePanel: Player.prototype.movePanel,
    restoreSettings: Player.prototype.restoreSettings,
    guild: { id: `g${guildSerial++}` },
    voiceChannel: { id: "v1" },
    textChannel: null,
    volume: 100,
    loop: false,
    autoplay: false,
    paused: false,
    pauseReasons: new Set(),
    playback: null,
    requesterId: null,
    nowPlayingMessage: null,
    position: 0,
    calls: [] as unknown[][],
    getCurrentTime() {
      return this.position;
    },
    ...overrides,
  });
  trackState.init(p);
  const sp = new SessionPersistence(p);
  p.trackSink = sp;
  return { p, sp };
}

let serial = 0;
const t = (title = `t${serial++}`): QueuedTrack => ({ title, duration: 0, platform: "youtube", pageUrl: `https://y/${title}`, requestKey: `https://y/${title}`, audioUrl: `https://www.youtube.com/watch?v=${title}` });
const titles = (arr: Array<{ title: string | null }>) => arr.map((x) => x.title);
const memory = (p: Player) => ({ current: p.currentTrack?.title ?? null, queue: titles(p.queue), history: titles(p.previousTracks) });
// 줄 번호. 저장한 그대로여야 다시 시작한 뒤 같은 곡을 가리킨다
const numbers = (arr: Array<{ entry?: number | null }>) => arr.map((x) => x.entry);
const memoryNumbers = (p: Player) => ({ current: p.currentTrack?.entry ?? null, queue: numbers(p.queue), history: numbers(p.previousTracks) });
function storedNumbers(guildId: string) {
  const s = sessions().load(guildId);
  if (!s) return { current: null, queue: [], history: [] };
  return { current: s.current?.entry ?? null, queue: numbers(s.queue), history: numbers(s.history) };
}

// 세션이 있어야 하는 곳. 없으면 실패
function loaded(guildId: string) {
  const s = sessions().load(guildId);
  assert.ok(s, "세션이 있다");
  return s;
}

function stored(guildId: string) {
  const s = sessions().load(guildId);
  if (!s) return { current: null, queue: [], history: [] };
  return { current: s.current?.title ?? null, queue: titles(s.queue), history: titles(s.history) };
}

function rng(seed: number) {
  let x = seed >>> 0;
  return (n: number) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return Math.floor((x / 2 ** 32) * n);
  };
}

// ── 미러 ──

test("trackState의 모든 변경이 DB에 그대로 옮겨진다 — 무작위 1500회", () => {
  const { p } = makePlayer();
  const pick = rng(915);
  const random = () => pick(1_000_000) / 1_000_000;

  const ops = [
    () =>
      trackState.enqueue(
        p,
        Array.from({ length: 1 + pick(3) }, () => t()),
      ),
    () => trackState.enqueue(p, [t()], { front: true }),
    () => trackState.shiftNext(p),
    () => p.currentTrack && trackState.retire(p, p.currentTrack, { requeue: pick(2) === 0 }),
    () => {
      p.loop = pick(2) === 0 ? "queue" : false;
      trackState.rewind(p);
    },
    () => trackState.rewindRing(p),
    () => trackState.removeAt(p, pick(p.queue.length + 1)),
    () => trackState.move(p, pick(p.queue.length + 1), pick(p.queue.length + 1)),
    () => trackState.shuffle(p, random),
    () => p.queue.length > 0 && trackState.insertAfter(p, p.queue[pick(p.queue.length)].title ?? undefined, [t(), t()]),
    () => trackState.setCurrent(p, pick(3) === 0 ? null : t()),
  ];
  const rare = [() => trackState.clearQueue(p), () => trackState.reset(p, { history: pick(2) === 0 }), () => trackState.restore(p, { current: t(), queue: [t(), t()], history: [t()] })];

  for (let step = 0; step < 1500; step++) {
    (pick(30) === 0 ? rare[pick(rare.length)] : ops[pick(ops.length)])();
    assert.deepEqual(stored(p.guild.id), memory(p), `조작 ${step}번째에서 어긋남`);
    assert.deepEqual(storedNumbers(p.guild.id), memoryNumbers(p), `조작 ${step}번째에서 줄 번호가 어긋남`);
  }
});

test("DB가 메모리와 어긋나 있으면 다음 변경에서 통째로 다시 맞춘다", () => {
  const { p, sp } = makePlayer();
  trackState.enqueue(p, [t("A"), t("B"), t("C")]);
  stateDb.get().prepare("DELETE FROM session_tracks WHERE guild_id = ? AND slot = 'queue'").run(p.guild.id);

  trackState.removeAt(p, 1); // DB에는 삭제할 행이 없다
  assert.deepEqual(stored(p.guild.id), memory(p));
  assert.equal(sp.dirty, false);
});

test("쓰기가 실패하면 표시해 두고 다음 변경에서 통째로 다시 쓴다", () => {
  const { p, sp } = makePlayer();
  const store = sessions();
  const real = store.append;
  store.append = () => {
    throw new Error("디스크 가득 참");
  };
  try {
    trackState.enqueue(p, [t("A")]);
  } finally {
    store.append = real;
  }
  assert.equal(sp.dirty, true);

  trackState.enqueue(p, [t("B")]);
  assert.equal(sp.dirty, false);
  assert.deepEqual(stored(p.guild.id).queue, ["A", "B"]);
});

// 알림을 빠뜨린 길은 주기 저장(beat)이 잡는다. 세션 행의 열이 지난 저장과 다르면 쓴다
test("세션 행이 바뀌면 주기 저장이 쓴다. 안 바뀌었거나 위치만 바뀌었으면 다시 쓰지 않는다. 곡이 없으면 쓰지 않는다", async () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("now"));
  await sp.persistState("play");
  const store = sessions();
  const save = store.saveSession.bind(store);
  const remove = store.removeSession.bind(store);
  let writes = 0;
  let removals = 0;
  store.saveSession = (...args: Parameters<typeof save>) => (writes++, save(...args));
  store.removeSession = (...args: Parameters<typeof remove>) => (removals++, remove(...args));
  sp.startStateSync();
  try {
    SessionPersistence._beat();
    assert.equal(writes, 0, "바뀐 필드가 없다");

    p.lastPlaybackPosition = 90_000; // 위치만
    SessionPersistence._beat();
    assert.equal(writes, 0, "위치는 행을 다시 쓰지 않는다(위치는 따로 쓴다)");

    p.volume = 40;
    SessionPersistence._beat();
    assert.equal(writes, 1);
    assert.equal(loaded(p.guild.id).session.volume, 40);

    SessionPersistence._beat();
    assert.equal(writes, 1, "한 번 쓴 뒤로는 같다");

    trackState.reset(p, { history: true });
    p.loop = "queue";
    SessionPersistence._beat();
    assert.equal(writes, 1, "곡도 대기열도 없으면 쓰지 않는다");
    assert.equal(removals, 0, "지우는 것도 주기 저장의 일이 아니다(대기열이 끝날 때 지운다)");
  } finally {
    sp.stopStateSync();
    store.saveSession = save;
    store.removeSession = remove;
  }
});

// 설정이 바뀌면 플레이어가 알리고, 미러가 잠깐(0.2초) 모았다가 한 번 쓴다
test("설정 알림: 연달아 와도 한 번 쓴다. 바뀐 게 없으면 쓰지 않는다. 동기화를 멈추면 대기 중인 쓰기도 버린다", async () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("now"));
  await sp.persistState("play");
  const store = sessions();
  const save = store.saveSession.bind(store);
  let writes = 0;
  store.saveSession = (...args: Parameters<typeof save>) => (writes++, save(...args));
  const settle = () => new Promise((done) => setTimeout(done, 300));
  sp.startStateSync();
  try {
    for (const volume of [80, 60, 40]) {
      p.volume = volume;
      sp.onSettingsChanged();
    }
    assert.equal(writes, 0, "곧바로가 아니라 잠깐 모은다");
    await settle();
    assert.equal(writes, 1);
    assert.equal(loaded(p.guild.id).session.volume, 40, "마지막 값");

    sp.onSettingsChanged();
    await settle();
    assert.equal(writes, 1, "바뀐 필드가 없다");

    p.loop = "track";
    sp.onSettingsChanged();
    sp.stopStateSync();
    await settle();
    assert.equal(writes, 1, "멈추면 걸린 쓰기를 버린다");

    sp.onSettingsChanged();
    await settle();
    assert.equal(writes, 1, "멈춘 뒤의 알림은 받지 않는다(버린 플레이어)");
  } finally {
    sp.stopStateSync();
    store.saveSession = save;
  }
});

test("나가며 저장한 뒤에는 메모리를 비워도 저장한 트랙이 남는다", async () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("now"));
  trackState.enqueue(p, [t("next")]);

  await sp.persistState("leave");
  trackState.reset(p);

  const s = loaded(p.guild.id);
  assert.equal(s.current?.title, "now", "구 코드 구조였다면 비우는 순간 방금 저장한 트랙이 지워진다");
  assert.deepEqual(titles(s.queue), ["next"]);
});

// ── 세션 행 ──

test("세션 행: 반복 false는 off로, 일시정지는 수동 사유만 남긴다", async () => {
  const { p, sp } = makePlayer({ paused: true, pauseReasons: new Set(["alone"]), volume: 30, position: 42_000 });
  trackState.setCurrent(p, t("x"));
  await sp.persistState();

  let { session } = loaded(p.guild.id);
  assert.equal(session.loopMode, "off");
  assert.equal(session.autoplay, null);
  assert.equal(session.pausedManual, false, "혼자 남아 멈춘 것은 복원 대상이 아니다");
  assert.equal(session.positionMs, 42_000);
  assert.equal(session.volume, 30);

  p.loop = "queue";
  p.autoplay = "kpop";
  p.pauseReasons.add("manual");
  await sp.persistState();
  ({ session } = loaded(p.guild.id));
  assert.equal(session.loopMode, "queue");
  assert.equal(session.autoplay, "kpop");
  assert.equal(session.pausedManual, true);
});

test("곡도 대기열도 없으면 세션을 삭제한다", async () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("x"));
  await sp.persistState();
  trackState.setCurrent(p, null);
  await sp.persistState();
  assert.equal(sessions().load(p.guild.id), null);
});

test("재생 위치는 타이머 하나가 한 번에 쓰고, 일시정지 중인 플레이어는 건너뛴다", async () => {
  const a = makePlayer({ position: 10_000 });
  const b = makePlayer({ position: 20_000 });
  for (const { p, sp } of [a, b]) {
    trackState.setCurrent(p, t());
    await sp.persistState();
    sp.startStateSync();
  }
  a.p.position = 11_000;
  b.p.position = 99_000;
  b.p.paused = true;

  try {
    SessionPersistence._beat();
    assert.equal(loaded(a.p.guild.id).session.positionMs, 11_000);
    assert.equal(loaded(b.p.guild.id).session.positionMs, 20_000, "멈춘 동안 위치는 그대로다");
  } finally {
    a.sp.stopStateSync();
    b.sp.stopStateSync();
  }
});

// ── 복원 ──

function makeRestorePlayer(overrides: object = {}) {
  const { p, sp } = makePlayer({ connection: { state: {} }, ...overrides }); // 연결 재수립 경로 생략
  p.play = fake<Player["play"]>(async (ms: number) => {
    // play()는 시작 직후 pauseReasons를 보고 즉시 일시정지 — 그 시점의 사유 유무를 기록
    p.calls.push(["play", ms, p.pauseReasons.has("manual")]);
  });
  p.pauseFor = fake<Player["pauseFor"]>((reason: string) => {
    p.pauseReasons.add(reason);
    p.paused = true;
    p.calls.push(["pauseFor", reason]);
  });
  return { p, sp };
}

// 세션 표에서 되읽은 것처럼. 곡은 테스트가 보는 필드만
function makeRecord(sessionOverrides: object = {}, current: object | null = { title: "곡", url: "https://y/1", duration: 100, requesterId: "u1" }) {
  return fake<RestoredSession>({
    session: { voiceChannelId: "v1", textChannelId: "c1", volume: 80, loopMode: "off", autoplay: null, pausedManual: false, positionMs: 30_000, ...sessionOverrides },
    current,
    queue: [],
    history: [],
  });
}

type TestPlayer = ReturnType<typeof makePlayer>["p"];

async function restore(record: RestoredSession, setup: (p: TestPlayer) => void = () => {}) {
  const { p, sp } = makeRestorePlayer();
  setup(p);
  await sp.restoreFromState(record);
  return p;
}

test("복원: 수동 일시정지 세션은 멈춘 상태로 (L-01 회귀 — 구 코드는 무조건 자동 재생)", async () => {
  const p = await restore(makeRecord({ pausedManual: true }));
  assert.deepEqual(p.calls[0], ["play", 30_000, true], "play 시작 시점에 이미 manual 사유가 걸려 즉시 일시정지");
  assert.equal(p.paused, true);
  assert.ok(p.pauseReasons.has("manual"));
});

test("복원: 재생 중이던 세션은 그대로 재생하고 설정을 복원한다", async () => {
  const p = await restore(makeRecord({ volume: 80, loopMode: "off", autoplay: "rock" }));
  assert.deepEqual(p.calls, [["play", 30_000, false]]);
  assert.equal(p.paused, false);
  assert.equal(p.volume, 80);
  assert.equal(p.loop, false, "DB의 off는 메모리에서 false다 — 대시보드가 참/거짓으로 읽는다");
  assert.equal(p.autoplay, "rock");
});

test("복원: 전의 멈춤 사유(혼자 남음 등)는 비운다. 복원한 뒤의 상황이 다시 건다", async () => {
  const p = await restore(makeRecord(), (q) => {
    q.pauseReasons.add("alone");
    q.pauseReasons.add("mute");
  });
  assert.deepEqual([...p.pauseReasons], []);
  assert.deepEqual(p.calls, [["play", 30_000, false]]);
});

test("복원: 줄 번호는 저장한 그대로(다시 시작하기 전에 화면이 보낸 빼기 · 옮기기도 같은 곡에 닿는다), 열거되지 않는 필드로", async () => {
  const record = makeRecord({}, { title: "곡", url: "https://y/1", duration: 100, entry: 41 });
  Object.assign(record, {
    queue: [
      { title: "다음", url: "https://y/2", duration: 100, entry: 42 },
      { title: "번호 없음", url: "https://y/3", duration: 100, entry: null },
    ],
  });
  const p = await restore(record);
  assert.equal(p.currentTrack?.entry, 41);
  assert.equal(p.queue[0].entry, 42);
  assert.ok(Number.isInteger(p.queue[1].entry) && p.queue[1].entry !== 41 && p.queue[1].entry !== 42, "번호가 없던 곡은 새로 받는다");
  assert.equal(Object.keys(p.queue[0]).includes("entry"), false, "객체 비교 · JSON 에는 나오지 않는다");
});

test("복원: 요청자는 id만 복원한다", async () => {
  const p = await restore(makeRecord());
  assert.ok(p.currentTrack, "곡을 복원했다");
  assert.deepEqual(p.currentTrack.requestedBy, { id: "u1" });
  assert.equal("requesterId" in p.currentTrack, false, "저장용 필드를 트랙에 남기지 않는다");
});

test("복원: DB에서 읽은 트랙을 다시 쓰지 않고, 이어지는 변경은 증분으로 그대로 맞는다", async () => {
  const { p: saved } = makePlayer();
  trackState.enqueue(saved, [t("a"), t("b"), t("c"), t("d")]);
  trackState.setCurrent(saved, t("now"));
  trackState.retire(saved, t("old"), { requeue: true });
  const record = loaded(saved.guild.id);

  const store = sessions();
  const real = store.replaceTracks;
  let rewrites = 0;
  store.replaceTracks = (...args) => {
    rewrites++;
    return real.apply(store, args);
  };
  try {
    const { p, sp } = makeRestorePlayer({ guild: { id: saved.guild.id } });
    await sp.restoreFromState(record);
    assert.deepEqual(stored(p.guild.id), memory(p));

    p.loop = "queue";
    trackState.removeAt(p, 1);
    trackState.rewind(p);
    trackState.shiftNext(p);
    assert.deepEqual(stored(p.guild.id), memory(p));
    assert.equal(rewrites, 0, "복원도 이전곡도 통째로 다시 쓰지 않는다 (어긋나 되맞췄어도 여기서 잡힌다)");
  } finally {
    store.replaceTracks = real;
  }
});

// 미리 선택해 둔 자동재생 곡은 복원하지 않는다 — 사용자가 선택한 곡만 세션에 남는 것이 자연스럽고,
// 장르는 함께 복원되므로 첫 곡이 시작될 때 다시 선택된다. 요청자가 봇인 행으로 구분한다.
test("복원: 자동재생이 미리 선택해 둔 곡은 복원하지 않고 DB도 맞춘다", async () => {
  const BOT = "bot1";
  const { p: saved } = makePlayer();
  trackState.setCurrent(saved, t("now"));
  trackState.enqueue(saved, [t("내곡1"), { ...t("자동곡"), requestedBy: { id: BOT } }, t("내곡2")]);
  const record = loaded(saved.guild.id);

  const { p, sp } = makeRestorePlayer({ guild: { id: saved.guild.id, client: { user: { id: BOT } } } });
  await sp.restoreFromState(record);

  assert.deepEqual(titles(p.queue), ["내곡1", "내곡2"]);
  assert.deepEqual(stored(p.guild.id), memory(p), "필터링한 뒤 DB를 맞추지 않으면 이후 증분 쓰기가 엉뚱한 곡을 건드린다");
});

// 봇 id를 모르면(클라이언트가 아직 없음) 필터링하지 않는다 — 사용자 곡을 실수로 버리는 쪽이 더 나쁘다.
test("복원: 봇 id를 알 수 없으면 대기열을 그대로 복원한다", async () => {
  const { p: saved } = makePlayer();
  trackState.setCurrent(saved, t("now"));
  trackState.enqueue(saved, [t("내곡"), { ...t("자동곡"), requestedBy: { id: "bot1" } }]);
  const record = loaded(saved.guild.id);

  const { p, sp } = makeRestorePlayer({ guild: { id: saved.guild.id } }); // client 없음
  await sp.restoreFromState(record);

  assert.deepEqual(titles(p.queue), ["내곡", "자동곡"]);
});

test("복원: 상한을 넘는 대기열은 잘라내고 DB도 같이 줄인다", async () => {
  const realMax = config.bot.maxQueueSize;
  const { p: saved } = makePlayer();
  trackState.setCurrent(saved, t("now"));
  trackState.enqueue(
    saved,
    Array.from({ length: 30 }, () => t()),
  );
  const record = loaded(saved.guild.id);

  config.bot.maxQueueSize = 25;
  try {
    const { p, sp } = makeRestorePlayer({ guild: { id: saved.guild.id } });
    await sp.restoreFromState(record);
    assert.equal(p.queue.length, 25);
    assert.deepEqual(stored(p.guild.id), memory(p), "메모리만 자르면 넘친 행이 DB에 남아 이후 증분 쓰기가 엉뚱한 곡을 건드린다");

    trackState.removeAt(p, 24);
    assert.deepEqual(stored(p.guild.id), memory(p));
  } finally {
    config.bot.maxQueueSize = realMax;
  }
});

test("복원: 곡 길이 끝에 거의 닿은 위치는 처음부터", async () => {
  const p = await restore(makeRecord({ positionMs: 99_500 }));
  assert.deepEqual(p.calls[0], ["play", 0, false]);
});

type Sent = { content: string; deleted: boolean; delete(): Promise<void> };

function fakeChannel() {
  const sent: Sent[] = [];
  return {
    id: "c1",
    sent,
    async send(payload: unknown) {
      const content = textOf(payload);
      const message = {
        content,
        deleted: false,
        async delete() {
          this.deleted = true;
        },
      };
      sent.push(message);
      return message;
    },
  };
}

test("복원 안내: 멈춘 채 복원했으면 재개됐다고 하지 않는다", async () => {
  const paused = fakeChannel();
  await restore(makeRecord({ pausedManual: true }), (p) => (p.textChannel = fake<GuildTextBasedChannel>(paused)));
  assert.equal(paused.sent.length, 1);
  assert.ok(paused.sent[0].content.startsWith("### ⏸️ 봇이 복구됐어요\n마지막 일시정지 상태를 유지할게요."), paused.sent[0].content);

  const playing = fakeChannel();
  await restore(makeRecord(), (p) => (p.textChannel = fake<GuildTextBasedChannel>(playing)));
  assert.ok(playing.sent[0].content.startsWith("### ▶️ 봇이 복구됐어요\n기록된 마지막 재생 상태를 이어갈게요."), playing.sent[0].content);
});

test("복원: 무엇이 됐나를 돌려준다(이어 틂 · 틀 곡을 열지 못함 · 틀 곡 없음)", async () => {
  const { sp } = makeRestorePlayer();
  assert.equal(await sp.restoreFromState(makeRecord()), "restored");

  const failing = makeRestorePlayer();
  failing.p.play = fake<Player["play"]>(async () => {
    trackState.setCurrent(failing.p, null);
    return { ok: false, code: "play-failed", error: new Error("x") };
  });
  assert.equal(await failing.sp.restoreFromState(makeRecord()), "failed");

  assert.equal(await makeRestorePlayer().sp.restoreFromState(makeRecord({}, null)), "empty");
  assert.equal(await makeRestorePlayer().sp.restoreFromState(null), "empty");
});

test("복원: announce 를 끄면 글자 채널에 알리지 않고, 복원하는 동안만 연달아 실패 알림을 끈다(/join 이 응답으로 말한다)", async () => {
  const quiet = fakeChannel();
  const seenQuiet: boolean[] = [];
  const { p, sp } = makeRestorePlayer();
  p.textChannel = fake<GuildTextBasedChannel>(quiet);
  p.play = fake<Player["play"]>(async () => {
    seenQuiet.push(p.quietFailures);
    return { ok: true, track: p.currentTrack };
  });
  assert.equal(await sp.restoreFromState(makeRecord(), { announce: false }), "restored");
  assert.deepEqual(quiet.sent, []);
  assert.deepEqual(seenQuiet, [true], "복원하는 동안은 끈다");
  assert.equal(p.quietFailures, false, "복원한 뒤에는 다시 알린다");

  const loud = makeRestorePlayer();
  const seenLoud: boolean[] = [];
  loud.p.play = fake<Player["play"]>(async () => {
    seenLoud.push(loud.p.quietFailures);
    return { ok: true, track: loud.p.currentTrack };
  });
  await loud.sp.restoreFromState(makeRecord());
  assert.deepEqual(seenLoud, [false]);
});

test("복원 안내는 잠시 뒤 삭제한다", async () => {
  const { AUTO_DELETE_MS } = transientMessages;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const channel = fakeChannel();
    await restore(makeRecord(), (p) => (p.textChannel = fake<GuildTextBasedChannel>(channel)));
    assert.equal(channel.sent[0].deleted, false);

    mock.timers.tick(AUTO_DELETE_MS);
    await new Promise(setImmediate);
    assert.equal(channel.sent[0].deleted, true);
  } finally {
    mock.timers.reset();
  }
});
