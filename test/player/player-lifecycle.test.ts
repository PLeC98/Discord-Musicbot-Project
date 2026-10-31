// src/player/player.ts: Player 의 곡 종료 · 정지 · 정리 · 오류 처리 · 조작의 지금 동작을 고정한다.
//
// player-play.test.ts 와 같은 하네스로 진짜 플레이어를 세운다. 옳고 그름이 아니라 "지금 이렇게 한다"를 적는다.
// 고칠 때 무엇이 바뀌었는지 드러나게 하려는 것이다.

import { recordPanel } from "../helpers/panel-events.ts";
import * as playerEvents from "../../src/player/events.ts";
import { gainOf } from "../../src/rules/volume-gain.ts";
import * as guildSettings from "../../src/store/guild-settings.ts";
import * as playerNotices from "../../src/ui/player-notices.ts";
import type { AudioResource } from "@discordjs/voice";
import { ChannelType, type Client, type VoiceBasedChannel } from "discord.js";
import type { Player } from "../../src/player/player.ts";
import type { CurrentPlayback } from "../../src/player/current-playback.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake } from "../helpers/fake.ts";

import * as h from "../helpers/player-harness.ts";
import { inGuild, currentGuild } from "../../src/infra/guild-context.ts";
import sink from "../../src/infra/log/sink.ts";
import { playbackStatus, soundAttached } from "../../src/ui/player-status.ts";
import { queueInfoOf } from "../../src/ui/queue-view.ts";
import * as audioCache from "../../src/store/audio-cache.ts";
import { audioKeyOf } from "../../src/rules/audio-key-of.ts";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as autoplayRoute from "../../src/autoplay/route.ts";
import * as trackState from "../../src/player/track-state.ts";
import { SessionPersistence } from "../../src/player/session-mirror.ts";
import { sessions } from "../../src/store/player-sessions.ts";
import * as voiceChannelStatus from "../../src/player/voice-channel-status.ts";
import config from "../../src/config/index.ts";
import { useDefaultDocuments } from "../helpers/config-docs.ts";
import { textOf } from "../helpers/cv2.ts";
import { codedError } from "../../src/rules/error-kind.ts";

useDefaultDocuments();

const { calls, behavior, AudioPlayerStatus } = h;

beforeEach(() => h.reset());

const tracks = await import("../helpers/tracks.ts");
const yt = tracks.youtube;

// 플레이어가 알린 일은 진짜 문장 보내기(ui/player-notices)로 채널에 간다. 조립(main.ts)이 거는 것과 같다
playerEvents.on("notice", playerNotices.sendNotice);
const tick = (ms = 0) => new Promise((done) => setTimeout(done, ms));

// 캐시된 곡으로 만든다. 다음 곡을 틀 때 스트림 없이 파일 분기로 가게 한다
function cached(id: string, extra?: Partial<QueuedTrack>) {
  const track = yt(id, extra);
  h.seedCache(`yt:${id}`, track);
  return track;
}

// 이 플레이어가 화면에 알린 것(update · end:<까닭> · create:<곡 제목> · webhook:<채널 id>)
const embeds = (player: Player) => recordPanel({ player });

// 재생 상태 가짜. 테스트가 보는 필드만
const playback = (fields: object) => fake<CurrentPlayback>(fields);

// 재생이 끝난 곡 하나를 세운다. 리소스의 재생량으로 "어디까지 틀었나"를 정한다. 음원 길이는 곡의 길이와 같게 둔다. extra 는 재생 상태에 더할 필드
function playing(player: Player, track: QueuedTrack, playedMs = track.duration * 1000, extra: object = {}) {
  player.currentTrack = track;
  player.playback = playback({ resource: { playbackDuration: playedMs, playStream: { destroy() {} } }, lengthMs: track.duration ? track.duration * 1000 : null, ...extra });
  return track;
}

// 패킷 공급이 끊겨 플레이어가 멈춘 곡. 재생 스트림이 끝까지 읽히지 않았다
function starved(player: Player, track: QueuedTrack, playedMs: number) {
  playing(player, track, playedMs);
  Object.assign(player.playback?.resource?.playStream ?? {}, { readableEnded: false });
  return track;
}

// 재생 · 곡 종료 · 오류 처리 · 자동재생을 테스트가 정할 수 있는 플레이어. 정하지 않은 것은 진짜로 돈다
class Scripted extends h.Player {
  playAs: ((seekMs: number) => unknown) | null = null;
  endAs: ((reason: string) => unknown) | null = null;
  errorAs: ((error: Error) => unknown) | null = null;
  autoplayAs: (() => Promise<boolean>) | null = null;

  async play(seekMs = 0) {
    if (!this.playAs) return super.play(seekMs);
    await this.playAs(seekMs);
    return { ok: true as const, track: this.currentTrack };
  }
  async onTrackEnd(reason = "idle") {
    if (!this.endAs) return super.onTrackEnd(reason);
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

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, next);
  assert.deepEqual(p.queue, []);
  assert.equal(p.previousTracks.at(-1), done);
  assert.equal(p.playback?.startOffsetMs, 0, "다음 곡은 0 부터");
  assert.equal(calls.spawns.length, 1);
  assert.deepEqual(seen, ["update"]);
  assert.deepEqual(calls.sink.slice(0, 2), ["onRetire", "onTake"], "끝난 곡 은퇴 → 다음 곡 꺼냄 순서");
  assert.equal(p.lifecycle.ending, false);
  assert.equal(p._endReason, null);
});

test("24/7 자리의 정지: 대기열을 비우고 지금 곡을 끝내 곡 없이 기다린다. 반복 · 자동재생 · 사람의 멈춤이 잇지 않는다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  playing(p, yt("ccccccccccc"));
  p.queue = [yt("ddddddddddd")];
  p.loop = "queue";
  p.pause.setUser(true);

  await p.stopStaying();
  await p.onTrackEnd("stop");
  h.dispose(p);

  assert.equal(p.currentTrack, null);
  assert.deepEqual(p.queue, [], "대기열 반복이어도 끝난 곡을 다시 넣지 않는다");
  assert.equal(p.pause.userPaused, false);
  assert.ok(seen.includes("end:stay-stop") && !seen.includes("end:queue-end"), "다 틀었다고 알리지 않는 끝난 패널");
  assert.equal(p._halting, false);
});

test("상주 자리의 정지: 사람이 멈춰 둔 곡을 정지 전에 다시 틀지 않는다(멈춤은 정지를 건 뒤에 푼다)", async () => {
  const p = h.makePlayer();
  playing(p, yt("cccccccccc2"));
  p.pause.setUser(true);
  p.audioPlayer.state = { ...p.audioPlayer.state, status: AudioPlayerStatus.Paused } as never;
  let unpaused = 0;
  p.audioPlayer.unpause = () => ((unpaused += 1), true);

  await p.stopStaying();
  h.dispose(p);

  assert.equal(unpaused, 0);
  assert.equal(p.pause.userPaused, false);
});

test("대기열이 비면 현재 곡과 이전 곡 기록을 비우고 패널을 끝내고 세션을 삭제하고 나갈 예약을 건다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  playing(p, yt("ccccccccccc"));
  let warmerStopped = false;
  p.warmer.stop = () => void (warmerStopped = true);

  await p.onTrackEnd("idle");
  const leaveTimer = p.idle.emptyTimer;
  h.dispose(p);

  assert.ok(warmerStopped, "곡 없이 기다리는 동안 예열 틱을 멈춘다");
  assert.equal(p.currentTrack, null);
  assert.deepEqual(seen, ["end:queue-end"]);
  assert.ok(calls.persists.includes("remove"));
  assert.ok(leaveTimer, "대기열 소진 뒤 나갈 예약");
  assert.deepEqual(p.previousTracks, []);
  assert.ok(calls.sink.includes("onReset"), "기록 비움도 저장소에 반영");
});

test("패킷 공급이 끊겨 멈춘 곡은 끊긴 위치부터 다시 튼다", async () => {
  const p = h.makePlayer();
  const track = cached("ddddddddddd");
  starved(p, track, 30000);
  p.queue = [yt("eeeeeeeeeee")];

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, track, "같은 곡");
  assert.equal(p.retry.used, 1);
  assert.equal(p.playback?.startOffsetMs, 30000);
  assert.equal(calls.spawns.at(-1)?.label, "playback", "다운로드가 끝난 캐시 파일이 있으면 그 파일로 다시 연다");
  assert.equal(p.queue.length, 1, "대기열은 그대로");
  assert.equal(p.previousTracks.length, 0, "기록에 넣지 않는다");
});

test("재생 스트림이 끝까지 읽혔어도 입력이 깨진 채 끝났으면 끊긴 위치부터 다시 튼다. 우리가 멈춘 것은 그대로 넘긴다", async () => {
  const p = h.makePlayer();
  const track = cached("d2ddddddddd");
  const endMs = 100_000;
  playing(p, track, endMs, { input: { broken: "입력 스트림 오류: 끊김" } });

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, track, "같은 곡");
  assert.equal(p.retry.used, 1);
  assert.equal(p.playback?.startOffsetMs, endMs);

  for (const reason of ["skip", "overflow"]) {
    h.reset();
    const q = h.makePlayer();
    playing(q, yt("d3ddddddddd"), 100_000, { input: { broken: "ffmpeg 종료 코드 SIGKILL" } });
    await q.onTrackEnd(reason);
    h.dispose(q);
    assert.equal(q.retry.used, 0, `${reason}: 우리가 멈추며 죽인 ffmpeg 의 표시는 끊김이 아니다`);
  }
});

test("일찍 끝났어도 입력이 온전히 끝났으면 끝이다. 길이는 판정에 쓰지 않고 다른 위치에서 끝났다고 남긴다", async () => {
  const p = h.makePlayer();
  const track = playing(p, yt("d4ddddddddd"), 30000);
  const next = cached("d5ddddddddd");
  p.queue = [next];
  const from = sink.buffer.length;

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, next);
  assert.equal(p.previousTracks.at(-1), track);
  assert.equal(p.retry.used, 0);
  assert.ok(
    sink.buffer.slice(from).some((e) => e.text.startsWith("곡이 길이와 다른 위치에서 끝남:")),
    "길이 쪽을 살필 수 있게 남긴다",
  );
});

