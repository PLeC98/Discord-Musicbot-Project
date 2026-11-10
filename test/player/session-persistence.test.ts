// src/player/session-mirror.ts, src/store/player-sessions.ts: 트랙 변경을 DB로 옮기는 미러, 세션 행, 복원.
// 임시 DB로 열어 운영 DB(database/cache.db)는 건드리지 않는다.

import { sessions, type RestoredSession } from "../../src/store/player-sessions.ts";
import * as playerEvents from "../../src/player/events.ts";
import * as playerNotices from "../../src/ui/player-notices.ts";
import * as transientMessages from "../../src/ui/transient-messages.ts";
import config from "../../src/config/index.ts";
import type { GuildTextBasedChannel } from "discord.js";
import { Player } from "../../src/player/player.ts";
import { PauseState } from "../../src/player/pause-state.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { codedError } from "../../src/rules/error-kind.ts";
import sink from "../../src/infra/log/sink.ts";
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
function makePlayer({ position = 0, ...overrides }: { [K in keyof Player]?: unknown } & { position?: number } = {}) {
  const p = fakePlayer(
    {
      bindChannels: Player.prototype.bindChannels,
      movePanel: Player.prototype.movePanel,
      restoreSettings: Player.prototype.restoreSettings,
      guild: { id: `g${guildSerial++}` },
      voiceChannel: { id: "v1" },
      textChannel: null,
      volume: 100,
      loop: false,
      autoplay: false,
      // 멈춤은 진짜 상태 모듈로. 오디오는 쓰지 않으니 아무것도 하지 않는 것
      pause: new PauseState(
        () => ({ state: { status: "idle" }, pause: () => false, unpause: () => false }) as never,
        () => {},
      ),
      playback: null,
      nowPlayingMessage: null,
      ...overrides,
    },
    { syncs: 0, position, calls: [] as unknown[][] },
  );
  // 테스트가 바꾸는 값(position)과 센 수(syncs)를 읽으므로 만든 뒤에 붙인다
  p.syncHolds = () => {
    p.syncs++;
  };
  p.getCurrentTime = () => p.position;
  Object.defineProperty(p, "paused", { get: () => p.pause.silent });
  trackState.init(p);
  const sp = new SessionPersistence(p);
  p.trackSink = sp;
  return { p, sp };
}

let serial = 0;
const t = (title = `t${serial++}`): QueuedTrack => ({ title, duration: 0, platform: "youtube", pageUrl: `https://y/${title}`, requestKey: `https://y/${title}`, audioUrl: `https://www.youtube.com/watch?v=${title}` });
const titles = (arr: Array<{ title: string | null }>) => arr.map((x) => x.title);
const memory = (p: Player) => ({ current: p.currentTrack?.title ?? null, queue: titles(p.queue), history: titles(p.previousTracks) });
// 대기열 ID. 저장한 그대로여야 다시 시작한 뒤 같은 곡을 가리킨다
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

test("trackState의 모든 변경이 DB에 그대로 옮겨진다. 무작위 1500회", () => {
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
    assert.deepEqual(storedNumbers(p.guild.id), memoryNumbers(p), `조작 ${step}번째에서 대기열 ID가 어긋남`);
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

// 알림을 빠뜨린 길은 주기 저장(saveTick)이 잡는다. 세션 행의 열이 지난 저장과 다르면 쓴다
test("세션 행이 바뀌면 주기 저장이 쓴다. 안 바뀌었거나 위치만 바뀌었으면 다시 쓰지 않는다. 곡이 없으면 쓰지 않는다", async () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("now"));
  await sp.save("play");
  const store = sessions();
  const save = store.saveSession.bind(store);
  const remove = store.removeSession.bind(store);
  let writes = 0;
  let removals = 0;
  store.saveSession = (...args: Parameters<typeof save>) => (writes++, save(...args));
  store.removeSession = (...args: Parameters<typeof remove>) => (removals++, remove(...args));
  sp.startPeriodicSave();
  try {
    SessionPersistence._saveTick();
    assert.equal(writes, 0, "바뀐 필드가 없다");

    p.position = 90_000; // 위치만(가짜의 getCurrentTime 이 읽는 값)
    SessionPersistence._saveTick();
    assert.equal(writes, 0, "위치는 행을 다시 쓰지 않는다(위치는 따로 쓴다)");

    p.volume = 40;
    SessionPersistence._saveTick();
    assert.equal(writes, 1);
    assert.equal(loaded(p.guild.id).session.volume, 40);

    SessionPersistence._saveTick();
    assert.equal(writes, 1, "한 번 쓴 뒤로는 같다");

    trackState.reset(p, { history: true });
    p.loop = "queue";
    SessionPersistence._saveTick();
    assert.equal(writes, 1, "곡도 대기열도 없으면 쓰지 않는다");
    assert.equal(removals, 0, "지우는 것도 주기 저장의 일이 아니다(대기열이 끝날 때 지운다)");
  } finally {
    sp.stopPeriodicSave();
    store.saveSession = save;
    store.removeSession = remove;
  }
});

