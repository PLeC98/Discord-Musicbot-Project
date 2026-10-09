// 곡이 끝나는 길마다 무엇이 남나: "트랙 종료" 줄 · 등록부 · 세션 저장.
// 5단계가 끝 사유를 멈추는 쪽이 들고 가게 바꾸고(#8), 정리 입구를 하나로 모은다(#14). 그 전의 지금 답이다.
// 진짜 오디오 플레이어는 stop() 안에서 곧바로 Idle 을 내보낸다. 하네스의 가짜는 내보내지 않으므로 여기서 그렇게 만든다.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Client, GuildMember, VoiceBasedChannel, VoiceState } from "discord.js";
import type { Player } from "../../src/player/player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake } from "../helpers/fake.ts";
import * as h from "../helpers/player-harness.ts";
import { youtube as yt } from "../helpers/tracks.ts";
import { useExampleConfig } from "../helpers/example-config.ts";
import sink from "../../src/infra/log/sink.ts";
import { onVoiceStateUpdate } from "../../src/player/voice-presence.ts";
import * as controls from "../../src/usecases/controls.ts";
import * as playerEvents from "../../src/player/events.ts";

useExampleConfig();
beforeEach(() => h.reset());

const { calls, AudioPlayerStatus } = h;
const tick = (ms = 0) => new Promise((done) => setTimeout(done, ms));

// 곡 하나를 틀고 있는 플레이어. 멈추면 진짜처럼 Idle 을 내보낸다
function playingPlayer(track: QueuedTrack, playedMs = 30_000) {
  const p = h.makePlayer();
  const audio = h.fakeAudioOf(p);
  const stop = audio.stop.bind(audio);
  audio.stop = () => {
    const was = audio.state.status;
    stop();
    if (was !== AudioPlayerStatus.Idle) audio.emit(AudioPlayerStatus.Idle);
    return true;
  };
  p.currentTrack = track;
  p.playback = fake({ resource: { playbackDuration: playedMs, playStream: { destroy() {} }, volume: { setVolume() {} } } });
  audio.state = { status: AudioPlayerStatus.Playing };
  return p;
}

// 곡 끝 처리(60ms 뒤)까지 기다려 "트랙 종료" 줄을 모은다
async function endLines(act: () => unknown) {
  const from = sink.buffer.length;
  await act();
  await tick(120);
  return sink.buffer
    .slice(from)
    .filter((e) => e.text.includes("트랙 종료:"))
    .map((e) => e.text.slice(e.text.indexOf("트랙 종료:")));
}

const registered = (p: Player) => h.registryOf(p)?.get(p.guild.id) === p;

test("곡이 끝까지 돌면: 원인=idle, 다음 곡을 튼다", async () => {
  const next = yt("fffffffffff", { title: "다음 곡" });
  h.seedCache("yt:fffffffffff", next);
  const p = playingPlayer(yt("ggggggggggg", { title: "끝난 곡", duration: 200 }), 200_000);
  p.queue = [next];
  const lines = await endLines(() => h.fakeAudioOf(p).emit(AudioPlayerStatus.Idle));
  h.dispose(p);
  assert.deepEqual(lines, ['트랙 종료: "끝난 곡" (youtube) | 원인=idle']);
  assert.equal(p.currentTrack?.title, "다음 곡");
});

test("이전 곡: 원인=previous. 한곡 반복이면 같은 곡을, 아니면 이전 곡을 다시 튼다", async () => {
  const a = playingPlayer(yt("hhhhhhhhhhh", { title: "반복 곡" }));
  a.loop = "track";
  assert.deepEqual(await endLines(() => a.previous()), ['트랙 종료: "반복 곡" (youtube) | 원인=previous']);
  h.dispose(a);

  const before = yt("iiiiiiiiiii", { title: "앞 곡" });
  h.seedCache("yt:iiiiiiiiiii", before);
  const b = playingPlayer(yt("jjjjjjjjjjj", { title: "지금 곡" }));
  b.previousTracks = [before];
  assert.deepEqual(await endLines(() => b.previous()), ['트랙 종료: "지금 곡" (youtube) | 원인=previous']);
  h.dispose(b);
  assert.equal(b.currentTrack?.title, "앞 곡");
});

test("스킵: 원인=skip, 곡 이름이 남는다. 등록부에 남는다", async () => {
  const p = playingPlayer(yt("aaaaaaaaaaa", { title: "첫 곡" }));
  const lines = await endLines(() => p.skip());
  h.dispose(p);
  assert.deepEqual(lines, ['트랙 종료: "첫 곡" (youtube) | 원인=skip']);
});

// 모더레이터는 재적 · DJ 판정을 건너뛴다(usecases/permissions). 입구(controls)를 그대로 지난다
const moderatorOf = (p: Player) => ({ member: fake<GuildMember>({ id: "mod", guild: p.guild, permissions: { has: () => true }, voice: { channel: null } }) });

