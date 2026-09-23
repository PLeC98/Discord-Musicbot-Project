"use strict";

// src/player/sessionMirror.js — 트랙 변경을 DB로 옮기는 거울, 세션 행, 복원.
// 임시 DB로 연다 — 운영 DB(database/cache.db)는 건드리지 않는다.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");

const DB_PATH = path.join(os.tmpdir(), `musicbot-session-test-${process.pid}.db`);
const removeDb = () => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(DB_PATH + suffix, { force: true });
};

const CacheManager = require("../../src/store/cacheManager");
const SessionPersistence = require("../../src/player/sessionMirror");
const trackState = require("../../src/player/trackState");

before(() => {
  removeDb();
  CacheManager.initialize(DB_PATH);
});

after(() => {
  CacheManager.close();
  removeDb();
});

let guildSerial = 0;
function makePlayer(overrides = {}) {
  const p = {
    guild: { id: `g${guildSerial++}` },
    voiceChannel: { id: "v1" },
    textChannel: null,
    volume: 100,
    loop: false,
    autoplay: false,
    paused: false,
    pauseReasons: new Set(),
    currentTrackStartOffsetMs: 0,
    requesterId: null,
    nowPlayingMessage: null,
    position: 0,
    getCurrentTime() {
      return this.position;
    },
    ...overrides,
  };
  trackState.init(p);
  const sp = new SessionPersistence(p);
  p.trackSink = sp;
  return { p, sp };
}

let serial = 0;
const t = (title = `t${serial++}`) => ({ title, url: `https://y/${title}`, audioSourceKey: `yt:${title}` });
const titles = (arr) => arr.map((x) => x.title);
const memory = (p) => ({ current: p.currentTrack?.title ?? null, queue: titles(p.queue), history: titles(p.previousTracks) });

function stored(guildId) {
  const s = CacheManager.sessions.load(guildId);
  if (!s) return { current: null, queue: [], history: [] };
  return { current: s.current?.title ?? null, queue: titles(s.queue), history: titles(s.history) };
}

function rng(seed) {
  let x = seed >>> 0;
  return (n) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return Math.floor((x / 2 ** 32) * n);
  };
}

// ── 거울 ──

test("trackState의 모든 변경이 DB에 그대로 옮겨진다 — 무작위 1500회", () => {
  const { p } = makePlayer();
  const pick = rng(915);
  const realRandom = Math.random;
  Math.random = () => pick(1_000_000) / 1_000_000;

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
    () => trackState.removeAt(p, pick(p.queue.length + 1)),
    () => trackState.move(p, pick(p.queue.length + 1), pick(p.queue.length + 1)),
    () => trackState.shuffle(p),
    () => p.queue.length > 0 && trackState.insertAfter(p, p.queue[pick(p.queue.length)].title, [t(), t()]),
    () => trackState.setCurrent(p, pick(3) === 0 ? null : t()),
  ];
  const rare = [() => trackState.clearQueue(p), () => trackState.reset(p, { history: pick(2) === 0 }), () => trackState.restore(p, { current: t(), queue: [t(), t()], history: [t()] })];

  try {
    for (let step = 0; step < 1500; step++) {
      (pick(30) === 0 ? rare[pick(rare.length)] : ops[pick(ops.length)])();
      assert.deepEqual(stored(p.guild.id), memory(p), `조작 ${step}번째에서 어긋남`);
    }
  } finally {
    Math.random = realRandom;
  }
});

test("DB가 메모리와 어긋나 있으면 다음 변경에서 통째로 다시 맞춘다", () => {
  const { p, sp } = makePlayer();
  trackState.enqueue(p, [t("A"), t("B"), t("C")]);
  CacheManager.db.prepare("DELETE FROM session_tracks WHERE guild_id = ? AND slot = 'queue'").run(p.guild.id);

  trackState.removeAt(p, 1); // DB에는 지울 행이 없다
  assert.deepEqual(stored(p.guild.id), memory(p));
  assert.equal(sp.dirty, false);
});

test("쓰기가 실패하면 표시해 두고 다음 변경에서 통째로 다시 쓴다", () => {
  const { p, sp } = makePlayer();
  const store = CacheManager.sessions;
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

test("나가며 저장한 뒤에는 메모리를 비워도 저장한 트랙이 남는다", async () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("now"));
  trackState.enqueue(p, [t("next")]);

  await sp.persistState("leave", true);
  trackState.reset(p);

  const s = CacheManager.sessions.load(p.guild.id);
  assert.equal(s.current.title, "now", "구 코드 구조였다면 비우는 순간 방금 저장한 트랙이 지워진다");
  assert.deepEqual(titles(s.queue), ["next"]);
});