// 설정이 바뀌면 플레이어가 알리고, 미러가 잠깐(0.2초) 모았다가 한 번 쓴다
test("설정 알림: 연달아 와도 한 번 쓴다. 바뀐 게 없으면 쓰지 않는다. 동기화를 멈추면 대기 중인 쓰기도 버린다", async () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("now"));
  await sp.save("play");
  const store = sessions();
  const save = store.saveSession.bind(store);
  let writes = 0;
  store.saveSession = (...args: Parameters<typeof save>) => (writes++, save(...args));
  const settle = () => new Promise((done) => setTimeout(done, 300));
  sp.startPeriodicSave();
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
    sp.stopPeriodicSave();
    await settle();
    assert.equal(writes, 1, "멈추면 걸린 쓰기를 버린다");

    sp.onSettingsChanged();
    await settle();
    assert.equal(writes, 1, "멈춘 뒤의 알림은 받지 않는다(버린 플레이어)");
  } finally {
    sp.stopPeriodicSave();
    store.saveSession = save;
  }
});

test("나가며 저장한 뒤에는 메모리를 비워도 저장한 트랙이 남는다", async () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("now"));
  trackState.enqueue(p, [t("next")]);

  await sp.save("leave");
  trackState.reset(p);

  const s = loaded(p.guild.id);
  assert.equal(s.current?.title, "now", "비우는 순간 방금 저장한 트랙이 지워지지 않는다");
  assert.deepEqual(titles(s.queue), ["next"]);
});

// ── 세션 행 ──

test("세션 행: 반복 false는 off로, 일시정지는 사람의 뜻만 남긴다(억제로 소리가 멈춰 있어도)", async () => {
  const { p, sp } = makePlayer({ volume: 30, position: 42_000 });
  p.pause.setHolds(["alone"]);
  trackState.setCurrent(p, t("x"));
  await sp.save("test");

  let { session } = loaded(p.guild.id);
  assert.equal(session.loopMode, "off");
  assert.equal(session.autoplay, null);
  assert.equal(session.userPaused, false, "혼자 남아 멈춘 것은 복원 대상이 아니다");
  assert.equal(session.positionMs, 42_000);
  assert.equal(session.volume, 30);

  p.loop = "queue";
  p.autoplay = "kpop";
  p.pause.setUser(true);
  await sp.save("test");
  ({ session } = loaded(p.guild.id));
  assert.equal(session.loopMode, "queue");
  assert.equal(session.autoplay, "kpop");
  assert.equal(session.userPaused, true, "혼자 남아 멈춘 동안 사람이 일시정지한 것도 남는다");
});

test("곡도 대기열도 없으면 세션을 삭제한다", async () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("x"));
  await sp.save("test");
  trackState.setCurrent(p, null);
  await sp.save("test");
  assert.equal(sessions().load(p.guild.id), null);
});

test("재생 위치는 타이머 하나가 한 번에 쓰고, 일시정지 중인 플레이어는 건너뛴다", async () => {
  const a = makePlayer({ position: 10_000 });
  const b = makePlayer({ position: 20_000 });
  for (const { p, sp } of [a, b]) {
    trackState.setCurrent(p, t());
    await sp.save("test");
    sp.startPeriodicSave();
  }
  a.p.position = 11_000;
  b.p.position = 99_000;
  b.p.pause.setHolds(["alone"]); // 저장 필드(사람의 뜻)는 그대로인 멈춤. 사람이 멈추면 그 순간의 위치를 한 번 저장한다

  try {
    SessionPersistence._saveTick();
    assert.equal(loaded(a.p.guild.id).session.positionMs, 11_000);
    assert.equal(loaded(b.p.guild.id).session.positionMs, 20_000, "멈춘 동안 위치는 그대로다");
  } finally {
    a.sp.stopPeriodicSave();
    b.sp.stopPeriodicSave();
  }
});

// ── 복원 ──

