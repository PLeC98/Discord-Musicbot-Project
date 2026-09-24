// MusicPlayer 의 곡 종료 · 정지 · 정리 · 오류 처리 · 조작의 지금 동작을 고정한다(구조 리팩터링 0단계).
//
// playerPlay.test.js 와 같은 하네스로 진짜 플레이어를 세운다. 옳고 그름이 아니라 "지금 이렇게 한다"를 적는다.
// 리팩터링이 재생 상태를 한 칸으로 모으고 곡별 객체를 따로 떼어 낼 때 무엇이 바뀌었는지 드러나게 하려는 것이다.

import panelEvents from "../helpers/panelEvents.ts";
import * as playerEvents from "../../src/player/events.ts";
import playerNotices from "../../src/ui/playerNotices.ts";
import type { AudioResource } from "@discordjs/voice";
import type { Client, VoiceBasedChannel } from "discord.js";
import type { MusicPlayer } from "../../src/player/Player.ts";
import type { CurrentPlayback } from "../../src/player/currentPlayback.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake } from "../helpers/fake.ts";

const { recordPanel } = panelEvents;
import h from "../helpers/playerHarness.ts";
import * as audioCache from "../../src/store/audioCache.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as autoplayRoute from "../../src/autoplay/route.ts";
import * as voiceChannelStatus from "../../src/player/voiceChannelStatus.ts";

const { calls, AudioPlayerStatus } = h;

beforeEach(() => h.reset());

const yt = (await import("../helpers/tracks.ts")).default.youtube;

// 플레이어가 알린 일은 진짜 문장 보내기(ui/playerNotices)로 채널에 간다. 조립(main.js)이 거는 것과 같다
playerEvents.on("notice", playerNotices.sendNotice);
const tick = (ms = 0) => new Promise((done) => setTimeout(done, ms));

// 받아 둔 곡으로 만든다. 다음 곡을 틀 때 스트림 없이 파일 갈래로 가게 한다
function cached(id: string, extra?: Partial<QueuedTrack>) {
  const track = yt(id, extra);
  h.seedCache(`yt:${id}`, track);
  return track;
}

// 재생 패널 관리자 대신. 무엇을 불렀는지만 남긴다
// 이 플레이어가 화면에 알린 것(알림을 옛 화면 가짜의 기록 모양으로)
const embeds = (player: MusicPlayer) => recordPanel({ player });

// 재생 상태 가짜. 시험이 보는 칸만
const playback = (fields: object) => fake<CurrentPlayback>(fields);

// 재생이 끝난 곡 하나를 세운다. 리소스의 재생량으로 "어디까지 틀었나"를 정한다. extra 는 재생 상태에 더할 칸
function playing(player: MusicPlayer, track: QueuedTrack, playedMs = track.duration * 1000, extra: object = {}) {
  player.currentTrack = track;
  player.playback = playback({ resource: { playbackDuration: playedMs, playStream: { destroy() {} }, volume: { setVolume() {} } }, ...extra });
  return track;
}

// 재생 · 곡 종료 · 오류 처리 · 자동재생을 시험이 정할 수 있는 플레이어. 정하지 않은 것은 진짜로 돈다
class Scripted extends h.MusicPlayer {
  playAs: ((seekMs: number) => unknown) | null = null;
  endAs: ((reason: string) => unknown) | null = null;
  errorAs: ((error: Error) => unknown) | null = null;
  autoplayAs: (() => Promise<boolean>) | null = null;

  async play(seekMs = 0) {
    if (!this.playAs) return super.play(seekMs);
    await this.playAs(seekMs);
    return { ok: true as const, track: this.currentTrack };
  }
  async handleTrackEnd(reason = "idle") {
    if (!this.endAs) return super.handleTrackEnd(reason);
    await this.endAs(reason);
  }
  async handleError(error: unknown, opts: { tell?: boolean } = {}) {
    if (!this.errorAs) return super.handleError(error, opts);
    await this.errorAs(error as Error);
  }
  async handleAutoplay() {
    return this.autoplayAs ? this.autoplayAs() : super.handleAutoplay();
  }
}
const scripted = () => h.makePlayer({ as: Scripted });

// ── 곡이 끝났을 때 ─────────────────────────────────────────────────────