// ── 세션 행 ──

test("세션 행: 반복 false는 off로, 일시정지는 수동 사유만 남긴다", async () => {
  const { p, sp } = makePlayer({ paused: true, pauseReasons: new Set(["alone"]), volume: 30, position: 42_000 });
  trackState.setCurrent(p, t("x"));
  await sp.persistState();

  let { session } = CacheManager.sessions.load(p.guild.id);
  assert.equal(session.loopMode, "off");
  assert.equal(session.autoplay, null);
  assert.equal(session.pausedManual, false, "혼자 남아 멈춘 것은 복원 대상이 아니다");
  assert.equal(session.positionMs, 42_000);
  assert.equal(session.volume, 30);

  p.loop = "queue";
  p.autoplay = "kpop";
  p.pauseReasons.add("manual");
  await sp.persistState();
  ({ session } = CacheManager.sessions.load(p.guild.id));
  assert.equal(session.loopMode, "queue");
  assert.equal(session.autoplay, "kpop");
  assert.equal(session.pausedManual, true);
});

test("곡도 대기열도 없으면 세션을 지운다", async () => {
  const { p, sp } = makePlayer();
  trackState.setCurrent(p, t("x"));
  await sp.persistState();
  trackState.setCurrent(p, null);
  await sp.persistState();
  assert.equal(CacheManager.sessions.load(p.guild.id), null);
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
    assert.equal(CacheManager.sessions.load(a.p.guild.id).session.positionMs, 11_000);
    assert.equal(CacheManager.sessions.load(b.p.guild.id).session.positionMs, 20_000, "멈춘 동안 위치는 그대로다");
  } finally {
    a.sp.stopStateSync();
    b.sp.stopStateSync();
  }
});

// ── 복원 ──

function makeRestorePlayer(overrides = {}) {
  const { p, sp } = makePlayer({ connection: { state: {} }, calls: [], ...overrides }); // 연결 재수립 경로 생략
  p.play = async function (_, ms) {
    // play()는 시작 직후 pauseReasons를 보고 즉시 일시정지 — 그 시점의 사유 유무를 기록
    this.calls.push(["play", ms, this.pauseReasons.has("manual")]);
  };
  p.pauseFor = function (reason) {
    this.pauseReasons.add(reason);
    this.paused = true;
    this.calls.push(["pauseFor", reason]);
  };
  return { p, sp };
}

function makeRecord(sessionOverrides = {}, current = { title: "곡", url: "https://y/1", duration: 100, requesterId: "u1" }) {
  return {
    session: { voiceChannelId: "v1", textChannelId: "c1", volume: 80, loopMode: "off", autoplay: null, pausedManual: false, positionMs: 30_000, startOffsetMs: 0, requesterId: null, ...sessionOverrides },
    current,
    queue: [],
    history: [],
  };
}

async function restore(record, setup = () => {}) {
  const { p, sp } = makeRestorePlayer();
  setup(p);
  await sp.restoreFromState(record);
  sp.cancelStateSave(); // scheduleStatePersist("restored") 타이머 정리
  return p;
}

test("복원: 수동 일시정지 세션은 멈춘 상태로 (L-01 회귀 — 구 코드는 무조건 자동 재생)", async () => {
  const p = await restore(makeRecord({ pausedManual: true }));
  assert.deepEqual(p.calls[0], ["play", 30_000, true], "play 시작 시점에 이미 manual 사유가 걸려 즉시 일시정지");
  assert.equal(p.paused, true);
  assert.ok(p.pauseReasons.has("manual"));
});

test("복원: 재생 중이던 세션은 그대로 재생하고 설정을 되살린다", async () => {
  const p = await restore(makeRecord({ volume: 80, loopMode: "off", autoplay: "rock" }));
  assert.deepEqual(p.calls, [["play", 30_000, false]]);
  assert.equal(p.paused, false);
  assert.equal(p.volume, 80);
  assert.equal(p.loop, false, "DB의 off는 메모리에서 false다 — 대시보드가 참/거짓으로 읽는다");
  assert.equal(p.autoplay, "rock");
});

test("복원: 요청자는 id만 되살린다", async () => {
  const p = await restore(makeRecord());
  assert.deepEqual(p.currentTrack.requestedBy, { id: "u1" });
  assert.equal("requesterId" in p.currentTrack, false, "저장용 필드를 트랙에 남기지 않는다");
});