test("곡 끝 판정은 표시 길이가 아니라 트는 음원의 길이를 본다", async () => {
  const p = h.makePlayer();
  const track = cached("e3eeeeeeeee", { duration: 180 }); // 표시는 스포티파이 길이 180초
  starved(p, track, 179_000);
  Object.assign(p.playback ?? {}, { lengthMs: 200_000 }); // 트는 음원은 200초

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, track, "음원 끝까지 21초 남았으니 다시 연다");
  assert.equal(p.retry.used, 1);
});

test("끊겼어도 다시 열 위치가 길이 끝 1.5초 안이면 다시 열지 않고 넘긴다", async () => {
  const p = h.makePlayer();
  const track = yt("d6ddddddddd");
  starved(p, track, track.duration * 1000 - 1000);
  const next = cached("d7ddddddddd");
  p.queue = [next];

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, next);
  assert.equal(p.retry.used, 0);
});

test("패킷 공급이 끊겨 멈추면 입력 종류 · 입력이 끊긴 시간 · 입력 상태를 남기고, 다시 연 데 걸린 시간을 남긴다", async () => {
  const p = h.makePlayer();
  const track = cached("e1eeeeeeeee");
  starved(p, track, 30_000);
  Object.assign(p.playback ?? {}, { input: { kind: "청크", detail: () => "청크 #3 · 이어받는 중" }, inputProgressAt: Date.now() - 12_000 });
  const from = sink.buffer.length;

  await p.onTrackEnd("idle");
  h.dispose(p);

  const lines = sink.buffer.slice(from).map((e) => e.text);
  assert.ok(
    lines.some((l) => /^패킷 공급이 끊겨 플레이어가 멈춤: .* \| 입력 청크 · 입력 없음 1[23]\.\d초 · 청크 #3 · 이어받는 중$/.test(l)),
    lines.join("\n"),
  );
  assert.ok(lines.some((l) => /^다시 열었습니다: .* \| \d+\.\d초 걸림$/.test(l)));

  h.reset();
  const q = h.makePlayer();
  starved(q, cached("e2eeeeeeeee"), 30_000);
  Object.assign(q.playback ?? {}, { input: { kind: "캐시 전환", detail: () => null }, inputProgressAt: Date.now() - 300_000 });
  const from2 = sink.buffer.length;
  await q.onTrackEnd("idle");
  h.dispose(q);
  assert.ok(
    sink.buffer.slice(from2).some((e) => /^패킷 공급이 끊겨 플레이어가 멈춤: .* \| 입력 캐시 전환$/.test(e.text)),
    "캐시로 갈아탄 뒤에는 입력이 끊긴 시간을 모른다",
  );
});

test("패킷 공급이 끊겨 멈추면 출력 쪽(워커 · 응답 대기 프레임 · 송출 대기 패킷 · 큐 깊이)도 남긴다", async () => {
  const p = h.makePlayer();
  starved(p, cached("e3eeeeeeeee"), 30_000);
  const output = { describe: () => ({ inflight: 3, ready: 0, frames: 1, depth: 2, worker: 2, oldestMs: 1200 }) };
  Object.assign(p.playback ?? {}, { input: { kind: "파일", detail: () => null }, output });
  const from = sink.buffer.length;

  await p.onTrackEnd("idle");
  h.dispose(p);

  const lines = sink.buffer.slice(from).map((e) => e.text);
  assert.ok(
    lines.some((l) => /^패킷 공급이 끊겨 플레이어가 멈춤: .* \| 입력 파일 · 출력 워커 2 · 응답 대기 3개\(가장 오래 1\.2초\) · 송출 대기 0개 · 큐 깊이 2$/.test(l)),
    lines.join("\n"),
  );
});

test("다시 틀기를 두 번 써도 끊기면 포기하고 끊긴 위치에서 멈춰 둔다. 다음 곡으로 넘기지 않는다", async () => {
  const p = h.makePlayer();
  const track = starved(p, yt("fffffffffff"), 30000);
  const next = cached("ggggggggggg");
  p.queue = [next];
  p._retryTrack = track;
  p.retry = { used: 2, stalled: 0 };

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, track);
  assert.equal(p.lifecycle.parked, true);
  assert.equal(p.lastPlaybackPosition, 30000);
  assert.deepEqual(p.queue, [next]);
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

    await p.onTrackEnd(reason);
    h.dispose(p);

    assert.equal(p.retry.used, 0, reason);
    if (reason !== "previous") assert.equal(replays, 0, `${reason}: 대기열이 비었으니 틀 것이 없다`);
  }
});

test("라이브가 0 이 아닌 코드로 끊기면 1초 뒤 주소를 새로 불러와 다시 연다", async () => {
  const p = scripted();
  const live = playing(p, yt("iiiiiiiiiii", { isLive: true, duration: 0 }), 60000, { live: true, input: { exitCode: 1 } });
  const seeks: number[] = [];
  p.playAs = async (seekMs) => {
    seeks.push(seekMs);
  };

  const started = Date.now();
  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.deepEqual(seeks, [0], "라이브는 늘 0 으로 연다");
  assert.ok(Date.now() - started >= 900, "재시도 횟수 × 1초를 기다린다");
  assert.equal(p.currentTrack, live);
  assert.equal(p.retry.used, 1);
});

test("라이브가 60초를 가다 끊겼으면 예산을 다시 채우고 1초 뒤에 다시 연다", async () => {
  const p = scripted();
  const live = playing(p, yt("i2iiiiiiiii", { isLive: true, duration: 0 }), 60_000, { live: true, input: { exitCode: 1 } });
  p._retryTrack = live;
  p.retry = { used: 4, stalled: 0 };
  p.playAs = async () => {};

  const started = Date.now();
  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.retry.used, 1);
  assert.ok(Date.now() - started < 1900, "쓴 횟수(1) × 1초만 기다린다");
});

test("라이브 다시 열기를 다섯 번 쓰면(사이에 60초를 못 갔으면) 다음 곡으로 넘긴다", async () => {
  const p = h.makePlayer();
  const live = playing(p, yt("jjjjjjjjjjj", { isLive: true, duration: 0 }), 30000, { live: true, input: { exitCode: 1 } });
  p._retryTrack = live;
  p.retry = { used: 5, stalled: 0 };
  const next = cached("j2jjjjjjjjj");
  p.queue = [next];
  embeds(p);

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, next);
  assert.equal(p.previousTracks.at(-1), live);
});

test("라이브가 코드 0 으로 끝나면(방송 종료) 다시 열지 않는다", async () => {
  const p = h.makePlayer();
  playing(p, yt("kkkkkkkkkkk", { isLive: true, duration: 0 }), 60000, { live: true, input: { exitCode: 0 } });
  embeds(p);

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, null);
  assert.equal(p.retry.used, 0);
});

// 방송이 끝나면 ffmpeg 가 종료 코드를 남기기 전에 플레이어가 멈추기도 해 끊김으로 보고 다시 연다. 다시 열어 보면 끝난 것을 안다
for (const [ending, answer, line] of [
  ["다시보기가 됐으면 다시보기를 틀지 않고", () => ({ url: "https://media.test/vod", duration: 3600, liveStatus: null }), /^info 라이브 방송이 종료되어 다음 곡으로 넘깁니다: .* \| 재확인 결과 라이브 아님$/],
  [
    "yt-dlp 가 오류로 답하면",
    () => {
      throw new Error("ERROR: [youtube] m2mmmmmmmmm: We're experiencing technical difficulties.");
    },
    /^warn 라이브를 다시 열지 못해 다음 곡으로 넘깁니다: /,
  ],
] as const) {
  test(`끊긴 라이브를 다시 열었는데 ${ending} 다음 곡으로. 실패로 세지 않고 채널에 알리지 않으며 다 튼 곡처럼 기록한다`, async () => {
    const p = h.makePlayer();
    const live = playing(p, yt("m1mmmmmmmmm", { isLive: true, duration: 0 }), 90_000, { live: true, input: { exitCode: null } });
    const next = cached("m3mmmmmmmmm");
    p.queue = [next];
    embeds(p);
    behavior.stream = answer;
    const sent = calls.sent.length;
    const from = sink.buffer.length;

    await p.onTrackEnd("idle");
    h.dispose(p);

    assert.equal(p.currentTrack, next);
    assert.equal(p.previousTracks.at(-1), live);
    assert.equal(p.failedTracks, 0);
    assert.equal(calls.sent.length, sent, "채널에 알리지 않는다");
    const lines = sink.buffer.slice(from).map((e) => `${e.level} ${e.text}`);
    assert.ok(
      lines.some((l) => line.test(l)),
      lines.join(" / "),
    );
    assert.ok(!lines.some((l) => l.startsWith("error ")), "오류로 남기지 않는다");
  });
}

test("끊긴 라이브 HLS(직접 링크)를 다시 열었는데 목록이 끝났으면 다음 곡으로. 실패로 세지 않는다", async () => {
  const p = h.makePlayer();
  const url = "https://h.test/live/index.m3u8";
  const live = playing(p, tracks.direct(url, { isLive: true, duration: 0 }), 90_000, { live: true, input: { exitCode: null } });
  const next = cached("m4mmmmmmmmm");
  p.queue = [next];
  embeds(p);
  behavior.stream = () => ({ url, platform: "direct", liveStatus: "is_live" });
  const asked: Array<{ liveOnly?: boolean } | undefined> = [];
  behavior.directStream = (_url, opts) => {
    asked.push(opts);
    throw codedError("live-ended", "라이브 HLS 의 목록이 끝났습니다");
  };
  const from = sink.buffer.length;

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, next);
  assert.equal(p.previousTracks.at(-1), live);
  assert.equal(p.failedTracks, 0);
  assert.equal(asked[0]?.liveOnly, true, "다시 열 때만 끝난 목록을 거절한다");
  const lines = sink.buffer.slice(from).map((e) => `${e.level} ${e.text}`);
  assert.ok(
    lines.some((l) => /^info 라이브 방송이 종료되어 다음 곡으로 넘깁니다: /.test(l)),
    lines.join(" / "),
  );
});