test("끝까지 튼 곡은 기록으로 가고 대기열 다음 곡을 처음부터 튼다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  const done = playing(p, yt("aaaaaaaaaaa"), undefined, { startOffsetMs: 5000 });
  const next = cached("bbbbbbbbbbb");
  p.queue = [next];

  await p.handleTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, next);
  assert.deepEqual(p.queue, []);
  assert.equal(p.previousTracks.at(-1), done);
  assert.equal(p.playback?.startOffsetMs, 0, "다음 곡은 0 부터");
  assert.equal(calls.spawns.length, 1);
  assert.deepEqual(seen, ["update"]);
  assert.deepEqual(calls.sink.slice(0, 2), ["onRetire", "onTake"], "끝난 곡 은퇴 → 다음 곡 꺼냄 순서");
  assert.equal(p.lifecycle.ending, false);
  assert.equal(p.pendingEndReason, null);
});

test("대기열이 비면 현재 곡과 이전 곡 기록을 비우고 패널을 끝내고 세션을 지우고 나갈 예약을 건다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  playing(p, yt("ccccccccccc"));

  await p.handleTrackEnd("idle");
  const leaveTimer = p.idle.emptyTimer;
  h.dispose(p);

  assert.equal(p.currentTrack, null);
  assert.deepEqual(seen, ["end:queue-end"]);
  assert.ok(calls.persists.includes("remove"));
  assert.ok(leaveTimer, "대기열 소진 뒤 나갈 예약");
  assert.deepEqual(p.previousTracks, []);
  assert.ok(calls.sink.includes("onReset"), "기록 비움도 저장소에 반영");
});

test("일찍 끊긴 곡은 끊긴 자리부터 다시 튼다", async () => {
  const p = h.makePlayer();
  const track = cached("ddddddddddd");
  playing(p, track, 30000);
  p.queue = [yt("eeeeeeeeeee")];

  await p.handleTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, track, "같은 곡");
  assert.equal(p.currentTrackRetries, 1);
  assert.equal(p.playback?.startOffsetMs, 30000);
  assert.equal(p.queue.length, 1, "대기열은 그대로");
  assert.equal(p.previousTracks.length, 0, "기록에 넣지 않는다");
});

test("다시 틀기를 두 번 써도 끊기면 포기하고 다음 곡으로 간다", async () => {
  const p = h.makePlayer();
  const track = playing(p, yt("fffffffffff"), 30000);
  const next = cached("ggggggggggg");
  p.queue = [next];
  p._retryTrack = track;
  p.currentTrackRetries = 2;

  await p.handleTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, next);
  assert.equal(p.previousTracks.at(-1), track);
});

test("손으로 넘긴 곡은 일찍 끝나도 다시 틀지 않는다", async () => {
  for (const reason of ["skip", "stop", "previous", "jump", "sponsorblock"]) {
    h.reset();
    const p = scripted();
    playing(p, yt("hhhhhhhhhhh"), 1000);
    let replays = 0;
    p.playAs = async () => {
      replays += 1;
    };

    await p.handleTrackEnd(reason);
    h.dispose(p);

    assert.equal(p.currentTrackRetries, 0, reason);
    if (reason !== "previous") assert.equal(replays, 0, `${reason}: 대기열이 비었으니 틀 것이 없다`);
  }
});

test("라이브가 0 이 아닌 코드로 끊기면 1초 뒤 주소를 새로 받아 다시 연다", async () => {
  const p = scripted();
  const live = playing(p, yt("iiiiiiiiiii", { isLive: true, duration: 0 }), 60000, { live: true, liveExitCode: 1 });
  const seeks: number[] = [];
  p.playAs = async (seekMs) => {
    seeks.push(seekMs);
  };

  const started = Date.now();
  await p.handleTrackEnd("idle");
  h.dispose(p);

  assert.deepEqual(seeks, [0], "라이브는 늘 0 으로 연다");
  assert.ok(Date.now() - started >= 900, "재시도 횟수 × 1초를 기다린다");
  assert.equal(p.currentTrack, live);
  assert.equal(p.currentTrackRetries, 1);
});

