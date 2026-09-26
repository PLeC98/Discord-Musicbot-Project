// 곡이 끝나는 길마다 무엇이 남나: "트랙 종료" 줄 · 등록부 · 세션 저장.
// 5단계가 끝 사유를 멈추는 쪽이 들고 가게 바꾸고(#8), 정리 입구를 하나로 모은다(#14). 그 전의 지금 답이다.
// 진짜 오디오 플레이어는 stop() 안에서 곧바로 Idle 을 내보낸다. 하네스의 가짜는 내보내지 않으므로 여기서 그렇게 만든다.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Client, VoiceBasedChannel, VoiceState } from "discord.js";
import type { MusicPlayer } from "../../src/player/Player.ts";
import type { QueuedTrack } from "../../src/player/track.ts";
import { fake } from "../helpers/fake.ts";
import * as h from "../helpers/playerHarness.ts";
import { youtube as yt } from "../helpers/tracks.ts";
import { useExampleConfig } from "../helpers/exampleConfig.ts";
import sink from "../../src/infra/log/sink.ts";
import { onVoiceStateUpdate } from "../../src/player/voicePresence.ts";

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

const registered = (p: MusicPlayer) => p.guild.client.players.get(p.guild.id) === p;

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

test("/stop: 원인=stop, 곡 이름이 남는다. 세션을 지운다", async () => {
  const p = playingPlayer(yt("bbbbbbbbbbb", { title: "둘째 곡" }));
  const lines = await endLines(() => p.stop());
  assert.deepEqual(lines, ['트랙 종료: "둘째 곡" (youtube) | 원인=stop']);
  assert.ok(calls.persists.includes("remove"), calls.persists.join(","));
  assert.equal(registered(p), true, "등록부에서 빼는 것은 부른 쪽이다");
});

test("/leave: 원인=stop. 세션을 저장하고 지우지 않는다", async () => {
  const p = playingPlayer(yt("ccccccccccc", { title: "셋째 곡" }));
  const lines = await endLines(() => p.leaveAndSave());
  assert.deepEqual(lines, ['트랙 종료: "셋째 곡" (youtube) | 원인=stop']);
  assert.ok(calls.persists.includes("leave"));
  assert.equal(calls.persists.includes("remove"), false);
});

// 5단계가 바꾼다(#25): 강제 퇴장이 적은 사유를 정리가 stop 으로 덮고, 곡 이름은 먼저 비워 ? 가 된다
test("강제 퇴장: 원인=stop 이고 곡 이름이 ? 다. 등록부에서 빠진다", async () => {
  const p = playingPlayer(yt("ddddddddddd", { title: "넷째 곡" }));
  const client = p.guild.client as Client;
  const state = (channelId: string | null) => fake<VoiceState>({ id: "bot", channelId, guild: p.guild });
  const lines = await endLines(() => onVoiceStateUpdate(client, state("voice1"), state(null)));
  assert.deepEqual(lines, ['트랙 종료: "?" (?) | 원인=stop']);
  assert.equal(registered(p), false);
});

// 5단계가 바꾼다(#25): 비활성 퇴장이 적은 사유도 정리가 stop 으로 덮는다
test("혼자 남아 시간이 다 되면: 원인=stop 이고 곡 이름이 ? 다. 등록부에서 빠진다", async () => {
  const p = playingPlayer(yt("eeeeeeeeeee", { title: "다섯째 곡" }));
  const members = Object.assign(new Map(), { filter: () => ({ size: 0 }) });
  p.guild.channels.cache.set("voice1", fake<VoiceBasedChannel>({ id: "voice1", members, isVoiceBased: () => true, permissionsFor: () => ({ has: () => false }) }));
  p.idle.aloneMs = 0;
  const lines = await endLines(() => p.idle.startAlone());
  assert.deepEqual(lines, ['트랙 종료: "?" (?) | 원인=stop']);
  assert.ok(calls.persists.includes("inactivity-timeout"));
  assert.equal(registered(p), false);
});