test("라이브로 담은 HLS 를 처음 틀 때(세션 복원도 같다) 목록이 끝났으면 다시보기를 틀지 않고 알린 뒤 다음 곡으로. 실패로 세지 않는다", async () => {
  const p = h.makePlayer();
  const url = "https://h.test/ended/index.m3u8";
  const ended = tracks.direct(url, { isLive: true, duration: 0 });
  const next = cached("m5mmmmmmmmm");
  p.currentTrack = ended;
  p.queue = [next];
  embeds(p);
  behavior.stream = () => ({ url, platform: "direct", liveStatus: "is_live" });
  const asked: Array<{ liveOnly?: boolean } | undefined> = [];
  behavior.directStream = (_url, opts) => {
    asked.push(opts);
    throw codedError("live-ended", "라이브 HLS 의 목록이 끝났습니다");
  };
  const sent = calls.sent.length;
  const from = sink.buffer.length;

  const r = await p.play(0);
  h.dispose(p);

  assert.deepEqual(r, { ok: false, code: "live-ended" });
  assert.equal(p.currentTrack, next);
  assert.equal(p.failedTracks, 0);
  assert.equal(asked[0]?.liveOnly, true);
  assert.ok(calls.sent.length > sent, "채널에 알린다");
  const lines = sink.buffer.slice(from).map((e) => `${e.level} ${e.text}`);
  assert.ok(
    lines.some((l) => /^info 종료된 라이브 방송이라 재생하지 않고 넘깁니다: /.test(l)),
    lines.join(" / "),
  );
  assert.ok(!lines.some((l) => l.startsWith("error ")), "오류로 남기지 않는다");
});

test("모르는 자동재생 장르는 끄고 채널에 알린 뒤 대기열 소진으로 간다", async () => {
  const p = h.makePlayer();
  embeds(p);
  const sent = calls.sent;
  playing(p, yt("lllllllllll"));
  p.autoplay = "없는-장르";

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.autoplay, false);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /없는-장르/);
  assert.equal(p.currentTrack, null);
});

test("넘어가는 중에 또 불리면 아무것도 안 한다", async () => {
  const p = h.makePlayer();
  const track = playing(p, yt("mmmmmmmmmmm"));
  p.lifecycle.ending = true;

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, track);
  assert.equal(p.previousTracks.length, 0);
});

test("현재 곡이 없는데 끝나면 리소스만 비운다", async () => {
  const p = h.makePlayer();
  p.playback = playback({ resource: { playbackDuration: 0 } });

  await p.onTrackEnd("stop");
  h.dispose(p);

  assert.equal(p.resource, null);
  assert.equal(calls.persists.includes("remove"), false, "세션은 건드리지 않는다");
});

// ── 오디오 플레이어 이벤트 ──────────────────────────────────────────────

test("Idle 이벤트는 멈춘 까닭을 곧바로 꺼내고, 처리는 멈춘 쪽의 호출이 끝난 뒤로 미룬다", async () => {
  const p = scripted();
  const reasons: string[] = [];
  p.endAs = (r) => reasons.push(r);
  p._endReason = "skip";

  p.audioPlayer.emit(AudioPlayerStatus.Idle);
  assert.equal(p._endReason, null, "원인은 바로 꺼낸다");
  assert.deepEqual(reasons, [], "처리는 미룬다");
  await new Promise((done) => setImmediate(done));
  h.dispose(p);

  assert.deepEqual(reasons, ["skip"]);
});

test("Playing 이벤트: 멈출 까닭이 없으면 그대로, 있으면 그 자리에서 다시 멈춘다", () => {
  const p = h.makePlayer();
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Playing };

  p.audioPlayer.emit(AudioPlayerStatus.Playing);
  assert.equal(p.audioPlayer.state.status, AudioPlayerStatus.Playing);
  assert.equal(p.paused, false);

  p.pause.setHolds(["alone"]);
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Playing }; // 오디오만 다시 재생된 경우(재연결 등)
  p.audioPlayer.emit(AudioPlayerStatus.Playing);
  h.dispose(p);
  assert.equal(p.audioPlayer.state.status, AudioPlayerStatus.Paused);
});

test("멈춤은 오디오 상태가 아니라 사람의 뜻 · 억제 사유로 계산한다(Paused 이벤트는 음성 채널 상태만 고친다)", () => {
  const p = h.makePlayer();

  p.audioPlayer.emit(AudioPlayerStatus.Paused);
  assert.equal(p.paused, false);
  p.pause.setUser(true);
  h.dispose(p);

  assert.equal(p.paused, true);
});

test("오디오 오류는 음원 쪽이다: 음성 연결을 건드리지 않고 끝 까닭(stream-error)을 적어 곡 끝 처리에 넘긴다", async () => {
  const p = scripted();
  const errors: string[] = [];
  const ends: string[] = [];
  p.errorAs = (e) => errors.push(e.message);
  p.endAs = (reason) => ends.push(reason);
  p.currentTrack = yt("nnnnnnnnnnn");

  p.audioPlayer.emit("error", new Error("network down"));
  p.onPlayerIdle(); // 오디오 플레이어는 오류를 알린 뒤 Idle 로 간다
  await new Promise((done) => setImmediate(done));
  h.dispose(p);

  assert.deepEqual(calls.recoveries, [], "음성 연결을 재연결하지 않는다");
  assert.deepEqual(errors, [], "다음 곡으로 넘기는 오류 처리를 따로 부르지 않는다(곡 끝 처리와 겹친다)");
  assert.deepEqual(ends, ["stream-error"]);
});

test("곡 끝 처리: stream-error 는 길이를 모르는 곡도 끊긴 것으로 보고 같은 곡을 다시 연다", () => {
  const p = h.makePlayer();
  const track = yt("ooooooooooo", { duration: 0 });
  p.currentTrack = track;
  assert.equal(p._describeEnd(track, "stream-error").dropped, true);
  assert.equal(p._describeEnd(track, "idle").dropped, false, "길이를 모르는 곡이 그냥 끝나면 끊김이 아니다");
  h.dispose(p);
});

// ── 멎음 감시 ─────────────────────────────────────────────────────────

test("멎음 감시: 오디오가 Idle 이 되면 10초 뒤를 본다. 곡이 있고 여전히 Idle 이면 다음 곡으로 넘기고 다시 본다", async () => {
  const p = scripted();
  const ends: string[] = [];
  p.endAs = (r) => ends.push(r);
  p.currentTrack = yt("s1sssssssss");

  p.audioPlayer.emit("stateChange", { status: AudioPlayerStatus.Playing }, { status: AudioPlayerStatus.Idle });
  assert.equal(h.timerDelay(p.watch.idleTimer), 10_000);
  p.watch.checkIdle();
  await tick();

  assert.deepEqual(ends, ["stuck"]);
  assert.equal(h.timerDelay(p.watch.idleTimer), 10_000, "넘긴 곡도 틀지 못하면 다시 본다");
  h.dispose(p);
});

test("멎음 감시: 여는 중 · 끝 처리 중 · 음성 복구 중이면 넘기지 않고 다시 본다. 곡이 없거나 Idle 이 아니면 손 뗀다", () => {
  const p = scripted();
  const ends: string[] = [];
  p.endAs = (r) => ends.push(r);
  p.currentTrack = yt("s2sssssssss");
  const recheck = () => {
    p.watch.checkIdle();
    const again = p.watch.idleTimer !== null;
    p.watch.stopIdle();
    return again;
  };

  p.lifecycle.to("starting");
  assert.equal(recheck(), true, "여는 중");
  p.lifecycle.to("idle");
  p.lifecycle.ending = true;
  assert.equal(recheck(), true, "끝 처리 중");
  p.lifecycle.ending = false;
  p.voice.state = "recovering";
  assert.equal(recheck(), true, "음성 복구 중");
  p.voice.state = "ready";
  assert.deepEqual(ends, []);

  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Playing };
  assert.equal(recheck(), false, "틀고 있다");
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Idle };
  p.currentTrack = null;
  assert.equal(recheck(), false, "곡이 없다");
  assert.deepEqual(ends, []);
  h.dispose(p);
});

test("멎어서 넘긴 곡은 한곡 반복이어도 되풀이하지 않는다", async () => {
  const p = h.makePlayer();
  const stuck = playing(p, yt("s3sssssssss"), 0);
  const next = cached("s4sssssssss");
  p.queue = [next];
  p.loop = "track";

  await p.onTrackEnd("stuck");
  h.dispose(p);

  assert.equal(p.currentTrack, next);
  assert.equal(p.previousTracks.at(-1), stuck);
});

// ── 정지 · 나가기 · 정리 ────────────────────────────────────────────────

test("버리기(세션 삭제): 대기열 · 현재 곡 · 기록을 비우고 세션을 삭제하고 연결을 끊는다", async () => {
  const p = h.makePlayer();
  const track = cached("qqqqqqqqqqq");
  p.currentTrack = track;
  p.queue = [yt("rrrrrrrrrrr")];
  p.previousTracks = [yt("sssssssssss")];
  audioCache.protect(p.guild.id, "yt:qqqqqqqqqqq");
  p.pause.setUser(true);

  const from = sink.buffer.length;
  await p.dispose({ reason: "정지", session: "remove", end: "stop" });
  h.dispose(p);

  assert.equal(p.currentTrack, null);
  assert.deepEqual(p.queue, []);
  assert.deepEqual(p.previousTracks, []);
  assert.deepEqual(calls.persists, ["remove"]);
  assert.equal(p.connection, null);
  assert.equal(h.fakeAudioOf(p).stops, 1);
  assert.equal(p.paused, false, "멈춤을 비운다");
  assert.equal(audioCache._liveKeys().has("yt:qqqqqqqqqqq"), false, "보호를 푼다");
  const ended = sink.buffer.slice(from).filter((e) => e.text.startsWith("트랙 종료:"));
  assert.deepEqual(
    ended.map((e) => e.text),
    ['트랙 종료: "곡 qqqqqqqqqqq" (youtube) | 원인=stop'],
    "버릴 때 곡 이름으로 끝 줄을 곧바로 남긴다",
  );
  assert.equal(p.audioPlayer.listenerCount(AudioPlayerStatus.Idle), 0, "곡 끝 처리(다음 곡)는 돌리지 않는다");
});

test("버리기(세션 저장): 먼저 저장하고, 똑같이 비우고 끊되 세션은 삭제하지 않는다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("ttttttttttt");
  p.queue = [yt("uuuuuuuuuuu")];

  await p.dispose({ reason: "나가며 저장", session: "save", end: "stop" });
  h.dispose(p);

  assert.deepEqual(calls.persists, ["leave"]);
  assert.equal(p.currentTrack, null);
  assert.deepEqual(p.queue, []);
  assert.equal(p.connection, null);
});