test("라이브 다시 열기를 다섯 번 쓰면 다음 곡으로 넘긴다", async () => {
  const p = h.makePlayer();
  const live = playing(p, yt("jjjjjjjjjjj", { isLive: true, duration: 0 }), 60000, { live: true, liveExitCode: 1 });
  p._retryTrack = live;
  p.currentTrackRetries = 5;
  const next = cached("j2jjjjjjjjj");
  p.queue = [next];
  embeds(p);

  await p.handleTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, next);
  assert.equal(p.previousTracks.at(-1), live);
});

test("라이브가 코드 0 으로 끝나면(방송 종료) 다시 열지 않는다", async () => {
  const p = h.makePlayer();
  playing(p, yt("kkkkkkkkkkk", { isLive: true, duration: 0 }), 60000, { live: true, liveExitCode: 0 });
  embeds(p);

  await p.handleTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, null);
  assert.equal(p.currentTrackRetries, 0);
});

test("모르는 자동재생 장르는 끄고 채널에 알린 뒤 대기열 소진으로 간다", async () => {
  const p = h.makePlayer();
  embeds(p);
  const sent = calls.sent;
  playing(p, yt("lllllllllll"));
  p.autoplay = "없는-장르";

  await p.handleTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.autoplay, false);
  assert.equal(sent.length, 1);
  assert.match(sent[0] as string, /없는-장르/);
  assert.equal(p.currentTrack, null);
});

test("넘어가는 중에 또 불리면 아무것도 안 한다", async () => {
  const p = h.makePlayer();
  const track = playing(p, yt("mmmmmmmmmmm"));
  p.lifecycle.ending = true;

  await p.handleTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, track);
  assert.equal(p.previousTracks.length, 0);
});

test("현재 곡이 없는데 끝나면 리소스만 비운다", async () => {
  const p = h.makePlayer();
  p.playback = playback({ resource: { playbackDuration: 0 } });

  await p.handleTrackEnd("stop");
  h.dispose(p);

  assert.equal(p.resource, null);
  assert.equal(calls.persists.includes("remove"), false, "세션은 건드리지 않는다");
});

// ── 오디오 플레이어 이벤트 ──────────────────────────────────────────────

test("Idle 이벤트는 미뤄 둔 종료 원인을 꺼내 60ms 뒤 종료 처리로 넘긴다", async () => {
  const p = scripted();
  const reasons: string[] = [];
  p.endAs = (r) => reasons.push(r);
  p.pendingEndReason = "skip";

  p.audioPlayer.emit(AudioPlayerStatus.Idle);
  assert.equal(p.pendingEndReason, null, "원인은 바로 꺼낸다");
  assert.deepEqual(reasons, [], "처리는 미룬다");
  await tick(90);
  h.dispose(p);

  assert.deepEqual(reasons, ["skip"]);
});

test("Playing 이벤트: 멈춤을 풀고, 멈춤 사유가 있으면 그 자리에서 다시 멈춘다", () => {
  const p = h.makePlayer();
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Playing };
  p.paused = true;

  p.audioPlayer.emit(AudioPlayerStatus.Playing);
  assert.equal(p.paused, false);

  p.pauseReasons.add("alone");
  p.audioPlayer.emit(AudioPlayerStatus.Playing);
  h.dispose(p);
  assert.equal(p.audioPlayer.state.status, AudioPlayerStatus.Paused);
});

test("Paused 이벤트는 멈춤으로 적는다", () => {
  const p = h.makePlayer();

  p.audioPlayer.emit(AudioPlayerStatus.Paused);
  h.dispose(p);

  assert.equal(p.paused, true);
});

test("오디오 오류: stream/network 가 들어간 것은 연결 복구, 나머지는 오류 처리", () => {
  const p = scripted();
  const seen: string[] = [];
  p.errorAs = (e) => seen.push(`error:${e.message}`);
  p.currentTrack = yt("nnnnnnnnnnn");

  p.audioPlayer.emit("error", new Error("stream closed"));
  p.audioPlayer.emit("error", new Error("network down"));
  p.audioPlayer.emit("error", new Error("무언가"));
  p.currentTrack = null;
  p.audioPlayer.emit("error", new Error("stream closed"));
  h.dispose(p);

  assert.deepEqual(calls.recoveries, ["recover", "recover"]);
  assert.deepEqual(seen, ["error:무언가", "error:stream closed"]);
});

