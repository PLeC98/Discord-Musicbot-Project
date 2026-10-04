// 지연 정리 타이머와 등록부. 버려진 플레이어의 늦은 타이머는 아무것도 하지 않고, 등록부는 같은 플레이어일 때만 뺀다.
//
// 회귀 대상 (2026-09-08 실서버 관측): 대기열 소진 타이머는 트랙이 끝날 때마다 새로 예약되는데
// 이전 것을 지우지 않아 쌓였다. 그중 하나가 뒤늦게 깨어나면 자기(이미 비워진 구 플레이어)
// 기준으로 조건을 통과하고는 길드 키로 등록부에서 지웠다. 그 사이 새 플레이어가
// 등록돼 재생 중이면 그것이 지워진다. 소리는 나는데 /nowplaying·대시보드는 "재생 중 없음"이 된다.

import { test, before, after, type TestContext } from "node:test";
import assert from "node:assert/strict";

import { openTempStore } from "../helpers/temp-store.ts";
import { fakePlayer } from "../helpers/fake.ts";
import * as tracks from "../helpers/tracks.ts";
const store = openTempStore("registry-guard-");
after(() => store.close());

const config = (await import("../../src/config/index.ts")).default;
const Player = (await import("../../src/player/player.ts")).Player;
const PlaybackState = (await import("../../src/player/playback-state.ts")).PlaybackState;
const IdleLeave = (await import("../../src/player/idle-leave.ts")).IdleLeave;
const { PlayerRegistry } = await import("../../src/player/registry.ts");
const playerEvents = await import("../../src/player/events.ts");
const sink = (await import("../../src/infra/log/sink.ts")).default;
const logger = (await import("../../src/infra/log/logger.ts")).default;
const onTrackEnd = Player.prototype.onTrackEnd;

const GUILD = "g1";
const DELAY = 30; // 실 타이머를 그대로 쓰되 대기 시간만 줄인다 (전역 setTimeout을 갈아끼우면 러너가 멈춘다)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let savedDelay = 0;
before(() => {
  savedDelay = config.bot.leaveDelayQueueEmptyMs;
  config.bot.leaveDelayQueueEmptyMs = DELAY;
});
after(() => {
  config.bot.leaveDelayQueueEmptyMs = savedDelay;
});

// playback-loop.test.ts와 같은 방식 — 코드가 건드리는 것만 나열한 목
function makePlayer(current: { title: string; duration: number } | null = { title: "곡", duration: 10 }) {
  const p = fakePlayer({
    lifecycle: new PlaybackState(),
    watch: { stopOverflow() {}, stopBuffering() {}, stop() {}, startOverflow() {}, startBuffering() {} },
    pauseReasons: new Set(),
    currentTrack: current,
    playback: { resource: { playbackDuration: (current?.duration || 0) * 1000 } },
    lastPlaybackPosition: 0,
    retry: { used: 0, stalled: 0 },
    failedTracks: 0,
    failedLabels: [],
    _laterEnd: null,
    _runLaterEnd: Player.prototype._runLaterEnd,
    _resetFailures: Player.prototype._resetFailures,
    previousTracks: [],
    loop: false,
    queue: [],
    autoplay: false,
    _endReason: null,
    _stopWith: Player.prototype._stopWith,
    guild: { id: GUILD, name: "TestGuild" },
    disposeCalls: [] as string[],
    _trackLabel: Player.prototype._trackLabel,
    getCurrentTime: Player.prototype.getCurrentTime,
    _describeEnd: Player.prototype._describeEnd,
    _recoverDrop: Player.prototype._recoverDrop,
    _countFailure: Player.prototype._countFailure,
    _playNext: Player.prototype._playNext,
    _continueAutoplay: Player.prototype._continueAutoplay,
    finishQueue: Player.prototype.finishQueue,
    releaseAudioProtection() {},
    scheduleStatePersist() {},
    async persistState() {},
    async play() {},
    async updateVoiceStatus() {},
    audioPlayer: { stop() {} },
    // 진짜 dispose 처럼 버린 단계로 옮기고 알린다(등록부는 알림을 듣고 뺀다)
    async dispose({ reason }: { reason: string }) {
      if (this.lifecycle.disposed) return;
      this.disposeCalls.push(reason);
      this.lifecycle.to("disposed", reason);
      playerEvents.disposed(this as unknown as InstanceType<typeof Player>, reason);
    },
  });
  p.idle = new IdleLeave(p); // 대기열 소진 퇴장 타이머는 진짜로 돈다
  return p;
}

// 버려진 플레이어를 스스로 빼는 등록부(운영과 같다). 시험이 끝나면 알림 듣기를 뗀다
function registry(t: TestContext) {
  const players = new PlayerRegistry();
  t.after(players.followDisposals());
  return players;
}

