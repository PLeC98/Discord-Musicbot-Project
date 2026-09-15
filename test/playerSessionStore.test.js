"use strict";

// src/playerSessionStore.js — 메모리 배열(trackState)과 DB 행이 같은 순서를 유지하는가.
// 저장소는 행을 위치로 찾으므로, 둘이 한 번이라도 어긋나면 이후의 모든 증분 쓰기가 엉뚱한 행을 건드린다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const trackState = require("../src/trackState");
const { PlayerSessionStore, createTables, GAP, SEQ_LIMIT } = require("../src/playerSessionStore");

const G = "g1";

function open() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createTables(db);
  return { db, store: new PlayerSessionStore(db) };
}

let serial = 0;
const t = (title = `t${serial++}`) => ({ title, url: `https://y/${title}`, audioSourceKey: `yt:${title}` });
const titles = (arr) => arr.map((x) => x.title);

function snapshot(p) {
  return { current: p.currentTrack?.title ?? null, queue: titles(p.queue), history: titles(p.previousTracks) };
}

function stored(store) {
  const s = store.load(G);
  if (!s) return { current: null, queue: [], history: [] };
  return { current: s.current?.title ?? null, queue: titles(s.queue), history: titles(s.history) };
}

// 시드 고정 난수 — 실패하면 같은 순서로 재현된다
function rng(seed) {
  let x = seed >>> 0;
  return (n) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return Math.floor((x / 2 ** 32) * n);
  };
}

test("무작위 조작 2000회 — 매 조작 뒤 메모리와 DB의 슬롯별 순서가 같다", () => {
  const { store } = open();
  const p = {};
  trackState.init(p);
  const pick = rng(20260915);

  const ops = [
    () => {
      const ts = Array.from({ length: 1 + pick(3) }, () => t());
      trackState.enqueue(p, ts);
      store.append(G, ts);
    },
    () => {
      const ts = Array.from({ length: 1 + pick(2) }, () => t());
      trackState.enqueue(p, ts, { front: true });
      store.append(G, ts, { front: true });
    },
    () => {
      if (p.queue.length === 0) return;
      trackState.shiftNext(p);
      store.take(G, 0);
    },
    () => {
      // 점프와 같은 모양 — 아무 위치의 곡이 현재곡이 된다
      if (p.queue.length === 0) return;
      const i = pick(p.queue.length);
      trackState.move(p, i, 0);
      trackState.shiftNext(p);
      store.move(G, i, 0);
      store.take(G, 0);
    },
    () => {
      if (!p.currentTrack) return;
      const requeue = pick(2) === 0;
      trackState.retire(p, p.currentTrack, { requeue });
      store.retire(G, p.currentTrack, { requeue });
    },
    () => {
      if (p.queue.length === 0) return;
      const i = pick(p.queue.length);
      trackState.removeAt(p, i);
      store.removeAt(G, i);
    },
    () => {
      if (p.queue.length < 2) return;
      const from = pick(p.queue.length);
      const to = pick(p.queue.length);
      trackState.move(p, from, to);
      store.move(G, from, to);
    },
    () => {
      const track = pick(3) === 0 ? null : t();
      trackState.setCurrent(p, track);
      store.setCurrent(G, track);
    },
  ];
  const rare = [
    () => {
      trackState.clearQueue(p);
      store.clearQueue(G);
    },
    () => {
      const history = pick(2) === 0;
      trackState.reset(p, { history });
      store.reset(G, { history });
    },
  ];

  for (let step = 0; step < 2000; step++) {
    const op = pick(40) === 0 ? rare[pick(rare.length)] : ops[pick(ops.length)];
    op();
    assert.deepEqual(stored(store), snapshot(p), `조작 ${step}번째에서 어긋남`);
  }
});

test("같은 자리에 계속 끼우면 간격이 닳는다 — 재번호 후에도 순서가 맞다", () => {
  const { store } = open();
  const p = {};
  trackState.init(p);
  const ts = [t("A"), t("B"), t("C")];
  trackState.enqueue(p, ts);
  store.append(G, ts);

  let renumbered = 0;
  const real = store._renumber.bind(store);
  store._renumber = (...args) => {
    renumbered++;
    return real(...args);
  };

  // 마지막 곡을 1번 자리로 — 매번 맨 앞 곡 바로 뒤의 간격이 반으로 준다
  for (let i = 0; i < 40; i++) {
    trackState.move(p, 2, 1);
    store.move(G, 2, 1);
    assert.deepEqual(stored(store).queue, titles(p.queue), `${i}번째 이동`);
  }
  assert.ok(renumbered >= 1, "10억 간격은 약 30번 만에 닳아야 한다");
});

test("정밀도 한계 가까이 가면 뒤에 붙이기 전에 재번호한다", () => {
  const { db, store } = open();
  store.append(G, [t("A"), t("B")]);
  db.prepare("UPDATE session_tracks SET seq = seq + ? WHERE guild_id = ?").run(SEQ_LIMIT, G);

  store.append(G, [t("C")]);
  const seqs = db
    .prepare("SELECT seq FROM session_tracks WHERE guild_id = ? AND slot = 'queue' ORDER BY seq")
    .all(G)
    .map((r) => r.seq);
  assert.deepEqual(stored(store).queue, ["A", "B", "C"]);
  assert.ok(seqs.every((s) => Number.isSafeInteger(s)));
  assert.deepEqual(seqs, [0, GAP, 2 * GAP]);
});