test("버리기: 연결을 부수고 플레이어가 쥔 것(패널 참조 포함)을 전부 놓는다", async () => {
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

  await p.dispose({ reason: "시험", session: "remove", end: "stop" });
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

test("버리면 타이머와 함께 대기열 미리 다운로드 · 세션 동기화도 멈춘다", async () => {
  const p = h.makePlayer();
  const stopped: string[] = [];
  p.warmer.stop = () => void stopped.push("warmer");
  p.persistence.stopStateSync = () => void stopped.push("sync");
  await p.dispose({ reason: "시험", session: "keep", end: "stop" });
  const atDispose = [...stopped].sort();
  h.dispose(p);
  assert.deepEqual(atDispose, ["sync", "warmer"]);
});

test("버리기는 한 번만 한다. 두 번째 부름은 아무것도 하지 않는다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  p.currentTrack = yt("aaaaaaaaaaa");

  await p.dispose({ reason: "첫째", session: "remove", panel: "stop", end: "stop" });
  await p.dispose({ reason: "둘째", session: "save", panel: "leave", end: "stop" });
  h.dispose(p);

  assert.deepEqual(calls.persists, ["remove"]);
  assert.equal(h.fakeAudioOf(p).stops, 1);
  assert.deepEqual(seen, ["end:stop", "webhook:text1"]);
});

test("버리기(세션 그대로): 저장도 삭제도 하지 않는다. 따로 저장된 세션을 /join 이 복원한다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("bbbbbbbbbbb");

  await p.dispose({ reason: "교체", session: "keep", end: "stop" });
  h.dispose(p);

  assert.deepEqual(calls.persists, []);
  assert.equal(h.registryOf(p)?.has("g1"), false, "레지스트리에서는 빠진다");
});

test("버리기(세션 그대로): 메모리를 비워도 저장된 곡 행은 남는다(진짜 세션 저장으로)", async () => {
  const p = h.makePlayer({ guildId: "gkeep" });
  // 이 도우미는 세션 저장을 가짜로 끼운다. DB 에 남는 것을 보려고 진짜로 바꾼다
  const real = new SessionPersistence(p);
  p.persistence = real;
  p.trackSink = real;
  trackState.setCurrent(p, yt("kkkkkkkkkk1"));
  trackState.enqueue(p, [yt("kkkkkkkkkk2")]);

  await p.dispose({ reason: "음성 채널 접속 실패", session: "keep", end: "stop" });
  h.dispose(p);

  const left = sessions().load("gkeep");
  assert.deepEqual([left?.current?.title, left?.queue.map((t) => t.title)], [yt("kkkkkkkkkk1").title, [yt("kkkkkkkkkk2").title]]);
  sessions().removeSession("gkeep");
});

test("끝난 패널은 정리가 끝난 뒤, 패널 참조를 놓기 전에 고친다. 패널 고치기가 실패해도 버림은 끝난다", async () => {
  const p = h.makePlayer();
  p.currentTrack = yt("ccccccccccc");
  const at: Array<{ track: unknown; text: unknown; registered: boolean }> = [];
  const off = playerEvents.on("ended", async (q) => {
    if (q !== p) return;
    at.push({ track: q.currentTrack, text: q.textChannel?.id, registered: h.registryOf(q)!.has("g1") });
    throw new Error("패널 고치기 실패");
  });
  try {
    await p.dispose({ reason: "시험", session: "remove", panel: "disconnected", end: "stop" });
  } finally {
    off();
    h.dispose(p);
  }

  assert.deepEqual(at, [{ track: null, text: "text1", registered: false }], "곡은 비웠고 레지스트리에서 빠졌고 패널 참조는 아직 있다");
  assert.equal(p.textChannel, null, "실패해도 패널 참조를 놓는다");
  assert.equal(p.lifecycle.phase, "disposed");
});

test("버린 까닭(end)을 끝난 패널 알림에 같이 넘긴다(끝 안내가 그 까닭으로 선택한다)", async () => {
  const p = h.makePlayer();
  const seen: unknown[] = [];
  const off = playerEvents.on("ended", (q, reason, cause) => {
    if (q === p) seen.push([reason, cause]);
  });
  try {
    await p.dispose({ reason: "시험", session: "remove", panel: "disconnected", end: "inactivity-timeout" });
  } finally {
    off();
    h.dispose(p);
  }
  assert.deepEqual(seen, [["disconnected", "inactivity-timeout"]]);
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

type Member = { user: { bot: boolean; id: string }; voice: { selfDeaf: boolean; serverDeaf: boolean } };

// 음성 채널에 사람을 두고 봇을 그 채널에 붙여 둔다. 플레이어가 읽는 필드(members · 권한 · 봇의 음성 상태)만
function voiceChannelWith(player: Player, humans: string[]) {
  const all = new Map(humans.map((id): [string, Member] => [id, { user: { bot: false, id }, voice: { selfDeaf: false, serverDeaf: false } }]));
  const members = Object.assign(all, { filter: (fn: (m: Member) => boolean) => ({ size: [...all.values()].filter(fn).length }) });
  player.guild.channels.cache.set("voice1", fake<VoiceBasedChannel>({ id: "voice1", type: ChannelType.GuildVoice, members, isVoiceBased: () => true, permissionsFor: () => ({ has: () => false }) }));
  Object.assign(player.guild.members.me!, { voice: { channelId: "voice1", serverMute: false, suppress: false } });
}

test("혼자 남으면 alone 으로 멈추고, 시간이 다 되도록 아무도 없으면 정리하고 레지스트리에서 뺀다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  voiceChannelWith(p, []);
  p.idle.aloneMs = 0;
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Playing };
  p.currentTrack = yt("xxxxxxxxxxx");

  p.syncHolds();
  assert.ok(p.pause.holds.has("alone"));
  assert.equal(p.audioPlayer.state.status, AudioPlayerStatus.Paused);
  await tick(10);
  h.dispose(p);

  assert.deepEqual(seen, ["update", "end:disconnected", "webhook:text1"], "멈추는 순간 패널을 고친다");
  assert.ok(calls.persists.includes("remove"), "세션을 지운다");
  assert.equal(p.connection, null);
  assert.equal(h.registryOf(p)?.has("g1"), false);
});

test("시간이 됐을 때 사람이 있으면(돌아온 이벤트를 놓쳤어도) alone 을 풀고 패널만 갱신한다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  voiceChannelWith(p, []);
  p.idle.aloneMs = 0;
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Playing };
  p.currentTrack = yt("xxxxxxxxxxx");

  p.syncHolds();
  voiceChannelWith(p, ["u1"]); // 사람이 들어왔지만 이벤트는 오지 않았다
  await tick(10);
  h.dispose(p);

  assert.equal(p.pause.holds.has("alone"), false);
  assert.equal(p.audioPlayer.state.status, AudioPlayerStatus.Playing);
  assert.deepEqual(seen, ["update", "update"], "멈출 때 · 풀 때 한 번씩");
  assert.equal(h.registryOf(p)?.get("g1"), p);
});

test("버려진(교체된) 플레이어의 늦은 비활성 타이머는 아무것도 하지 않는다. 현행 플레이어와 연결을 건드리지 않는다", async () => {
  const p = h.makePlayer();
  embeds(p);
  voiceChannelWith(p, []);
  const current = fake<Player>({});
  h.registryOf(p)?.set("g1", current);
  p.idle.aloneMs = 0;

  p.syncHolds();
  p.lifecycle.to("disposed", "교체"); // 타이머는 일부러 두었다(이미 깨어나는 중인 경우)
  await tick(10);
  h.dispose(p);

  assert.equal(h.registryOf(p)?.get("g1"), current);
  assert.ok(p.connection, "연결은 현행 플레이어 것일 수 있어 끊지 않는다");
});

test("사람이 돌아오면 예약을 취소하고 alone 만 푼다. 사람이 멈춰 둔 것은 남는다", () => {
  const p = h.makePlayer();
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Paused };
  p.pause.setUser(true);
  voiceChannelWith(p, []);
  p.syncHolds();
  assert.ok(p.idle.aloneTimer);

  voiceChannelWith(p, ["u1"]);
  p.syncHolds();
  h.dispose(p);

  assert.equal(p.idle.aloneTimer, null);
  assert.equal(p.pause.holds.size, 0);
  assert.equal(p.pause.userPaused, true);
  assert.equal(p.audioPlayer.state.status, AudioPlayerStatus.Paused, "사람의 멈춤이 남아 멈춘 채");
});

test("붙어 있지 않으면(연결 · 재연결 · 옮겨지는 중) 억제 사유를 그대로 두고, 버린 플레이어는 맞추지 않는다", () => {
  const p = h.makePlayer();
  voiceChannelWith(p, []);
  p.syncHolds();
  Object.assign(p.guild.members.me!, { voice: { channelId: null } });
  voiceChannelWith(p, ["u1"]);
  Object.assign(p.guild.members.me!, { voice: { channelId: "other" } });
  p.syncHolds();
  assert.ok(p.pause.holds.has("alone"), "모르면 바꾸지 않는다");

  Object.assign(p.guild.members.me!, { voice: { channelId: "voice1", serverMute: false, suppress: false } });
  p.lifecycle.to("disposed", "교체");
  p.syncHolds();
  h.dispose(p);
  assert.ok(p.pause.holds.has("alone"), "버린 플레이어");
});