test("복원: DB에서 읽은 트랙을 다시 쓰지 않고, 이어지는 변경은 증분으로 그대로 맞는다", async () => {
  const { p: saved } = makePlayer();
  trackState.enqueue(saved, [t("a"), t("b"), t("c"), t("d")]);
  trackState.setCurrent(saved, t("now"));
  trackState.retire(saved, t("old"), { requeue: true });
  const record = CacheManager.sessions.load(saved.guild.id);

  const store = CacheManager.sessions;
  const real = store.replaceTracks;
  let rewrites = 0;
  store.replaceTracks = (...args) => {
    rewrites++;
    return real.apply(store, args);
  };
  try {
    const { p, sp } = makeRestorePlayer({ guild: { id: saved.guild.id } });
    await sp.restoreFromState(record);
    sp.cancelStateSave();
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

// 미리 뽑아 둔 자동재생 곡은 되살리지 않는다 — 사용자가 고른 곡만 세션에 남는 것이 자연스럽고,
// 장르는 함께 복원되므로 첫 곡이 시작될 때 다시 뽑힌다. 요청자가 봇인 행으로 가른다.
test("복원: 자동재생이 미리 뽑아 둔 곡은 되살리지 않고 DB도 맞춘다", async () => {
  const BOT = "bot1";
  const { p: saved } = makePlayer();
  trackState.setCurrent(saved, t("now"));
  trackState.enqueue(saved, [t("내곡1"), { ...t("자동곡"), requestedBy: { id: BOT } }, t("내곡2")]);
  const record = CacheManager.sessions.load(saved.guild.id);

  const { p, sp } = makeRestorePlayer({ guild: { id: saved.guild.id, client: { user: { id: BOT } } } });
  await sp.restoreFromState(record);
  sp.cancelStateSave();

  assert.deepEqual(titles(p.queue), ["내곡1", "내곡2"]);
  assert.deepEqual(stored(p.guild.id), memory(p), "걸러낸 뒤 DB를 맞추지 않으면 이후 증분 쓰기가 엉뚱한 곡을 건드린다");
});

// 봇 id를 모르면(클라이언트가 아직 없음) 거르지 않는다 — 사용자 곡을 실수로 버리는 쪽이 더 나쁘다.
test("복원: 봇 id를 알 수 없으면 대기열을 그대로 되살린다", async () => {
  const { p: saved } = makePlayer();
  trackState.setCurrent(saved, t("now"));
  trackState.enqueue(saved, [t("내곡"), { ...t("자동곡"), requestedBy: { id: "bot1" } }]);
  const record = CacheManager.sessions.load(saved.guild.id);

  const { p, sp } = makeRestorePlayer({ guild: { id: saved.guild.id } }); // client 없음
  await sp.restoreFromState(record);
  sp.cancelStateSave();

  assert.deepEqual(titles(p.queue), ["내곡", "자동곡"]);
});

test("복원: 상한을 넘는 대기열은 잘라내고 DB도 같이 줄인다", async () => {
  const config = require("../../config");
  const realMax = config.bot.maxQueueSize;
  const { p: saved } = makePlayer();
  trackState.setCurrent(saved, t("now"));
  trackState.enqueue(
    saved,
    Array.from({ length: 30 }, () => t()),
  );
  const record = CacheManager.sessions.load(saved.guild.id);

  config.bot.maxQueueSize = 25;
  try {
    const { p, sp } = makeRestorePlayer({ guild: { id: saved.guild.id } });
    await sp.restoreFromState(record);
    sp.cancelStateSave();
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

function fakeChannel() {
  const sent = [];
  return {
    id: "c1",
    sent,
    async send({ content }) {
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

test("복원 안내: 멈춘 채 되살렸으면 재개됐다고 하지 않는다", async () => {
  const paused = fakeChannel();
  await restore(makeRecord({ pausedManual: true }), (p) => (p.textChannel = paused));
  assert.equal(paused.sent.length, 1);
  assert.ok(paused.sent[0].content.startsWith("⏸️ 일시정지 상태로 복원됨"), paused.sent[0].content);

  const playing = fakeChannel();
  await restore(makeRecord(), (p) => (p.textChannel = playing));
  assert.ok(playing.sent[0].content.startsWith("▶️ 음악 재개됨"), playing.sent[0].content);
});

test("복원 안내는 잠시 뒤 지운다", async () => {
  const { AUTO_DELETE_MS } = require("../../src/usecases/responders");
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const channel = fakeChannel();
    await restore(makeRecord(), (p) => (p.textChannel = channel));
    assert.equal(channel.sent[0].deleted, false);

    mock.timers.tick(AUTO_DELETE_MS);
    assert.equal(channel.sent[0].deleted, true);
  } finally {
    mock.timers.reset();
  }
});