test("버려진 플레이어의 늦은 대기열 소진 타이머는 아무것도 하지 않는다. 새 플레이어는 등록부에 남는다", async (t) => {
  const players = registry(t);
  const stale = makePlayer();
  players.set(GUILD, stale);
  await onTrackEnd.call(stale, "idle"); // 대기열 소진 → 타이머 예약

  // 교체: 옛 플레이어는 버려졌는데 타이머가 늦게 깨어나는 경우를 흉내 낸다(타이머는 일부러 두었다)
  stale.lifecycle.to("disposed");
  const fresh = makePlayer({ title: "재생 중인 곡", duration: 200 });
  players.set(GUILD, fresh);

  await sleep(DELAY * 3);

  assert.equal(players.get(GUILD), fresh, "현행 플레이어가 살아 있어야 한다");
  assert.deepEqual(stale.disposeCalls, [], "버려진 플레이어를 다시 버리지 않는다(쥔 음성 연결이 새 플레이어의 것일 수 있다)");
});

test("늦게 버려진 옛 플레이어는 등록부의 새 플레이어를 빼지 않는다. 등록부는 같은 플레이어일 때만 뺀다", async (t) => {
  const players = registry(t);
  const stale = makePlayer();
  players.set(GUILD, stale);
  const fresh = makePlayer({ title: "재생 중인 곡", duration: 200 });
  players.set(GUILD, fresh);

  await stale.dispose({ reason: "늦은 정리", session: "keep" });
  assert.equal(players.get(GUILD), fresh);

  await fresh.dispose({ reason: "정리", session: "remove" });
  assert.equal(players.has(GUILD), false);
});

test("등록부의 해제 줄은 버린 까닭을 남긴다. 빼지 않은 옛 플레이어는 줄이 없다", async (t) => {
  const players = registry(t);
  const stale = makePlayer();
  players.set(GUILD, stale);
  const fresh = makePlayer();
  players.set(GUILD, fresh);
  const level = logger.level; // 등록부 줄은 debug
  logger.level = "debug";
  t.after(() => (logger.level = level));
  const from = sink.buffer.length;

  await stale.dispose({ reason: "늦은 정리", session: "keep" });
  await fresh.dispose({ reason: "inactivity-timeout", session: "remove" });

  const lines = sink.buffer
    .slice(from)
    .map((e) => e.text)
    .filter((text) => text.includes("해제:"));
  assert.deepEqual(
    lines.map((text) => text.slice(text.indexOf("해제:"))),
    ["해제: TestGuild (g1) | 원인=inactivity-timeout"],
  );
});

test("현행 플레이어의 타이머는 버리고, 등록부에서 빠진다", async (t) => {
  const players = registry(t);
  const p = makePlayer();
  players.set(GUILD, p);

  await onTrackEnd.call(p, "idle");
  await sleep(DELAY * 3);

  assert.deepEqual(p.disposeCalls, ["대기열 소진"]);
  assert.equal(players.has(GUILD), false, "봇이 나가고 레지스트리에서 빠진다");
});

test("/join만 하고 틀지 않아도 같은 타이머로 나간다", async (t) => {
  const players = registry(t);
  const p = makePlayer(null);
  players.set(GUILD, p);

  p.idle.scheduleEmpty("곡 없이 대기");
  await sleep(DELAY * 3);

  assert.deepEqual(p.disposeCalls, ["곡 없이 대기"]);
  assert.equal(players.has(GUILD), false);
});

test("타이머가 깨어났을 때 다시 재생 중이면 아무것도 하지 않는다", async (t) => {
  const players = registry(t);
  const p = makePlayer();
  players.set(GUILD, p);

  await onTrackEnd.call(p, "idle");
  p.currentTrack = tracks.youtube("aaaaaaaaaaa", { title: "새로 튼 곡", duration: 100 }); // 대기 시간 안에 다시 재생
  await sleep(DELAY * 3);

  assert.deepEqual(p.disposeCalls, []);
  assert.equal(players.get(GUILD), p);
});

test("타이머는 쌓이지 않는다. 새로 예약하면 이전 것을 취소한다", async (t) => {
  const players = registry(t);
  const p = makePlayer();
  players.set(GUILD, p);

  // 이전 트랙이 남긴 타이머를 흉내낸다. 취소되지 않으면 이게 깨어나 남의 플레이어를 지운다.
  let stalefired = false;
  p.idle.emptyTimer = setTimeout(() => {
    stalefired = true;
  }, DELAY);

  await onTrackEnd.call(p, "idle");
  await sleep(DELAY * 3);

  assert.equal(stalefired, false, "이전 타이머가 취소돼야 한다");
  assert.deepEqual(p.disposeCalls, ["대기열 소진"], "새 타이머만 한 번 동작한다");
});