// ── 종료 감시 ─────────────────────────────────────────────────────────

test("종료 감시: 길이를 다 채웠으면 watchdog 원인으로 멈춘다", () => {
  const p = h.makePlayer();
  playing(p, yt("ooooooooooo", { duration: 100 }), 99000);
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Playing };

  p.watch.checkEnd();
  h.dispose(p);

  assert.equal(p.pendingEndReason, "watchdog");
  assert.equal(h.fakeAudioOf(p).stops, 1);
  assert.equal(p.watch.endTimer, null);
});

test("종료 감시: Idle 이면 손 떼고, 일시정지면 2초마다 다시 본다, 라이브·곡 없음은 걸지 않는다", () => {
  const p = h.makePlayer();
  const track = playing(p, yt("ppppppppppp"), 1000);

  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Idle };
  p.watch.checkEnd();
  assert.equal(p.watch.endTimer, null);

  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Paused };
  p.watch.checkEnd();
  assert.equal(h.timerDelay(p.watch.endTimer), 2000);
  p.watch.stopEnd();

  track.isLive = true;
  p.watch.checkEnd();
  assert.equal(p.watch.endTimer, null);

  p.currentTrack = null;
  p.watch.checkEnd();
  h.dispose(p);
  assert.equal(p.watch.endTimer, null);
});

// ── 정지 · 나가기 · 정리 ────────────────────────────────────────────────

test("stop(): 대기열 · 현재 곡 · 기록을 비우고 세션을 지우고 연결을 끊는다. 패널 참조는 남긴다", () => {
  const p = h.makePlayer();
  const track = cached("qqqqqqqqqqq");
  p.currentTrack = track;
  p.queue = [yt("rrrrrrrrrrr")];
  p.previousTracks = [yt("sssssssssss")];
  p._protectedAudioKey = "yt:qqqqqqqqqqq";
  audioCache.protect("yt:qqqqqqqqqqq");
  p.pauseReasons.add("manual");

  p.stop();
  h.dispose(p);

  assert.equal(p.currentTrack, null);
  assert.deepEqual(p.queue, []);
  assert.deepEqual(p.previousTracks, []);
  assert.ok(p.textChannel, "부른 쪽이 이어서 패널을 끝낸다");
  assert.deepEqual(calls.persists, ["remove"]);
  assert.equal(p.connection, null);
  assert.equal(h.fakeAudioOf(p).stops, 1);
  assert.equal(p.pendingEndReason, "stop");
  assert.equal(p.pauseReasons.size, 0);
  assert.equal(p._protectedAudioKey, null);
  assert.equal(audioCache._liveKeys().has("yt:qqqqqqqqqqq"), false, "보호를 푼다");
  assert.match(p._endingLabel ?? "", /곡 qqqqqqqqqqq/, "늦게 오는 종료 로그를 위해 이름을 남긴다");
});

test("leaveAndSave(): 먼저 저장하고, stop 처럼 비우고 끊되 세션은 지우지 않는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("ttttttttttt");
  p.queue = [yt("uuuuuuuuuuu")];

  await p.leaveAndSave();
  h.dispose(p);

  assert.deepEqual(calls.persists, ["leave"]);
  assert.equal(p.currentTrack, null);
  assert.deepEqual(p.queue, []);
  assert.equal(p.connection, null);
  assert.equal(p.pendingEndReason, "stop");
});

test("cleanup(): 연결을 부수고 플레이어가 쥔 것을 전부 놓는다", () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  let destroyed = 0;
  const connection = p.connection;
  assert.ok(connection);
  connection.destroy = () => {
    destroyed += 1;
  };
  p.currentTrack = yt("vvvvvvvvvvv");
  p.previousTracks = [yt("wwwwwwwwwww")];

  p.cleanup("시험");
  h.dispose(p);

  assert.equal(destroyed, 1);
  assert.equal(p.connection, null);
  assert.deepEqual(calls.persists, ["remove"]);
  assert.equal(p.currentTrack, null);
  assert.deepEqual(p.previousTracks, [], "기록까지 비운다");
  assert.equal(p.textChannel, null);
  assert.equal(p.voiceChannel, null);
  assert.deepEqual(seen, ["webhook:text1"]);
  assert.equal(p.audioPlayer.listenerCount(AudioPlayerStatus.Idle), 0, "리스너를 뗀다");
});