test("대기열이 끝나도 혼자 남음 타이머는 그대로 돈다(채널 밖에서 곡을 넣어도 소리 없이 남지 않는다)", async () => {
  const p = h.makePlayer();
  embeds(p);
  voiceChannelWith(p, []);
  p.syncHolds();
  const timer = p.idle.aloneTimer;
  await p.onTrackEnd("idle");
  h.dispose(p);
  assert.ok(timer);
  assert.equal(p.idle.aloneTimer, null, "버리며 지운다");
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
  assert.match(textOf(sent[0]), /오류/);
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

test("handleError: 자동재생이 선택한 곡이 내려갔으면 조용히 표시만 하고 다음 자동재생으로", async () => {
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

// ── 연달아 실패 ────────────────────────────────────────────────────────

// 열리지 않는 곡. 캐시하지 않는 길이라 기다릴 다운로드도 없다
function unplayable() {
  behavior.stream = () => ({ url: "https://media.test/dead", duration: 2 * 3600 });
  behavior.fetch = () => {
    throw new Error("끊김");
  };
}

test("까닭 모를 실패가 연달아 셋이면 넘기기를 그만두고 셋째 곡에서 멈춰 둔다. 지금 곡 · 대기열을 두고, 멈춤으로 저장하고, 채널에 알린다", async () => {
  const p = h.makePlayer();
  const [a, b, c, d] = ["f1fffffffff", "f2fffffffff", "f3fffffffff", "f4fffffffff"].map((id) => yt(id));
  unplayable();
  p.currentTrack = a;
  p.queue = [b, c, d];

  await p.play(0);
  const leaveTimer = p.idle.emptyTimer; // 치우기 전에 읽는다
  h.dispose(p);

  assert.equal(p.currentTrack, c, "지금 곡을 비우지 않는다(곡을 넣으면 뒤에 붙고, 재생 버튼으로 다시 연다)");
  assert.deepEqual(p.queue, [d]);
  assert.equal(p.lifecycle.parked, true);
  assert.equal(p.pause.userPaused, true, "멈춤으로 저장된다(재시작이 저절로 틀지 않는다)");
  assert.equal(p.lastPlaybackPosition, 0);
  assert.equal(p.failedTracks, 0, "멈추면 다시 센다. 사용자가 다시 틀 때 한 번 실패로 곧바로 멈추지 않게");
  assert.ok(calls.sent.map(textOf).includes("### ❌ 3곡이 연달아 재생되지 않아 일시정지했어요.\n재생 버튼으로 다시 시도하거나 다음 곡 버튼으로 넘길 수 있어요."));
  assert.ok(calls.persists.includes("parked"));
  assert.equal(calls.persists.includes("remove"), false);
  assert.equal(leaveTimer, null, "나갈 예약을 걸지 않는다");
});

test("곡을 못 열어 다음 곡으로 넘기면 앞 곡의 위치를 버린다(다음 곡을 여는 동안 주기 저장이 그 위치를 새 곡에 쓰지 않게)", async () => {
  const p = h.makePlayer();
  const [a, b] = [yt("p1fffffffff"), yt("p2fffffffff")];
  unplayable();
  // 다음 곡을 새로 열 때(위치 0) 시작 위치를 정하려고 SponsorBlock 을 묻는다. 그때의 위치가 주기 저장이 쓰는 값이다
  const seen: number[] = [];
  behavior.sponsor = (track) => {
    if (track === b) seen.push(p.getCurrentTime());
    return null;
  };
  p.currentTrack = a;
  p.queue = [b];

  await p.play(90_000); // 복원 위치에서 열다 실패
  h.dispose(p);

  assert.ok(seen.length > 0, "다음 곡을 열었다");
  assert.deepEqual([...new Set(seen)], [0]);
});

test("세션을 복원하는 동안(quietFailures) 연달아 실패해 멈춰 두면 채널에 알리지 않는다(/join 이 응답으로 말한다)", async () => {
  const p = h.makePlayer();
  const [a, b, c, d] = ["q1fffffffff", "q2fffffffff", "q3fffffffff", "q4fffffffff"].map((id) => yt(id));
  unplayable();
  p.currentTrack = a;
  p.queue = [b, c, d];
  p.quietFailures = true;

  await p.play(0);
  h.dispose(p);

  assert.equal(p.currentTrack, c);
  assert.equal(p.lifecycle.parked, true);
  assert.equal(
    calls.sent.map(textOf).some((text) => text.includes("연달아 실패")),
    false,
  );
});

test("연달아 실패해 멈춰 둘 때 남은 곡이 없어도 끝내지 않는다: 마지막 곡에서 멈춰 두고 세션을 남긴다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  const [a, b, c] = ["f9aaaaaaaaa", "f9bbbbbbbbb", "f9ccccccccc"].map((id) => yt(id));
  unplayable();
  p.currentTrack = a;
  p.queue = [b, c];

  await p.play(0);
  const leaveTimer = p.idle.emptyTimer;
  h.dispose(p);

  assert.equal(p.currentTrack, c);
  assert.equal(p.lifecycle.parked, true);
  assert.equal(seen.includes("end:queue-end"), false);
  assert.equal(calls.persists.includes("remove"), false);
  assert.equal(leaveTimer, null);
});

test("마지막 곡이 열리지 않으면(연달아 실패 전) 다 튼 것과 같이 끝낸다: 끝난 패널 · 세션 삭제 · 나갈 예약", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  unplayable();
  p.currentTrack = yt("l1aaaaaaaaa");
  p.queue = [];

  await p.play(0);
  const leaveTimer = p.idle.emptyTimer;
  h.dispose(p);

  assert.equal(p.currentTrack, null);
  assert.ok(seen.includes("end:queue-end"));
  assert.ok(calls.persists.includes("remove"));
  assert.ok(leaveTimer, "나갈 예약을 건다(음성에 머물러 얼지 않게)");
});

test("곡 담기가 첫 곡을 트는 동안(finishByCaller)은 열리지 않아도 끝내지 않는다. 담기가 끝을 맡는다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  unplayable();
  p.currentTrack = yt("l2aaaaaaaaa");
  p.queue = [];
  p.finishByCaller = true;

  await p.play(0);
  const leaveTimer = p.idle.emptyTimer;
  h.dispose(p);

  assert.equal(p.currentTrack, null);
  assert.equal(seen.includes("end:queue-end"), false);
  assert.equal(calls.persists.includes("remove"), false);
  assert.equal(leaveTimer, null);
});

test("곡 담기가 첫 곡을 트는 동안 연달아 실패해 남은 곡이 없으면 마지막 곡에서 멈춰 둔다(끝내지 않는다)", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  const [a, b, c] = ["l3aaaaaaaaa", "l3bbbbbbbbb", "l3ccccccccc"].map((id) => yt(id));
  unplayable();
  p.currentTrack = a;
  p.queue = [b, c];
  p.finishByCaller = true;

  await p.play(0);
  h.dispose(p);

  assert.equal(p.currentTrack, c, "셋째 곡에서 멈춰 둔다");
  assert.equal(p.lifecycle.parked, true);
  assert.equal(seen.includes("end:queue-end"), false);
  assert.equal(calls.persists.includes("remove"), false);
});

test("소리를 낸 곡이 끝나면 연달아 실패한 수를 다시 센다", async () => {
  const p = h.makePlayer();
  playing(p, yt("f5fffffffff"), 5_000);
  p.failedTracks = 2;

  await p.onTrackEnd("idle");
  h.dispose(p);
  assert.equal(p.failedTracks, 0);

  const q = h.makePlayer();
  playing(q, yt("f6fffffffff"), 4_999);
  q.failedTracks = 1;
  await q.onTrackEnd("skip");
  h.dispose(q);
  assert.equal(q.failedTracks, 1, "5초도 못 낸 곡은 살아난 것이 아니다");
});

test("끊긴 곡을 다시 열다 실패하면(곡 탓이 아니면) 그 위치에서 멈춰 둔다. 들리던 곡을 넘기지 않고 세지도 않는다", async () => {
  const p = h.makePlayer();
  const track = starved(p, yt("f7fffffffff", { duration: 2 * 3600 }), 30_000);
  const next = cached("f8fffffffff");
  p.queue = [next];
  unplayable();

  await p.onTrackEnd("idle");
  h.dispose(p);

  assert.equal(p.currentTrack, track);
  assert.equal(p.lifecycle.parked, true);
  assert.equal(p.lastPlaybackPosition, 30_000);
  assert.deepEqual(p.queue, [next]);
  assert.equal(p.failedTracks, 0);
});

test("끊김 복구를 다 쓴 곡은 그 위치에서, 멎어서 넘긴 곡은 연달아 실패 한도에 닿으면 그 곡에서 멈춰 둔다. 다음 곡을 열지 않는다", async () => {
  for (const [reason, setup] of [
    ["idle", (p: Player, t: QueuedTrack) => ((p._retryTrack = t), (p.retry = { used: 2, stalled: 0 }), starved(p, t, 1_000))],
    ["stuck", (p: Player, t: QueuedTrack) => playing(p, t, 0)],
  ] as const) {
    h.reset();
    const p = h.makePlayer();
    const t = yt("f9fffffffff");
    setup(p, t);
    p.queue = [cached("g0ggggggggg")];
    p.failedTracks = 2;

    await p.onTrackEnd(reason);
    h.dispose(p);

    assert.equal(p.currentTrack, t, reason);
    assert.equal(p.lifecycle.parked, true, reason);
    assert.equal(p.queue.length, 1, `${reason}: 대기열은 둔다`);
    assert.equal(calls.spawns.length, 0, `${reason}: 다음 곡을 열지 않는다`);
  }
});

// ── 실패의 범위 · 그 곡에서 멈춰 둠 ────────────────────────────────────

// 다음 곡도 같이 안 되는 실패(망 끊김)
function networkDown() {
  behavior.stream = () => ({ url: "https://media.test/down", duration: 2 * 3600 });
  behavior.fetch = () => {
    throw Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" });
  };
}

// 이 곡만 안 되는 실패(영상이 내려감)
function removedVideo() {
  behavior.stream = () => {
    throw codedError("unavailable-contents", "영상이 내려갔습니다");
  };
}

test("환경 탓(망 끊김)은 넘기지 않고 그 곡 · 그 위치에서 멈춰 둔다. 세지 않고, 멈춤으로 저장하고, 한 번 알린다", async () => {
  const p = h.makePlayer();
  const [a, b] = [yt("e1eeeeeeeee"), yt("e2eeeeeeeee")];
  networkDown();
  p.currentTrack = a;
  p.queue = [b];

  const result = await p.play(42_000);
  h.dispose(p);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "parked");
  assert.equal(p.currentTrack, a);
  assert.deepEqual(p.queue, [b], "멀쩡한 다음 곡을 태우지 않는다");
  assert.equal(p.lifecycle.parked, true);
  assert.equal(p.lastPlaybackPosition, 42_000);
  assert.equal(p.pause.userPaused, true);
  assert.equal(p.failedTracks, 0);
  assert.ok(calls.persists.includes("parked"));
  assert.equal(calls.sent.map(textOf).filter((t) => t.includes("다음 곡으로 넘기지 않고 일시정지했어요")).length, 1);
});

test("곡 탓(영상 내려감)은 넘기고 세지 않는다. 다섯이 이어져도 멈추지 않는다. 대기열의 같은 곡도 같이 뺀다", async () => {
  const p = h.makePlayer();
  const dead = ["d1ddddddddd", "d2ddddddddd", "d3ddddddddd", "d4ddddddddd", "d5ddddddddd"].map((id) => yt(id));
  const copy = yt("d1ddddddddd");
  removedVideo();
  p.currentTrack = dead[0];
  p.queue = [...dead.slice(1), copy];

  await p.play(0);
  h.dispose(p);

  assert.equal(p.lifecycle.parked, false, "멈춰 두지 않는다");
  assert.equal(p.currentTrack, null, "다 넘기고 대기열이 끝났다");
  assert.equal(p.failedTracks, 0);
  assert.ok(calls.sent.map(textOf).some((t) => t.includes("대기열에 같은 곡이 1번 더 있어서 함께 뺐어요.")));
});