test("대기열의 마지막 곡을 건너뛰면 거절하지 않고 다 튼 것과 같이 끝낸다(세션 지움 · 나갈 예약)", async () => {
  const p = playingPlayer(yt("zzzzzzzzzzz", { title: "마지막 곡" }));
  p.queue = [];
  const lines = await endLines(async () => assert.equal((await controls.skip(p, moderatorOf(p))).ok, true));
  const leaveTimer = p.idle.emptyTimer;
  h.dispose(p);
  assert.deepEqual(lines, ['트랙 종료: "마지막 곡" (youtube) | 원인=skip']);
  assert.equal(p.currentTrack, null);
  assert.ok(calls.persists.includes("remove"), calls.persists.join(","));
  assert.ok(leaveTimer, "나갈 예약");
});

test("/stop: 원인=stop, 곡 이름이 남는다. 세션을 지운다", async () => {
  const p = playingPlayer(yt("bbbbbbbbbbb", { title: "둘째 곡" }));
  const lines = await endLines(() => controls.stop(p, moderatorOf(p)));
  assert.deepEqual(lines, ['트랙 종료: "둘째 곡" (youtube) | 원인=stop']);
  assert.ok(calls.persists.includes("remove"), calls.persists.join(","));
  assert.equal(registered(p), false, "버리면 등록부가 스스로 뺀다");
});

test("/leave: 원인=leave. 세션을 저장하고 지우지 않는다", async () => {
  const p = playingPlayer(yt("ccccccccccc", { title: "셋째 곡" }));
  const lines = await endLines(() => controls.leave(p.guild, moderatorOf(p), h.registryOf(p)!));
  assert.deepEqual(lines, ['트랙 종료: "셋째 곡" (youtube) | 원인=leave']);
  assert.ok(calls.persists.includes("leave"));
  assert.equal(calls.persists.includes("remove"), false);
});

test("강제 퇴장: 원인=forced-disconnect, 곡 이름이 남는다. 등록부에서 빠진다", async () => {
  const p = playingPlayer(yt("ddddddddddd", { title: "넷째 곡" }));
  p.guild.channels.cache.set("voice1", fake<VoiceBasedChannel>({ id: "voice1", isVoiceBased: () => true })); // 채널은 그대로 있다(지워졌으면 채널 사라짐)
  const client = p.guild.client as Client;
  const state = (channelId: string | null) => fake<VoiceState>({ id: "bot", channelId, guild: p.guild });
  const lines = await endLines(() => onVoiceStateUpdate(client, h.registryOf(p)!, state("voice1"), state(null)));
  assert.deepEqual(lines, ['트랙 종료: "넷째 곡" (youtube) | 원인=forced-disconnect']);
  assert.equal(registered(p), false);
});

test("혼자 남아 시간이 다 되면: 원인=inactivity-timeout, 곡 이름이 남는다. 세션을 지우고 등록부에서 빠진다", async () => {
  const p = playingPlayer(yt("eeeeeeeeeee", { title: "다섯째 곡" }));
  const members = Object.assign(new Map(), { filter: () => ({ size: 0 }) });
  p.guild.channels.cache.set("voice1", fake<VoiceBasedChannel>({ id: "voice1", members, isVoiceBased: () => true, permissionsFor: () => ({ has: () => false }) }));
  p.idle.aloneMs = 0;
  const lines = await endLines(() => p.idle.startAlone());
  assert.deepEqual(lines, ['트랙 종료: "다섯째 곡" (youtube) | 원인=inactivity-timeout']);
  assert.ok(calls.persists.includes("remove"), calls.persists.join(","));
  assert.equal(registered(p), false);
});

// ── 연달아 넘기기 ──────────────────────────────────────────────────
// 앞 곡의 끝 처리는 다음 곡을 튼 뒤에도 잠깐(세션 저장 · SQLite 잠금) 이어진다. 그 사이 다음 곡을 넘기면 그 곡의 끝이
// "겹쳐 들어온 끝"으로 버려져, 아무도 다음 곡을 틀지 않고 멎음 감시(10초)가 실패로 세며 끝냈다(2026-10-04 운영 로그)

// 첫 곡을 틀고 있고 대기열에 캐시된 두 곡이 있는 플레이어
function threeTracks() {
  const second = yt("bbbbbbbbbbb", { title: "둘째 곡" });
  const third = yt("ccccccccccc", { title: "셋째 곡" });
  h.seedCache("yt:bbbbbbbbbbb", second);
  h.seedCache("yt:ccccccccccc", third);
  const p = playingPlayer(yt("aaaaaaaaaaa", { title: "첫 곡" }));
  p.queue = [second, third];
  return p;
}

