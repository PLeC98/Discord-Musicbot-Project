"use strict";

// src/player/Player.js — 지연 정리 타이머가 "자기가 아직 현행 플레이어인지" 확인하고 움직이는지.
//
// 회귀 대상 (2026-09-08 실서버 관측): 대기열 소진 타이머는 트랙이 끝날 때마다 새로 예약되는데
// 이전 것을 지우지 않아 쌓였다. 그중 하나가 뒤늦게 깨어나면 자기(이미 비워진 구 플레이어)
// 기준으로 조건을 통과하고는 길드 키로 client.players에서 지웠다. 그 사이 새 플레이어가
// 등록돼 재생 중이면 그것이 지워진다 — 소리는 나는데 /nowplaying·대시보드는 "재생 중 없음"이 된다.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { openTempStore } = require("../helpers/tempStore");
const store = openTempStore("registry-guard-");
after(() => store.close());

const config = require("../../config");
const MusicPlayer = require("../../src/player/Player");
const PlaybackState = require("../../src/player/playbackState");
const IdleLeave = require("../../src/player/idleLeave");
const handleTrackEnd = MusicPlayer.prototype.handleTrackEnd;

const GUILD = "g1";
const DELAY = 30; // 실 타이머를 그대로 쓰되 대기 시간만 줄인다 (전역 setTimeout을 갈아끼우면 러너가 멈춘다)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let savedDelay;
before(() => {
  savedDelay = config.bot.leaveDelayQueueEmptyMs;
  config.bot.leaveDelayQueueEmptyMs = DELAY;
});
after(() => {
  config.bot.leaveDelayQueueEmptyMs = savedDelay;
});

// playbackLoop.test.js와 같은 방식 — 코드가 건드리는 것만 나열한 목
function makePlayer(players, current = { title: "곡", duration: 10 }) {
  const p = {
    lifecycle: new PlaybackState(),
    watch: { stopEnd() {}, stopBuffering() {}, stop() {}, scheduleEnd() {}, startBuffering() {} },
    pauseReasons: new Set(),
    currentTrack: current,
    playback: { resource: { playbackDuration: (current?.duration || 0) * 1000 } },
    lastPlaybackPosition: 0,
    currentTrackRetries: 0,
    previousTracks: [],
    loop: false,
    queue: [],
    autoplay: false,
    pendingEndReason: null,
    guild: { id: GUILD, name: "TestGuild", client: { players } },
    cleanupCalls: [],
    releasedResources: 0,
    _trackLabel: MusicPlayer.prototype._trackLabel,
    getCurrentTime: MusicPlayer.prototype.getCurrentTime,
    _isActivePlayer: MusicPlayer.prototype._isActivePlayer,
    releaseAudioProtection() {},
    scheduleStatePersist() {},
    async persistState() {},
    async play() {},
    async updateVoiceStatus() {},
    audioPlayer: { stop() {} },
    cleanup(_isShutdown, reason) {
      this.cleanupCalls.push(reason);
    },
    releaseResources() {
      this.releasedResources++;
    },
  };
  p.idle = new IdleLeave(p); // 대기열 소진 퇴장 타이머는 진짜로 돈다
  return p;
}

test("교체된 플레이어의 타이머는 현행 플레이어를 레지스트리에서 지우지 않는다", async () => {
  const players = new Map();

  const stale = makePlayer(players);
  players.set(GUILD, stale);
  await handleTrackEnd.call(stale, "idle"); // 대기열 소진 → 타이머 예약

  // 그 사이 새 플레이어가 등록되어 재생을 시작한다
  const fresh = makePlayer(players, { title: "재생 중인 곡", duration: 200 });
  players.set(GUILD, fresh);

  await sleep(DELAY * 3); // 구 플레이어의 타이머가 뒤늦게 깨어난다

  assert.equal(players.get(GUILD), fresh, "현행 플레이어가 살아 있어야 한다");
  assert.deepEqual(stale.cleanupCalls, [], "구 플레이어의 cleanup은 공유 음성 연결을 끊는다 — 부르면 안 된다");
  assert.equal(stale.releasedResources, 1, "대신 자기 자원만 정리한다");
});

test("현행 플레이어의 타이머는 정상적으로 정리·해제한다 (기존 동작 보존)", async () => {
  const players = new Map();
  const p = makePlayer(players);
  players.set(GUILD, p);

  await handleTrackEnd.call(p, "idle");
  await sleep(DELAY * 3);

  assert.deepEqual(p.cleanupCalls, ["대기열 소진"]);
  assert.equal(players.has(GUILD), false, "봇이 나가고 레지스트리에서 빠진다");
});

test("/join만 하고 틀지 않아도 같은 타이머로 나간다", async () => {
  const players = new Map();
  const p = makePlayer(players, null);
  players.set(GUILD, p);

  p.idle.scheduleEmpty("곡 없이 대기");
  await sleep(DELAY * 3);

  assert.deepEqual(p.cleanupCalls, ["곡 없이 대기"]);
  assert.equal(players.has(GUILD), false);
});

test("타이머가 깨어났을 때 다시 재생 중이면 아무것도 하지 않는다", async () => {
  const players = new Map();
  const p = makePlayer(players);
  players.set(GUILD, p);

  await handleTrackEnd.call(p, "idle");
  p.currentTrack = { title: "새로 튼 곡", duration: 100 }; // 대기 시간 안에 다시 재생
  await sleep(DELAY * 3);

  assert.deepEqual(p.cleanupCalls, []);
  assert.equal(players.get(GUILD), p);
});

test("타이머는 쌓이지 않는다 — 새로 예약하면 이전 것을 취소한다", async () => {
  const players = new Map();
  const p = makePlayer(players);
  players.set(GUILD, p);

  // 이전 트랙이 남긴 타이머를 흉내낸다. 취소되지 않으면 이게 깨어나 남의 플레이어를 지운다.
  let stalefired = false;
  p.idle.emptyTimer = setTimeout(() => {
    stalefired = true;
  }, DELAY);

  await handleTrackEnd.call(p, "idle");
  await sleep(DELAY * 3);

  assert.equal(stalefired, false, "이전 타이머가 취소돼야 한다");
  assert.deepEqual(p.cleanupCalls, ["대기열 소진"], "새 타이머만 한 번 동작한다");
});