test("기록은 상한을 넘으면 가장 오래된 것부터 버린다", () => {
  const { store } = open();
  for (let i = 0; i < trackState.HISTORY_MAX + 7; i++) store.retire(G, t(`h${i}`));
  const { history } = store.load(G);
  assert.equal(history.length, trackState.HISTORY_MAX);
  assert.equal(history[0].title, "h7");
});

test("트랙 필드: 저장한 그대로 돌아오고, 요청자는 id만 남는다", () => {
  const { store } = open();
  const track = {
    id: "vid1",
    title: "노래",
    url: "https://youtube.com/watch?v=vid1",
    duration: "185",
    thumbnail: "https://img/1.jpg",
    artist: "가수",
    album: "앨범",
    uploader: "채널",
    platform: "youtube",
    audioSourceKey: "yt:vid1",
    youtubeUrl: "https://youtube.com/watch?v=vid1",
    live: true,
    addedAt: 1720000000000,
    requestedBy: { id: "u1", username: "someone" },
  };
  store.setCurrent(G, track);

  assert.deepEqual(store.load(G).current, {
    id: "vid1",
    title: "노래",
    url: "https://youtube.com/watch?v=vid1",
    duration: 185,
    thumbnail: "https://img/1.jpg",
    artist: "가수",
    album: "앨범",
    uploader: "채널",
    platform: "youtube",
    audioSourceKey: "yt:vid1",
    youtubeUrl: "https://youtube.com/watch?v=vid1",
    isLive: true,
    addedAt: 1720000000000,
    requesterId: "u1",
  });
});

test("세션 행: 저장·조회, 위치 갱신은 위치만 바꾼다", () => {
  const { store } = open();
  store.saveSession(G, {
    voiceChannelId: "v1",
    textChannelId: "c1",
    volume: 40,
    loopMode: "queue",
    autoplay: "kpop",
    pausedManual: true,
    positionMs: 12_345.6,
    startOffsetMs: 1000,
    requesterId: "u1",
    nowPlayingMessageId: "m1",
  });
  store.savePositions([{ guildId: G, positionMs: 99_000, startOffsetMs: 0 }]);

  const { session } = store.load(G);
  assert.equal(session.positionMs, 99_000);
  assert.equal(session.startOffsetMs, 0);
  assert.deepEqual({ ...session, positionMs: undefined, startOffsetMs: undefined, updatedAt: undefined }, { voiceChannelId: "v1", textChannelId: "c1", volume: 40, loopMode: "queue", autoplay: "kpop", pausedManual: true, positionMs: undefined, startOffsetMs: undefined, requesterId: "u1", nowPlayingMessageId: "m1", updatedAt: undefined });
});

test("반복 모드는 세 값만 받는다", () => {
  const { store } = open();
  assert.throws(() => store.saveSession(G, { loopMode: "false" }), /CHECK/);
});

test("세션을 지우면 그 길드의 트랙도 사라지고 다른 길드는 남는다", () => {
  const { store } = open();
  store.append(G, [t("A")]);
  store.append("g2", [t("B")]);
  store.removeSession(G);
  assert.equal(store.load(G), null);
  assert.deepEqual(titles(store.load("g2").queue), ["B"]);
});

test("replaceTracks: 주어진 목록으로 통째로 바꾸고 기록은 상한까지만", () => {
  const { store } = open();
  store.append(G, [t("old")]);
  const history = Array.from({ length: trackState.HISTORY_MAX + 3 }, (_, i) => t(`h${i}`));
  store.replaceTracks(G, { current: t("C"), queue: [t("Q1"), t("Q2")], history });

  const s = store.load(G);
  assert.equal(s.current.title, "C");
  assert.deepEqual(titles(s.queue), ["Q1", "Q2"]);
  assert.equal(s.history.length, trackState.HISTORY_MAX);
  assert.equal(s.history.at(-1).title, `h${trackState.HISTORY_MAX + 2}`);
});

test("liveTrackRefs: 현재곡과 대기열만 — 기록은 지킬 필요가 없다", () => {
  const { store } = open();
  store.setCurrent(G, t("now"));
  store.append(G, [t("next")]);
  store.retire(G, t("past"));
  const keys = store
    .liveTrackRefs()
    .map((r) => r.audioSourceKey)
    .sort();
  assert.deepEqual(keys, ["yt:next", "yt:now"]);
});

test("loadAll: 트랙이 없는 세션도 빈 목록으로 돌아온다", () => {
  const { store } = open();
  store.saveSession("idle", { voiceChannelId: "v", textChannelId: "c" });
  store.append(G, [t("A")]);
  const all = Object.fromEntries(store.loadAll().map((s) => [s.guildId, s]));
  assert.deepEqual(all.idle.queue, []);
  assert.equal(all.idle.current, null);
  assert.deepEqual(titles(all[G].queue), ["A"]);
});