test("음성 연결이 복구되면 끊긴 위치에서 다시 튼다. 못 틀면 곡을 오류로 끝낸다", async () => {
  const p = scripted();
  const seeks: number[] = [];
  const ends: string[] = [];
  p.playAs = (ms) => seeks.push(ms);
  p.endAs = (r) => ends.push(r);
  p.currentTrack = yt("xxxxxxxxxx1");
  p.playback = playback({ track: p.currentTrack, startOffsetMs: 1000, resource: { playbackDuration: 4000 } });

  await p.onVoiceRecovered();
  assert.deepEqual(seeks, [5000]);

  p.playAs = async () => {
    throw new Error("x");
  };
  await p.onVoiceRecovered();
  assert.deepEqual(ends, ["error"]);

  p.currentTrack = null;
  await p.onVoiceRecovered();
  h.dispose(p);
  assert.deepEqual(ends, ["error"], "곡이 없으면 아무것도 안 한다");
});

// ── 혼자 남았을 때 ────────────────────────────────────────────────────

type Member = { user: { bot: boolean; id: string } };

// 음성 채널에 사람을 둔다. 플레이어가 읽는 칸(members.filter · 권한)만
function voiceChannelWith(player: MusicPlayer, humans: string[]) {
  const all = new Map(humans.map((id): [string, Member] => [id, { user: { bot: false, id } }]));
  const members = Object.assign(all, { filter: (fn: (m: Member) => boolean) => ({ size: [...all.values()].filter(fn).length }) });
  player.guild.channels.cache.set("voice1", fake<VoiceBasedChannel>({ id: "voice1", members, isVoiceBased: () => true, permissionsFor: () => ({ has: () => false }) }));
}

test("혼자 남으면 alone 으로 멈추고, 시간이 다 되도록 아무도 없으면 정리하고 레지스트리에서 뺀다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  voiceChannelWith(p, []);
  p.idle.aloneMs = 0;
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Playing };
  p.currentTrack = yt("xxxxxxxxxxx");

  p.idle.startAlone();
  assert.ok(p.pauseReasons.has("alone"));
  assert.equal(p.audioPlayer.state.status, AudioPlayerStatus.Paused);
  await tick(10);
  h.dispose(p);

  assert.deepEqual(seen, ["end:disconnected", "webhook:text1"]);
  assert.ok(calls.persists.includes("inactivity-timeout"));
  assert.equal(p.connection, null);
  assert.equal(p.guild.client.players.has("g1"), false);
});

test("시간이 됐을 때 사람이 있으면 alone 을 풀고 패널만 갱신한다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  voiceChannelWith(p, ["u1"]);
  p.idle.aloneMs = 0;
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Playing };

  p.idle.startAlone();
  await tick(10);
  h.dispose(p);

  assert.equal(p.pauseReasons.has("alone"), false);
  assert.equal(p.audioPlayer.state.status, AudioPlayerStatus.Playing);
  assert.deepEqual(seen, ["update"]);
  assert.equal(p.guild.client.players.get("g1"), p);
});

test("밀려난 플레이어의 비활성 타이머는 자기 자원만 놓고 현행 플레이어를 건드리지 않는다", async () => {
  const p = h.makePlayer();
  embeds(p);
  voiceChannelWith(p, []);
  const current = fake<MusicPlayer>({});
  p.guild.client.players.set("g1", current);
  p.idle.aloneMs = 0;

  p.idle.startAlone();
  await tick(10);
  h.dispose(p);

  assert.equal(p.guild.client.players.get("g1"), current);
  assert.ok(p.connection, "연결은 현행 플레이어 것일 수 있어 끊지 않는다");
});

test("사람이 돌아오면 예약을 지우고 alone 만 푼다. 다른 멈춤 사유는 남는다", () => {
  const p = h.makePlayer();
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Paused };
  p.pauseReasons.add("manual");
  p.idle.startAlone();

  p.idle.cancelAlone(true);
  h.dispose(p);

  assert.equal(p.idle.aloneTimer, null);
  assert.deepEqual([...p.pauseReasons], ["manual"]);
  assert.equal(p.audioPlayer.state.status, AudioPlayerStatus.Paused, "manual 이 남아 멈춘 채");
});