test("곡 탓 넘기기 알림은 셋까지 하나씩, 그 뒤는 모았다가 대기열이 끝나면 한 번에", async () => {
  const p = h.makePlayer();
  const dead = ["k1kkkkkkkkk", "k2kkkkkkkkk", "k3kkkkkkkkk", "k4kkkkkkkkk", "k5kkkkkkkkk", "k6kkkkkkkkk"].map((id) => yt(id));
  removedVideo();
  p.currentTrack = dead[0];
  p.queue = dead.slice(1);

  await p.play(0);
  h.dispose(p);

  const sent = calls.sent.map(textOf);
  assert.equal(sent.filter((t) => t.includes("재생할 수 없는 ") && t.includes("곡을 더 넘겼어요")).length, 1);
  assert.ok(
    sent.some((t) => t.includes("재생할 수 없는 2곡을 더 넘겼어요.")),
    sent.join("\n---\n"),
  );
});

test("까닭 모를 실패만 센다: 모름 · 곡 탓 · 모름 · 곡 탓 · 모름이면 다섯째(모름 셋째)에서 멈춰 둔다", async () => {
  const p = h.makePlayer();
  const ids = ["m1mmmmmmmmm", "m2mmmmmmmmm", "m3mmmmmmmmm", "m4mmmmmmmmm", "m5mmmmmmmmm", "m6mmmmmmmmm"];
  const list = ids.map((id) => yt(id));
  const trackFailures = new Set([ids[1], ids[3]]);
  behavior.stream = (track) => {
    if (trackFailures.has(String(track.id))) throw codedError("unavailable-contents", "영상이 내려갔습니다");
    return { url: "https://media.test/dead", duration: 2 * 3600 };
  };
  behavior.fetch = () => {
    throw new Error("끊김");
  };
  p.currentTrack = list[0];
  p.queue = list.slice(1);

  await p.play(0);
  h.dispose(p);

  assert.equal(p.currentTrack, list[4]);
  assert.equal(p.lifecycle.parked, true);
  assert.deepEqual(p.queue, [list[5]]);
});

test("자동재생이 고른 곡은 갈래와 상관없이 따로 세어 셋이면 자동재생을 끈다(곡 탓을 세지 않아 끝없이 고르지 않게)", async () => {
  const p = scripted();
  removedVideo();
  p.setAutoplay("팝");
  let picks = 0;
  p.autoplayAs = async () => {
    picks += 1;
    if (!p.autoplay) return false;
    trackState.enqueue(p, [{ ...yt(`a${picks}aaaaaaaaa`.slice(0, 11)), autoplay: true }]);
    trackState.shiftNext(p);
    await p.play(0);
    return true;
  };
  p.currentTrack = { ...yt("a0aaaaaaaaa"), autoplay: true };

  await p.play(0);
  h.dispose(p);

  assert.equal(p.autoplay, false);
  assert.ok(picks <= 3, `고른 횟수 ${picks}`);
});

test("멈춰 둔 곡: 멎음 감시가 넘기지 않는다", async () => {
  const p = h.makePlayer();
  networkDown();
  p.currentTrack = yt("w1wwwwwwwww");
  await p.play(0);
  p.watch.checkIdle();
  await tick(5);
  h.dispose(p);

  assert.equal(p.lifecycle.parked, true);
  assert.equal(p.currentTrack?.id, "w1wwwwwwwww");
});

test("멈춰 둔 곡에서 넘기면 다음 곡을 연다. 멈춤은 풀린 채(사람이 멈춰 둔 채 실패했으면 멈춘 채)", async () => {
  for (const userPausedBefore of [false, true]) {
    h.reset();
    const p = h.makePlayer();
    const next = cached("s2sssssssss");
    networkDown();
    p.currentTrack = yt("s1sssssssss");
    p.queue = [next];
    if (userPausedBefore) p.pause.setUser(true);
    await p.play(0);
    assert.equal(p.lifecycle.parked, true);

    assert.equal(p.skip(), true);
    await p.untilSwitched();
    h.dispose(p);

    assert.equal(p.currentTrack, next, `멈춤 ${userPausedBefore}`);
    assert.equal(p.lifecycle.parked, false);
    assert.equal(p.pause.userPaused, userPausedBefore);
  }
});

test("▶ 는 멈춰 둔 곡을 그 위치부터 다시 연다. 다시 실패하면 다시 멈춰 둔다. 넘기기가 걸려 있으면 아무것도 안 한다", async () => {
  const p = h.makePlayer();
  networkDown();
  p.currentTrack = yt("r1rrrrrrrrr");
  await p.play(30_000);
  assert.equal(p.lifecycle.parked, true);

  const asked: number[] = [];
  const stream = behavior.stream;
  behavior.stream = (track, options) => {
    asked.push(p.getCurrentTime());
    return stream!(track, options);
  };
  await p.retryParked();
  assert.equal(p.lifecycle.parked, true, "망이 아직 끊겨 있다");
  assert.equal(p.lastPlaybackPosition, 30_000);
  assert.ok(asked.length > 0);

  p._endScheduled = true;
  const before = asked.length;
  await p.retryParked();
  assert.equal(asked.length, before, "방금 넘겼으면 다시 열지 않는다");
  p._endScheduled = false;
  h.dispose(p);
});

test("멈춰 둔 곡: 음성이 다시 붙어도 저절로 열지 않는다. 대시보드는 곡을 멈춤으로 보인다", async () => {
  const p = h.makePlayer();
  networkDown();
  let opens = 0;
  const stream = behavior.stream;
  behavior.stream = (track, options) => {
    opens += 1;
    return stream!(track, options);
  };
  p.currentTrack = yt("v1vvvvvvvvv");
  await p.play(0);
  const before = opens;

  await p.onVoiceRecovered();

  assert.equal(opens, before, "음원을 다시 묻지 않는다");
  assert.equal(p.lifecycle.parked, true);
  assert.equal(soundAttached(p), true);
  assert.equal(playbackStatus(p).paused, true);
  h.dispose(p);
});

test("소리가 재생 중일 때 멈춰 두면(위치 이동 · 음성 복구가 다시 열다 실패) 소리를 내려도 곡 끝 처리가 돌지 않는다", async () => {
  const p = h.makePlayer();
  const track = yt("y1yyyyyyyyy");
  const next = cached("y2yyyyyyyyy");
  p.currentTrack = track;
  p.queue = [next];
  // 옛 리소스가 아직 재생 중이다. 내리면 오디오 플레이어가 Idle 을 동기로 낸다
  p.audioPlayer.state = fake<typeof p.audioPlayer.state>({ status: AudioPlayerStatus.Playing });
  p.audioPlayer.stop = () => {
    p.audioPlayer.state = fake<typeof p.audioPlayer.state>({ status: AudioPlayerStatus.Idle });
    p.onPlayerIdle("idle");
    return true;
  };

  p.park(61_000, { kind: "dropped" });
  await tick(5);
  h.dispose(p);

  assert.equal(p._endScheduled, false);
  assert.equal(p.currentTrack, track, "넘기지 않는다");
  assert.equal(p.lifecycle.parked, true);
  assert.equal(p.lastPlaybackPosition, 61_000);
});

test("멈춰 둔 동안은 자동재생 곡을 미리 고르지 않는다", async () => {
  const p = h.makePlayer();
  networkDown();
  p.setAutoplay("팝");
  p.currentTrack = yt("x1xxxxxxxxx");
  await p.play(0);
  assert.equal(p._canPrefetchAutoplay(), false);
  h.dispose(p);
});

test("음성에 붙지 못하면 play 는 넘기거나 세지 않고 voice-failed 를 돌려주고, 세션을 남긴 채 플레이어를 버린다. 음성 복구 중이면 붙지 않는다", async () => {
  const p = h.makePlayer({ connected: false });
  behavior.connect = () => {
    throw codedError("voice-failed", "음성 채널에 붙지 못했습니다");
  };
  p.currentTrack = yt("c1ccccccccc");
  p.queue = [yt("c2ccccccccc")];

  const result = await p.play(0);
  h.dispose(p);

  assert.equal(!result.ok && result.code, "voice-failed");
  assert.equal(p.failedTracks, 0);
  assert.equal(p.lifecycle.disposed, true);
  assert.equal(calls.persists.includes("remove"), false);
});

// ── 조작 ─────────────────────────────────────────────────────────────

test("새 플레이어는 그 서버에서 마지막으로 정한 볼륨으로 시작한다", async () => {
  await guildSettings.saveVolume("g7", 25);
  const p = h.makePlayer({ guildId: "g7" });
  assert.equal(p.volume, 25);
  h.dispose(p);
  await guildSettings.saveVolume("g7", 100);
});

test("볼륨은 0~100 으로 자르고 지금 출력 스트림에 볼륨 배율(dB)로 바로 건다", () => {
  const p = h.makePlayer();
  let applied: number | null = null;
  p.playback = playback({
    output: {
      setVolume: (v: number) => {
        applied = v;
      },
    },
  });

  assert.equal(p.setVolume(150), 100);
  assert.equal(applied, 1);
  assert.equal(p.setVolume(50), 50);
  assert.equal(applied, gainOf(50));
  assert.equal(p.setVolume(-3), 0);
  h.dispose(p);
  assert.deepEqual(calls.persists, [], "조작은 저장을 모른다(세션 미러가 주기 저장 때 바뀐 필드를 쓴다)");
});