test("연달아 넘기기: 다음 곡을 트는 사이(세션 저장을 기다리는 사이) 그 곡을 넘겨도 끝을 버리지 않고 이어서 처리한다", async () => {
  const p = threeTracks();
  const persist = p.persistence.persistState.bind(p.persistence);
  p.persistence.persistState = async (reason: string) => {
    await tick(300); // 잠긴 DB
    return persist(reason);
  };
  try {
    p.skip();
    await tick(60);
    assert.equal(p.currentTrack?.title, "둘째 곡", "둘째 곡이 열렸고 첫 끝 처리는 저장을 기다린다");
    assert.equal(p.lifecycle.ending, true);
    p.skip();
    await tick(800);
    assert.equal(p.currentTrack?.title, "셋째 곡", "멎음 10초를 기다리지 않는다");
  } finally {
    h.dispose(p);
  }
});

test("연달아 넘기기: 미뤄 둔 끝은 그 사이 재생이 바뀌었으면 버린다(지금 곡을 잘못 넘기지 않는다)", async () => {
  const p = threeTracks();
  const persist = p.persistence.persistState.bind(p.persistence);
  let release = () => {};
  p.persistence.persistState = async (reason: string) => {
    await new Promise<void>((done) => (release = done));
    return persist(reason);
  };
  try {
    p.skip();
    await tick(60);
    p.skip(); // 둘째 곡의 끝을 미뤄 둔다
    await tick(20);
    p.playback = fake({ resource: { playbackDuration: 0, playStream: { destroy() {} }, volume: { setVolume() {} } } }); // 그 사이 재생이 바뀌었다
    release();
    await tick(200);
    assert.equal(p.currentTrack?.title, "둘째 곡", "바뀐 재생을 넘기지 않았다");
  } finally {
    h.dispose(p);
  }
});

test("넘긴 뒤의 끝 처리는 패널 고치기(디스코드 메시지 수정)를 기다리지 않는다", async () => {
  const p = threeTracks();
  const off = playerEvents.on("refresh", () => tick(300));
  try {
    p.skip();
    await tick(80);
    assert.equal(p.currentTrack?.title, "둘째 곡");
    assert.equal(p.lifecycle.ending, false, "끝 처리가 끝났다");
  } finally {
    off();
    h.dispose(p);
  }
});

test("연달아 실패해 멈출 때 실패한 곡을 모두 적는다", async () => {
  const p = threeTracks();
  const from = sink.buffer.length;
  try {
    for (let i = 0; i < 3; i++) await p.onTrackEnd("stuck");
    const line = sink.buffer.slice(from).find((e) => e.text.includes("연달아 실패해 재생을 멈춥니다"));
    assert.ok(line, "멈췄다");
    for (const title of ["첫 곡", "둘째 곡", "셋째 곡"]) assert.ok(line.text.includes(title), `${title}: ${line.text}`);
  } finally {
    h.dispose(p);
  }
});

// ── 곡이 바뀔 때까지 ──────────────────────────────────────────────
// 대시보드의 이전 곡 응답이 옛 곡을 실어 화면이 신호를 기다렸다(넘기기는 패널 고치기를 기다리는 사이 곡이 바뀌어 새 곡이 실렸다)

test("곡이 바뀔 때까지: 이전 곡 뒤 기다리면 되돌아간 곡이 지금 곡이다. 걸린 끝 처리가 없으면 곧바로", async () => {
  const before = yt("iiiiiiiiiii", { title: "앞 곡" });
  h.seedCache("yt:iiiiiiiiiii", before);
  const p = playingPlayer(yt("jjjjjjjjjjj", { title: "지금 곡" }));
  p.previousTracks = [before];
  try {
    const started = Date.now();
    await p.untilSwitched();
    assert.ok(Date.now() - started < 50, "걸린 끝 처리가 없으면 기다리지 않는다");

    p.previous();
    assert.equal(p.currentTrack?.title, "지금 곡", "멈춘 직후에는 아직 옛 곡");
    const switching = Date.now();
    await p.untilSwitched();
    assert.equal(p.currentTrack?.title, "앞 곡");
    assert.ok(Date.now() - switching < 500, "곡이 바뀌면 상한을 기다리지 않고 곧바로 풀린다");
  } finally {
    h.dispose(p);
  }
});

test("곡이 바뀔 때까지: 다음 곡을 여는 데 오래 걸려도 상한까지만 기다린다", async () => {
  const p = threeTracks();
  const persist = p.persistence.persistState.bind(p.persistence);
  p.persistence.persistState = async (reason: string) => {
    await tick(1000);
    return persist(reason);
  };
  try {
    p.skip();
    const started = Date.now();
    await p.untilSwitched(100);
    const waited = Date.now() - started;
    assert.ok(waited >= 90 && waited < 500, `${waited}ms`);
  } finally {
    await tick(1100);
    h.dispose(p);
  }
});