// ── 오류 처리 ─────────────────────────────────────────────────────────

test("handleError: 대기열이 있으면 알리고 다음 곡을 튼다", async () => {
  const p = h.makePlayer();
  const sent = calls.sent;
  p.currentTrack = yt("yyyyyyyyyyy");
  const next = cached("zzzzzzzzzzz");
  p.queue = [next];

  await p.handleError(new Error("x"), { tell: true });
  h.dispose(p);

  assert.equal(sent.length, 1, "무엇이 잘못됐는지 채널에 알린다");
  assert.match(sent[0] as string, /오류/);
  assert.equal(p.currentTrack, next);
  assert.equal(p.previousTracks.length, 0, "실패한 곡은 기록에 넣지 않는다");
});

test("handleError: 대기열이 비면 현재 곡을 비우고 플레이어를 멈춘다. 알림은 부른 쪽 몫", async () => {
  const p = h.makePlayer();
  const sent = calls.sent;
  p.currentTrack = yt("a0aaaaaaaaa");

  await p.handleError(new Error("x"));
  h.dispose(p);

  assert.equal(p.currentTrack, null);
  assert.equal(h.fakeAudioOf(p).stops, 1);
  assert.deepEqual(sent, []);
});

test("handleError: 자동재생이 고른 곡이 내려갔으면 조용히 표시만 하고 다음 자동재생으로", async () => {
  const p = scripted();
  const sent = calls.sent;
  const gone = yt("b0bbbbbbbbb", { autoplay: true });
  p.currentTrack = gone;
  p.autoplay = "jpop";
  let asked = 0;
  p.autoplayAs = async () => {
    asked += 1;
    return true;
  };

  await p.handleError(new Error("Video unavailable"));
  h.dispose(p);

  assert.ok(autoplayRoute._dead.has("b0bbbbbbbbb"));
  assert.equal(asked, 1);
  assert.equal(p.currentTrack, null);
  assert.deepEqual(sent, []);
});

// ── 조작 ─────────────────────────────────────────────────────────────

test("볼륨은 0~100 으로 자르고 지금 리소스에 바로 건다", () => {
  const p = h.makePlayer();
  let applied: number | null = null;
  p.playback = playback({
    resource: {
      volume: {
        setVolume: (v: number) => {
          applied = v;
        },
      },
    },
  });

  assert.equal(p.setVolume(150), 100);
  assert.equal(applied, 1);
  assert.equal(p.setVolume(-3), 0);
  h.dispose(p);
  assert.deepEqual(calls.persists, ["schedule:volume", "schedule:volume"]);
});

test("대기열 조작: 섞기 · 비우기 · 빼기 · 옮기기 · 합계", () => {
  const p = h.makePlayer();
  const [a, b, c] = [yt("c1ccccccccc", { duration: 10 }), yt("c2ccccccccc", { duration: 20 }), yt("c3ccccccccc", { duration: 0 })];
  p.currentTrack = yt("c0ccccccccc", { duration: 5 });
  p.queue = [a, b, c];

  assert.equal(p.getTotalDuration(), 35);
  assert.deepEqual(p.getQueue().totalTracks, 4);
  assert.equal(p.moveInQueue(0, 2), true);
  assert.deepEqual(p.queue, [b, c, a]);
  assert.equal(p.removeFromQueue(1), c);
  assert.equal(p.removeFromQueue(9), null);
  assert.equal(p.shuffleQueue(), true);
  assert.equal(p.clearQueue(), 2);
  assert.equal(p.shuffleQueue(), false, "한 곡 이하는 섞지 않는다");
  h.dispose(p);
  assert.deepEqual(calls.sink, ["onMove", "onRemoveAt", "onReplace", "onClearQueue"]);
});

test("반복: 라이브가 있으면 켜지 않고, 라이브가 들어오면 풀린다", () => {
  const p = h.makePlayer();
  assert.equal(p.setLoop("queue"), "queue");
  p.queue = [yt("d1ddddddddd", { isLive: true })];
  assert.equal(p.releaseLoopForLive(), true);
  assert.equal(p.loop, false);
  assert.equal(p.setLoop("track"), false);
  assert.equal(p.releaseLoopForLive(), false);
  h.dispose(p);
});