test("대기열 조작: 빼기 · 옮기기", () => {
  const p = h.makePlayer();
  const [a, b, c] = [yt("c1ccccccccc", { duration: 10 }), yt("c2ccccccccc", { duration: 20 }), yt("c3ccccccccc", { duration: 0 })];
  p.currentTrack = yt("c0ccccccccc", { duration: 5 });
  p.queue = [a, b, c];

  assert.deepEqual(queueInfoOf(p), { queue: [a, b, c] });
  const from = sink.buffer.length;
  assert.equal(p.moveInQueue(0, 2), true);
  assert.deepEqual(p.queue, [b, c, a]);
  assert.equal(p.removeFromQueue(1), c);
  const lines = sink.buffer.slice(from).map((e) => e.text);
  assert.ok(
    lines.some((t) => t.startsWith("대기열 이동:") && t.endsWith("1번 → 3번")),
    "로그의 번호는 대기열 화면처럼 1부터",
  );
  assert.ok(lines.some((t) => t.startsWith("대기열 제거: 2번 ")));
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

test("위치 이동 로그: 출발은 지금 재생 위치다(앞 이동의 목표가 아니다)", async () => {
  const p = scripted();
  p.playAs = () => {};
  p.currentTrack = yt("e3eeeeeeeee");
  // 43초로 옮겨 1초 틀었다
  p.lastPlaybackPosition = 43000;
  p.playback = fake<CurrentPlayback>({ startOffsetMs: 43000, resource: fake<AudioResource>({ playbackDuration: 1000 }) });
  await p.seek(12000);
  h.dispose(p);
  const line = sink.buffer.findLast((e) => e.text.includes("위치 이동:"))?.text ?? "";
  assert.match(line, /44초 → 12초/);
});

test("이전곡: 기록이 있으면 되감고 previous 로 멈춘다. 없으면 false", () => {
  const p = h.makePlayer();
  p.currentTrack = yt("f1fffffffff");
  assert.equal(p.previous(), false);

  p.previousTracks = [yt("f0fffffffff")];
  assert.equal(p.previous(), true);
  h.dispose(p);
  assert.equal(p._endReason, "previous");
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
  assert.equal(p._endReason, null);
  assert.equal(h.fakeAudioOf(p).stops, 0);
});

test("스킵: 곡이 있으면 원인을 적고 멈춘다. 없으면 false", () => {
  const p = h.makePlayer();
  assert.equal(p.skip(), false);
  p.currentTrack = yt("g1ggggggggg");
  p.idle.emptyTimer = setTimeout(() => {}, 1000);
  assert.equal(p.skip("jump"), true);
  h.dispose(p);
  assert.equal(p._endReason, "jump");
  assert.equal(p.idle.emptyTimer, null);
  assert.deepEqual(calls.persists, []);
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

test("자동재생: 모르는 장르면 setAutoplay 로 끈다(로그 · 미리 선택한 곡 정리. 세션은 주기 저장이 쓴다)", async () => {
  const p = h.makePlayer();
  p.autoplay = "지금은 없는 장르";
  assert.equal(await p._continueAutoplay("지금은 없는 장르"), false);
  h.dispose(p);
  assert.equal(p.autoplay, false);
});

test("상태 요약과 재생 여부(화면 쪽 요약이 플레이어 상태를 읽는다)", () => {
  const p = h.makePlayer();
  assert.equal(soundAttached(p), false);
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Buffering };
  assert.equal(soundAttached(p), true);
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Playing };
  assert.deepEqual(playbackStatus(p), { playing: true, paused: false, volume: p.volume, loop: false });
  // 멈춤은 오디오 상태가 아니라 플레이어 값(사람의 뜻 · 억제 사유). 곡을 여는 중에도 멈춰 있어야 하면 멈춤
  h.fakeAudioOf(p).state = { status: AudioPlayerStatus.Buffering };
  p.pause.setUser(true);
  const s = playbackStatus(p);
  h.dispose(p);
  assert.deepEqual(s, { playing: false, paused: true, volume: p.volume, loop: false });
});

// ── 음성 채널 상태 문구 ────────────────────────────────────────────────

test("음성 채널 상태: 권한이 있고 사람이 쓴 문구가 아니면 쓴다", async () => {
  voiceChannelStatus._internals._reset();
  const p = h.makePlayer();
  const puts: Array<[string, string]> = [];
  p.guild.client.rest = fake<Client["rest"]>({ put: async (route: string, { body }: { body: { status: string } }) => puts.push([route, body.status]) });
  p.guild.channels.cache.set("voice1", fake<VoiceBasedChannel>({ id: "voice1", type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) }));

  await p.updateVoiceStatus("곡 제목");
  voiceChannelStatus.observe("voice1", "사람이 쓴 것");
  await p.updateVoiceStatus("다른 곡");
  h.dispose(p);

  assert.deepEqual(puts, [["/channels/voice1/voice-status", "곡 제목"]]);
});

test("음성 채널 상태: 옮겨지면 옛 채널에 우리가 쓴 상태를 지우고 새 채널에 쓴다. 옛 채널에 사람이 쓴 것은 둔다", async () => {
  voiceChannelStatus._internals._reset();
  const p = h.makePlayer();
  const puts: Array<[string, string]> = [];
  p.guild.client.rest = fake<Client["rest"]>({ put: async (route: string, { body }: { body: { status: string } }) => puts.push([route, body.status]) });
  for (const id of ["voice1", "voice2", "voice3"]) p.guild.channels.cache.set(id, fake<VoiceBasedChannel>({ id, type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) }));
  p.voiceChannel = fake<VoiceBasedChannel>({ id: "voice1" });
  await p.updateVoiceStatus("곡 제목");

  p.voiceChannel = fake<VoiceBasedChannel>({ id: "voice2" });
  p.movedVoiceStatus("voice1");
  await tick(10);
  assert.deepEqual(puts.slice(1), [
    ["/channels/voice1/voice-status", ""],
    ["/channels/voice2/voice-status", config.voiceStatus.idleText],
  ]);

  // 곡이 있으면 곡 제목. 옛 채널의 상태를 사람이 바꿨으면 건드리지 않는다
  voiceChannelStatus.observe("voice2", "사람이 쓴 것");
  p.currentTrack = fake<QueuedTrack>({ title: "지금 곡" });
  p.voiceChannel = fake<VoiceBasedChannel>({ id: "voice3" });
  p.movedVoiceStatus("voice2");
  await tick(10);
  h.dispose(p);
  assert.deepEqual(puts.slice(3), [["/channels/voice3/voice-status", `${config.voiceStatus.playingPrefix}지금 곡`]]);
});

// 다운로드가 제목을 바꿀 수 있다(유튜브 영상의 제목 · 직접 링크의 파일 태그). 채널 상태는 재생을 시작할 때만 쓰므로 따로 갱신해야 한다
test("음성 채널 상태: 곁에서 다운로드하며 지금 곡의 제목을 고치면 채널 상태도 고친다", async () => {
  voiceChannelStatus._internals._reset();
  const p = h.makePlayer();
  const puts: string[] = [];
  p.guild.client.rest = fake<Client["rest"]>({ put: async (_route: string, { body }: { body: { status: string } }) => puts.push(body.status) });
  p.guild.channels.cache.set("voice1", fake<VoiceBasedChannel>({ id: "voice1", type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) }));
  p.voiceChannel = fake<VoiceBasedChannel>({ id: "voice1" });
  const track = yt("tagged", { title: "track_01" });
  p.currentTrack = track;
  const { playingPrefix } = config.voiceStatus;

  p.downloader.downloadTrack = async (one) => {
    one.title = "태그의 제목";
    return "file";
  };
  p._startBackgroundDownload();
  await tick(10);
  assert.deepEqual(puts, [`${playingPrefix}태그의 제목`]);

  // 제목이 그대로면 쓰지 않는다
  p.downloader.downloadTrack = async () => "file";
  p._startBackgroundDownload();
  await tick(10);
  h.dispose(p);
  assert.equal(puts.length, 1);
});

test("다운로드가 곡 정보를 고치면(지금 곡 · 예열한 대기열 곡) 세션 사본을 다시 쓰게 표시하고 패널 · 대시보드에 알린다. 그대로면 알리지 않는다", async () => {
  const p = h.makePlayer();
  const refreshed: Player[] = [];
  const off = playerEvents.on("refresh", async (q) => void refreshed.push(q));
  try {
    p.currentTrack = yt("current", { title: "track_01" });
    p.downloader.downloadTrack = async (one) => {
      one.album = "태그 앨범";
      return "file";
    };
    p._startBackgroundDownload();
    await tick(10);
    assert.deepEqual([refreshed.length, p.persistence.dirty], [1, true], "지금 곡");

    p.persistence.dirty = false;
    const queued = yt("queued", { title: "track_02" });
    p.downloader.warm = async (one) => {
      if (one) one.artist = "태그 가수";
    };
    await p.warmer.warm(queued);
    assert.deepEqual([refreshed.length, p.persistence.dirty], [2, true], "예열한 대기열 곡");

    p.persistence.dirty = false;
    p.downloader.warm = async () => {};
    await p.warmer.warm(queued);
    assert.deepEqual([refreshed.length, p.persistence.dirty], [2, false], "그대로");
  } finally {
    off();
    h.dispose(p);
  }
});

test("파일 태그를 찾으면 그 음원의 곡(지금 곡 · 대기열)에 반영하고 한 번 새로 그린다. 다른 키는 그대로, 그림만 생겨도 새로 그린다", async () => {
  const p = h.makePlayer();
  const refreshed: Player[] = [];
  const off = playerEvents.on("refresh", async (q) => void refreshed.push(q));
  try {
    const url = "https://files.test/tagged.mp3";
    const fileTrack = (title: string): QueuedTrack => ({ title, pageUrl: url, requestKey: url, audioUrl: url, platform: "direct", duration: 0 });
    p.currentTrack = fileTrack("tagged");
    p.queue.push(fileTrack("tagged"), yt("other", { title: "track_09" }));
    const key = audioKeyOf(url)!;
    const tags = { title: "태그 제목", artist: "태그 가수", album: null };

    // 갱신 알림은 같은 틱의 것을 묶어 다음 틱에 낸다
    const settle = () => new Promise((r) => setImmediate(r));
    p.takeFileTags("dl:다른 키", { tags, art: null });
    await settle();
    assert.equal(refreshed.length, 0, "다른 키");

    p.takeFileTags(key, { tags, art: null });
    await settle();
    assert.deepEqual([p.currentTrack.title, p.queue[0].title, p.queue[0].artist, p.queue[1].title], ["태그 제목", "태그 제목", "태그 가수", "track_09"]);
    assert.deepEqual([refreshed.length, p.persistence.dirty], [1, true]);

    p.takeFileTags(key, { tags, art: { fingerprint: "f", width: 1, height: 1 } });
    await settle();
    assert.equal(refreshed.length, 2, "곡 정보는 그대로여도 그림이 생겼다");
  } finally {
    off();
    h.dispose(p);
  }
});