function makeRestorePlayer(overrides: object = {}) {
  const { p, sp } = makePlayer({ connection: { state: {} }, ...overrides }); // 연결 재수립 경로 생략
  p.play = fake<Player["play"]>(async (ms: number) => {
    // play()는 시작 직후 사람의 뜻을 보고 멈춘다(Playing 리스너). 그 시점의 뜻을 기록한다
    p.calls.push(["play", ms, p.pause.userPaused]);
  });
  return { p, sp };
}

// 세션 테이블에서 되읽은 것처럼. 곡은 테스트가 보는 필드만
function makeRecord(sessionOverrides: object = {}, current: object | null = { title: "곡", url: "https://y/1", duration: 100, requesterId: "u1" }) {
  return fake<RestoredSession>({
    session: { voiceChannelId: "v1", textChannelId: "c1", volume: 80, loopMode: "off", autoplay: null, userPaused: false, positionMs: 30_000, ...sessionOverrides },
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

test("복원: 사람이 일시정지한 세션은 멈춘 상태로", async () => {
  const p = await restore(makeRecord({ userPaused: true }));
  assert.deepEqual(p.calls[0], ["play", 30_000, true], "play 시작 시점에 이미 사람의 뜻이 걸려 즉시 멈춘다");
  assert.equal(p.paused, true);
  assert.equal(p.pause.userPaused, true);
});

test("복원: 재생 중이던 세션은 그대로 재생하고 설정을 복원한다", async () => {
  const p = await restore(makeRecord({ volume: 80, loopMode: "off", autoplay: "rock" }));
  assert.deepEqual(p.calls, [["play", 30_000, false]]);
  assert.equal(p.paused, false);
  assert.equal(p.volume, 80);
  assert.equal(p.loop, false, "DB의 off는 메모리에서 false다 — 대시보드가 참/거짓으로 읽는다");
  assert.equal(p.autoplay, "rock");
});

test("복원: 억제 사유(혼자 남음, 음소거)는 비우지 않고 지금 음성 상태로 다시 맞춘다", async () => {
  const p = await restore(makeRecord(), (q) => q.pause.setHolds(["mute"]));
  assert.deepEqual([...p.pause.holds], ["mute"], "지금 상태의 계산이라 비울 까닭이 없다");
  assert.ok(p.syncs >= 1, "붙은 뒤 맞춘다");
  assert.deepEqual(p.calls, [["play", 30_000, false]]);
});

test("복원: 대기열 ID는 저장한 그대로(다시 시작하기 전에 화면이 보낸 빼기, 옮기기도 같은 곡에 닿는다), 열거되지 않는 필드로", async () => {
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

// 미리 선택해 둔 자동재생 곡은 복원하지 않는다. 사용자가 선택한 곡만 세션에 남는 것이 자연스럽고,
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

// 봇 id를 모르면(클라이언트가 아직 없음) 필터링하지 않는다. 사용자 곡을 실수로 버리는 쪽이 더 나쁘다.
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

// 곡 길이 100초. queue 는 저장된 대기열의 제목
function endRecord(positionMs: number, { loopMode = "off", queue = [] as string[], live = false, duration = 100 } = {}) {
  const row = (title: string) => ({ title, url: `https://y/${title}`, duration, requesterId: "u1", isLive: live });
  return fake<RestoredSession>({
    session: { voiceChannelId: "v1", textChannelId: "c1", volume: 80, loopMode, autoplay: null, userPaused: false, positionMs },
    current: row("지금 곡"),
    queue: queue.map(row),
    history: [],
  });
}

test("복원: 저장 위치가 곡 끝(위치 + 주기 저장 5초 ≥ 길이)이면 다 들은 곡을 다시 틀지 않고 곡이 끝났을 때처럼 다음 곡으로", async () => {
  const next = await restore(endRecord(96_000, { queue: ["다음 곡"] }));
  assert.equal(next.currentTrack?.title, "다음 곡");
  assert.deepEqual(next.calls[0], ["play", 0, false]);
  assert.deepEqual(titles(next.previousTracks), ["지금 곡"], "끝난 곡은 기록으로");

  const ring = await restore(endRecord(96_000, { loopMode: "queue", queue: ["다음 곡"] }));
  assert.equal(ring.currentTrack?.title, "다음 곡");
  assert.deepEqual(titles(ring.queue), ["지금 곡"], "대기열 반복이면 맨 뒤로");

  const same = await restore(endRecord(96_000, { loopMode: "track" }));
  assert.equal(same.currentTrack?.title, "지금 곡");
  assert.deepEqual(same.calls[0], ["play", 0, false], "한 곡 반복이면 처음부터");

  const kept = await restore(endRecord(94_000, { queue: ["다음 곡"] }));
  assert.deepEqual(kept.calls[0], ["play", 94_000, false], "5초 넘게 남았으면 그 자리");

  const unknown = await restore(endRecord(99_000, { duration: 0 }));
  assert.deepEqual(unknown.calls[0], ["play", 99_000, false], "길이를 모르면 그 자리");

  const live = await restore(endRecord(99_000, { live: true }));
  assert.deepEqual(live.calls[0], ["play", 0, false], "라이브는 위치를 쓰지 않는다");
});

test("복원: 끝난 곡 뒤에 틀 곡이 없으면 음성에 붙지 않고 세션을 지운다(틀 곡 없음)", async () => {
  const { p, sp } = makeRestorePlayer({ connection: null });
  let joins = 0;
  p.voice = fake<Player["voice"]>({ connect: async () => (joins += 1) });
  sessions().saveSession(p.guild.id, { voiceChannelId: "v1", textChannelId: "c1", volume: 80, loopMode: "off", autoplay: null, userPaused: false, positionMs: 99_000 });

  assert.equal(await sp.restoreFromState(endRecord(99_000)), "empty");
  assert.equal(joins, 0);
  assert.equal(p.calls.length, 0);
  assert.equal(sessions().load(p.guild.id), null);
});

test("복원: 지금 곡 없이 대기열만 저장됐으면 첫 곡을 지금 곡으로 올리되 멈춘 채 연다(저절로 틀지 않는다)", async () => {
  const record = fake<RestoredSession>({
    session: { voiceChannelId: "v1", textChannelId: "c1", volume: 80, loopMode: "off", autoplay: null, userPaused: false, positionMs: 0 },
    current: null,
    queue: [
      { title: "첫 곡", url: "https://y/a", duration: 100, requesterId: "u1" },
      { title: "둘째 곡", url: "https://y/b", duration: 100, requesterId: "u1" },
    ],
    history: [],
  });
  const p = await restore(record);
  assert.equal(p.currentTrack?.title, "첫 곡");
  assert.deepEqual(titles(p.queue), ["둘째 곡"]);
  assert.deepEqual(p.calls[0], ["play", 0, true], "멈춘 채 연다");
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
  await restore(makeRecord({ userPaused: true }), (p) => (p.textChannel = fake<GuildTextBasedChannel>(paused)));
  assert.equal(paused.sent.length, 1);
  assert.ok(paused.sent[0].content.startsWith("### 🔄 봇이 복구됐어요\n마지막 일시정지 상태를 유지할게요."), paused.sent[0].content);

  const playing = fakeChannel();
  await restore(makeRecord(), (p) => (p.textChannel = fake<GuildTextBasedChannel>(playing)));
  assert.ok(playing.sent[0].content.startsWith("### 🔄 봇이 복구됐어요\n기록된 마지막 재생 상태를 이어갈게요."), playing.sent[0].content);
});

test("복원: 무엇이 됐나를 돌려준다(이어 재생, 재생할 곡을 열지 못함, 재생할 곡 없음)", async () => {
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

// ── 앞 플레이어가 남긴 세션 위의 새 플레이어(/join 없이 새로 틀기) ──────────

// 앞 플레이어가 /leave 등으로 남긴 세션. requester 는 곡마다 요청자 id
function leftBehind(guildId: string, { current = "OLDcur", queue = ["OLDq1", "OLDq2"], requester = "u1" }: { current?: string; queue?: string[]; requester?: string | ((title: string) => string) } = {}) {
  const who = (title: string) => ({ id: typeof requester === "function" ? requester(title) : requester });
  sessions().saveSession(guildId, { voiceChannelId: "v1", textChannelId: "c1", volume: 100, loopMode: "off", autoplay: null, userPaused: false, positionMs: 61_000 });
  sessions().setCurrent(guildId, { ...t(current), requestedBy: who(current) });
  sessions().append(
    guildId,
    queue.map((title) => ({ ...t(title), requestedBy: who(title) })),
  );
}
const inDb = (guildId: string) => {
  const s = sessions().load(guildId);
  return s ? { current: s.current?.title ?? null, queue: titles(s.queue) } : null;
};

test("새 플레이어가 저장된 세션 위에 처음 쓰면 그 세션을 지우고 새로 쓴다. DB 가 메모리와 같다", () => {
  const { p } = makePlayer();
  leftBehind(p.guild.id);

  trackState.setCurrent(p, t("NEWa"));
  trackState.enqueue(p, [t("NEWb")]);
  trackState.retire(p, p.currentTrack!);
  trackState.shiftNext(p);

  assert.deepEqual(inDb(p.guild.id), { current: "NEWb", queue: [] });
  assert.equal(sessions().load(p.guild.id)?.session.positionMs, 0, "옛 위치도 남지 않는다");
});

test("넘겨받기: 사람이 넣은 곡만 센다(봇이 고른 자동재생 곡 빼고, 저장 때의 지금 곡 포함). 두 번째는 0", () => {
  const { p } = makePlayer({ guild: { id: `g${serial++}-claim`, client: { user: { id: "bot" } } } });
  leftBehind(p.guild.id, { queue: ["OLDq1", "AUTO"], requester: (title) => (title === "AUTO" ? "bot" : "u1") });

  assert.equal(p.trackSink.claimSaved(), 2);
  assert.equal(sessions().load(p.guild.id), null);
  assert.equal(p.trackSink.claimSaved(), 0);
});

test("넘겨받지 않은 플레이어는 남의 세션을 지우지 않는다(버릴 때 비우기, 세션 지우기, 틀 곡 없는 저장)", () => {
  const { p, sp } = makePlayer();
  leftBehind(p.guild.id);

  trackState.reset(p, { history: true }); // 버릴 때(dispose) 메모리를 비운다
  sp.removeSession();
  sp.saveNow("leave");

  assert.deepEqual(inDb(p.guild.id), { current: "OLDcur", queue: ["OLDq1", "OLDq2"] }, "/join 이 복원할 수 있게 남는다");
  sessions().removeSession(p.guild.id);
});

test("복원한 플레이어는 그 세션을 넘겨받은 것이다. 이어지는 쓰기가 세션을 지우지 않는다", async () => {
  const { p, sp } = makeRestorePlayer();
  leftBehind(p.guild.id);

  await sp.restoreFromState(sessions().load(p.guild.id));
  trackState.enqueue(p, [t("NEW")]);

  assert.deepEqual(inDb(p.guild.id), { current: "OLDcur", queue: ["OLDq1", "OLDq2", "NEW"] });
  sessions().removeSession(p.guild.id);
});

test("위치만 쓰기는 주기 저장에 든 플레이어만. 복원 중(주기 저장 밖)에는 위치를 맞추기 전이라 쓰지 않는다", () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("지금")); // 첫 쓰기로 세션을 넘겨받는다
  sp.saveNow("play");
  const at = () => sessions().load(p.guild.id)?.session.positionMs;
  p.position = 33_000;

  sp.savePosition();
  assert.equal(at(), 0, "주기 저장 밖");
  sp.startPeriodicSave();
  try {
    sp.savePosition();
    assert.equal(at(), 33_000);
  } finally {
    sp.stopPeriodicSave();
  }
});

test("재생을 시작한 차례(주기 저장에 넣고, 재생 저장으로 세션을 넘겨받음) 그대로면 멈춘 위치를 쓴다", async () => {
  const { p, sp } = makePlayer();
  p.currentTrack = t("지금"); // 미러를 거치지 않는다. 넘겨받기는 재생 저장이 한다
  sp.startPeriodicSave(); // start-playback 의 차례
  try {
    await sp.save("play");
    p.position = 44_000;
    sp.savePosition();
    assert.equal(sessions().load(p.guild.id)?.session.positionMs, 44_000);
  } finally {
    sp.stopPeriodicSave();
  }
});

test("복원: 종료 중이라 음성에 붙지 않았으면 error 줄 없이 그 원인(bot-shutting-down)을 그대로 던진다", async () => {
  const { p: saved } = makePlayer();
  trackState.setCurrent(saved, t("now"));
  const record = loaded(saved.guild.id);
  const { p, sp } = makeRestorePlayer({ guild: { id: saved.guild.id }, connection: null });
  p.voice = fake<Player["voice"]>({ connect: async () => Promise.reject(codedError("bot-shutting-down", "종료 중")) });
  const start = sink.buffer.at(-1)?.id ?? -1;
  await assert.rejects(sp.restoreFromState(record), { code: "bot-shutting-down" });
  assert.deepEqual(
    sink.buffer.filter((r) => r.id > start && r.level === "error").map((r) => r.text),
    [],
  );
});