test("위치 이동: 라이브는 거절, 아니면 그 자리에서 play", async () => {
  const p = scripted();
  const seeks: number[] = [];
  p.playAs = (ms) => seeks.push(ms);
  p.currentTrack = yt("e1eeeeeeeee", { isLive: true });
  const r = await p.seek(10000);
  p.currentTrack = yt("e2eeeeeeeee");
  await p.seek(20000, "replay");
  h.dispose(p);

  assert.equal(r.ok, false);
  assert.deepEqual(seeks, [20000]);
});

test("이전곡: 기록이 있으면 되감고 previous 로 멈춘다. 없으면 false", () => {
  const p = h.makePlayer();
  p.currentTrack = yt("f1fffffffff");
  assert.equal(p.previous(), false);

  p.previousTracks = [yt("f0fffffffff")];
  assert.equal(p.previous(), true);
  h.dispose(p);
  assert.equal(p.pendingEndReason, "previous");
  assert.equal(h.fakeAudioOf(p).stops, 1);
  assert.deepEqual(calls.sink, ["onRewind"]);
});

test("이전곡: 틀고 있는 곡이 없으면 기록이 있어도 false, 대기열도 그대로", () => {
  const p = h.makePlayer();
  p.previousTracks = [yt("f2fffffffff")];
  const ok = p.previous();
  h.dispose(p);
  assert.equal(ok, false);
  assert.deepEqual(p.queue, []);
  assert.equal(p.pendingEndReason, null);
  assert.equal(h.fakeAudioOf(p).stops, 0);
});

test("스킵: 곡이 있으면 원인을 적고 멈춘다. 없으면 false", () => {
  const p = h.makePlayer();
  assert.equal(p.skip(), false);
  p.currentTrack = yt("g1ggggggggg");
  p.idle.emptyTimer = setTimeout(() => {}, 1000);
  assert.equal(p.skip("jump"), true);
  h.dispose(p);
  assert.equal(p.pendingEndReason, "jump");
  assert.equal(p.idle.emptyTimer, null);
  assert.deepEqual(calls.persists, ["schedule:skip"]);
});

test("재생 위치: 시작 오프셋 + 리소스 재생량, 재생이 없으면 적어 둔 위치", () => {
  const p = h.makePlayer();
  p.lastPlaybackPosition = 4000;
  assert.equal(p.getCurrentTime(), 4000, "재생 없음");
  const pb = playback({ startOffsetMs: 1000, resource: null });
  p.playback = pb;
  assert.equal(p.getCurrentTime(), 1000, "리소스를 열기 전");
  pb.resource = fake<AudioResource>({ playbackDuration: 7000 });
  assert.equal(p.getCurrentTime(), 8000);
  h.dispose(p);
});

test("상태 요약과 재생 여부", () => {
  const p = h.makePlayer();
  assert.equal(p.isPlaybackActive(), false);
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Buffering };
  assert.equal(p.isPlaybackActive(), true);
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Paused };
  const s = p.getStatus();
  h.dispose(p);
  assert.deepEqual({ connected: s.connected, playing: s.playing, paused: s.paused, queue: s.queue, voice: s.voiceChannel, text: s.textChannel }, { connected: true, playing: false, paused: true, queue: 0, voice: "voice", text: "text" });
});

// ── 음성 채널 상태 문구 ────────────────────────────────────────────────

test("음성 채널 상태: 권한이 있고 사람이 쓴 문구가 아니면 쓴다", async () => {
  voiceChannelStatus._internals._reset();
  const p = h.makePlayer();
  const puts: Array<[string, string]> = [];
  p.guild.client.rest = fake<Client["rest"]>({ put: async (route: string, { body }: { body: { status: string } }) => puts.push([route, body.status]) });
  p.guild.channels.cache.set("voice1", fake<VoiceBasedChannel>({ id: "voice1", permissionsFor: () => ({ has: () => true }) }));

  await p.updateVoiceStatus("곡 제목");
  voiceChannelStatus.observe("voice1", "사람이 쓴 것");
  await p.updateVoiceStatus("다른 곡");
  h.dispose(p);

  assert.deepEqual(puts, [["/channels/voice1/voice-status", "곡 제목"]]);
});