test("예열의 박자가 지금 곡과 대기열을 파일 태그 찾기에 넘긴다(서명이 그대로여도)", () => {
  const p = h.makePlayer();
  const asked: Array<Array<QueuedTrack | null>> = [];
  p.warmer.wantArt = (tracks) => void asked.push(tracks);
  p.currentTrack = yt("now", { title: "track_01" });
  p.queue.push(yt("next", { title: "track_02" }));
  p.warmer.tick();
  p.warmer.tick();
  h.dispose(p);
  assert.equal(asked.length, 2);
  assert.deepEqual(
    asked[1].map((track) => track?.title),
    ["track_01", "track_02"],
  );
});

test("음성 채널 상태: 쓰기가 실패하면 던진다(부르는 쪽의 bestEffort 가 남긴다)", async () => {
  voiceChannelStatus._internals._reset();
  const p = h.makePlayer();
  p.guild.client.rest = fake<Client["rest"]>({
    put: async () => {
      throw new Error("Missing Access");
    },
  });
  p.guild.channels.cache.set("voice1", fake<VoiceBasedChannel>({ id: "voice1", type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) }));
  await assert.rejects(p.updateVoiceStatus("곡 제목"), /Missing Access/);
  h.dispose(p);
});

test("오디오 플레이어의 전이는 누가 쏘든 이 서버의 문맥에서 돈다(새어 나온 오류가 이 서버로 돌아온다)", () => {
  const seen: Array<string | null> = [];
  class Probe extends h.Player {
    _onAudioState() {
      seen.push(currentGuild());
    }
  }
  const p = h.makePlayer({ as: Probe, guildId: "g1" });
  inGuild("g-other", () => p.audioPlayer.emit("stateChange", { status: "idle" }, { status: "buffering" }));
  h.dispose(p);
  assert.deepEqual(seen, ["g1"]);
});

test("버리기: stay 면 음성 채널에 남긴 채 연결만 정리하고(서버 하나 다시 시작), 아니면 나간다", async () => {
  const stay = h.makePlayer();
  const kept = stay.connection as unknown as { destroyed: string[] };
  await stay.dispose({ reason: "시험", session: "keep", stay: true, end: "stop" });
  assert.deepEqual(kept.destroyed, ["stay"]);

  const leave = h.makePlayer();
  const left = leave.connection as unknown as { destroyed: string[] };
  await leave.dispose({ reason: "시험", session: "keep", end: "stop" });
  assert.deepEqual(left.destroyed, ["leave"]);
});

// ── 멈춘 동안의 조작(쉬어 두기를 넣기 전에 지금 동작을 묶는다) ──

// 연 곡을 끝 처리까지 보낸다. 가짜 오디오 플레이어는 멈춰도 Idle 을 알리지 않아 테스트가 대신 쏜다
async function endNow(p: Player) {
  p.audioPlayer.emit(AudioPlayerStatus.Idle);
  await p.untilSwitched();
}

test("사람이 멈춘 채 넘기면 다음 곡을 멈춘 채 연다(멈춤이 풀리지 않는다)", async () => {
  const p = h.makePlayer();
  const first = cached("pa1aaaaaaaa");
  const next = cached("pa2aaaaaaaa");
  p.currentTrack = first;
  p.queue = [next];
  await p.play(0);
  p.pause.setUser(true);

  assert.equal(p.skip(), true);
  await endNow(p);
  h.dispose(p);

  assert.equal(p.currentTrack, next);
  assert.equal(p.pause.userPaused, true);
  assert.equal(p.paused, true);
});

test("사람이 멈춘 채 마지막 곡을 넘기면 자동재생이 다음 곡을 잇는다(대기열을 끝내지 않는다)", async () => {
  const p = h.makePlayer();
  p.currentTrack = cached("pb1aaaaaaaa");
  await p.play(0);
  p.pause.setUser(true);
  p.autoplay = "pop";
  let asked = 0;
  p._continueAutoplay = async () => ((asked += 1), true);
  let finished = 0;
  p.finishQueue = async () => void (finished += 1);

  p.skip();
  await endNow(p);
  h.dispose(p);

  assert.equal(asked, 1);
  assert.equal(finished, 0);
});

test("사람이 멈춘 채 위치를 옮기면 멈춘 채 그 위치에서 다시 연다", async () => {
  const p = h.makePlayer();
  p.currentTrack = cached("pc1aaaaaaaa");
  await p.play(0);
  p.pause.setUser(true);

  await p.seek(42_000, "seek");
  h.dispose(p);

  assert.equal(p.pause.userPaused, true);
  assert.equal(p.lastPlaybackPosition, 42_000);
  assert.equal(p.getCurrentTime(), 42_000);
});

test("음성이 다시 붙으면 멈춰 있던 곡도 그 위치에서 다시 연다. 멈춤은 그대로", async () => {
  const p = h.makePlayer();
  p.currentTrack = cached("pd1aaaaaaaa");
  await p.play(30_000);
  p.pause.setUser(true);
  const opened = h.calls.resources.length;

  await p.onVoiceRecovered();
  h.dispose(p);

  assert.equal(h.calls.resources.length, opened + 1, "소리를 새로 연다");
  assert.equal(p.pause.userPaused, true);
  assert.equal(p.getCurrentTime(), 30_000);
});

test("동작 바뀜: 곡을 여는 중(소리가 아직 없다)에 넘기면 연 뒤에 넘긴다. 전에는 넘기기가 사라졌다. 열지 못하면 버린다(두 번 넘기지 않게)", async () => {
  const p = h.makePlayer();
  const next = cached("ps2aaaaaaaa");
  p.currentTrack = cached("ps1aaaaaaaa");
  p.queue = [next];
  const opening = p.play(0);
  assert.equal(p.lifecycle.starting, true);
  assert.equal(p.skip(), true);
  await opening;
  await endNow(p);
  assert.equal(p.currentTrack, next, "연 뒤에 넘겼다");

  h.reset();
  const failing = h.makePlayer();
  networkDown();
  failing.currentTrack = yt("pf1aaaaaaaa");
  const failed = failing.play(0);
  failing.skip();
  await failed;
  assert.equal(failing.lifecycle.parked, true, "열지 못해 멈춰 뒀다");
  assert.equal(failing._endWhileStarting, null, "여는 중에 받은 넘기기는 버렸다");
  h.dispose(failing);
  h.dispose(p);
});

// ── 쉬어 두기: 오래 멈춘 곡의 소리를 내리고 멈춤이 풀리면 그 위치부터 다시 연다 ──

// 열고 사람이 멈춘 곡. 가짜 오디오 플레이어를 실제처럼 Paused 로 둔다
async function pausedAt(p: Player, track: QueuedTrack, at: number) {
  p.currentTrack = track;
  await p.play(at);
  p.pause.setUser(true);
  p.audioPlayer.state = { ...p.audioPlayer.state, status: AudioPlayerStatus.Paused } as never;
}

test("쉬어 두기: 소리를 내리되 곡 · 위치 · 재생 정보는 남긴다. 그때의 Idle 은 곡 끝이 아니고, 화면은 곡을 멈춤으로 보인다", async () => {
  const p = h.makePlayer();
  const track = cached("ra1aaaaaaaa");
  await pausedAt(p, track, 30_000);
  const pb = p.playback;

  assert.equal(p.rest(), true);
  assert.equal(p.lifecycle.resting, true);
  assert.equal(p.playback, pb, "재생 정보(구간 · 라이브 판정 · 받아 둔 원본)는 그대로");
  assert.equal(p.resource, null);
  assert.equal(p.getCurrentTime(), 30_000);
  assert.equal(p.audioPlayer.state.status, AudioPlayerStatus.Idle);

  p.audioPlayer.emit(AudioPlayerStatus.Idle);
  await tick();
  assert.equal(p.currentTrack, track, "곡을 넘기지 않는다");
  assert.equal(soundAttached(p), true);
  assert.equal(playbackStatus(p).paused, true);
  assert.equal(p.rest(), false, "두 번 쉬지 않는다");
  h.dispose(p);
});

test("쉬어 두기: 멈춰야 하면 깨우지 않고, 풀리면 그 위치에서 한 번만 다시 연다. 넘기기가 걸려 있으면 깨우지 않는다", async () => {
  const p = h.makePlayer();
  await pausedAt(p, cached("rb1aaaaaaaa"), 45_000);
  p.rest();
  const opened = h.calls.resources.length;

  await p.wake();
  assert.equal(h.calls.resources.length, opened, "아직 멈춰 있다");

  p.pause.setUser(false);
  p._endScheduled = true;
  await p.wake();
  assert.equal(h.calls.resources.length, opened, "방금 넘겼으면 그 끝 처리가 다음 곡을 연다");
  p._endScheduled = false;

  await Promise.all([p.wake(), p.wake()]);
  h.dispose(p);
  assert.equal(h.calls.resources.length, opened + 1, "두 번 불러도 한 번 연다");
  assert.equal(p.lifecycle.resting, false);
  assert.equal(p.getCurrentTime(), 45_000);
});

test("쉬어 두기: 쉬는 중 넘기면 다음 곡을 멈춘 채 연다. 음성이 다시 붙어도 저절로 열지 않는다. 라이브는 쉬지 않는다", async () => {
  const p = h.makePlayer();
  const next = cached("rc2aaaaaaaa");
  await pausedAt(p, cached("rc1aaaaaaaa"), 10_000);
  p.queue = [next];
  p.rest();

  const opened = h.calls.resources.length;
  await p.onVoiceRecovered();
  assert.equal(h.calls.resources.length, opened, "음성 복구는 쉬어 둔 곡을 열지 않는다");

  assert.equal(p.skip(), true);
  await p.untilSwitched();
  assert.equal(p.currentTrack, next);
  assert.equal(p.lifecycle.resting, false);
  assert.equal(p.pause.userPaused, true, "멈춘 채");
  h.dispose(p);

  const live = h.makePlayer();
  await pausedAt(live, cached("rd1aaaaaaaa"), 0);
  if (live.playback) live.playback.isLive = true; // 재생이 판정한 라이브
  assert.equal(live.rest(), false);
  h.dispose(live);
});

test("쉬어 두기: 상주 자리의 정지는 쉬어 둔 곡도 끝내고 곡 없이 기다린다", async () => {
  const p = h.makePlayer();
  const seen = embeds(p);
  await pausedAt(p, cached("re1aaaaaaaa"), 5_000);
  p.queue = [cached("re2aaaaaaaa")];
  p.rest();

  await p.stopStaying();
  await p.untilSwitched();
  h.dispose(p);

  assert.equal(p.currentTrack, null);
  assert.deepEqual(p.queue, []);
  assert.ok(seen.includes("end:stay-stop"));
});
