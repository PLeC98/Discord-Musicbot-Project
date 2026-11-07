// src/usecases/join.ts: 봇 부르기. 기다리는 작업(기동 복원, 채널 조회) 뒤 중단되면(대시보드 세션 종료) 아무것도 바꾸지 않는다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { codedError } from "../../src/rules/error-kind.ts";
import { youtube } from "../helpers/tracks.ts";
import type { Guild, GuildMember, GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { Player } from "../../src/player/player.ts";
import { fake } from "../helpers/fake.ts";
import { openTempStore } from "../helpers/temp-store.ts";

const { join, joinChannel } = await import("../../src/usecases/join.ts");
const { beginShutdown, _resetShutdown } = await import("../../src/infra/shutdown-state.ts");
const { sessions } = await import("../../src/store/player-sessions.ts");

const store = openTempStore("join-");
after(() => store.close());

test("중단되면(go가 예외를 던짐) 남은 플레이어를 정리하지도 새로 만들지도 않는다", async () => {
  const channel = fake<VoiceBasedChannel>({ id: "v1", permissionsFor: () => ({ has: () => true }) });
  const guild = fake<Guild>({ id: "g-join", members: { me: { voice: { channel: null } } }, channels: { cache: new Map() } });
  const member = fake<GuildMember>({ id: "u1", voice: { channel } });
  const existing = fake<Player>({ voice: { isAlive: () => false }, dispose: () => assert.fail("정리하지 않는다") });
  const players = new Map<string, Player>([["g-join", existing]]);
  const ended = () => {
    throw new Error("세션이 끝났다");
  };
  await assert.rejects(join({ players }, { guild, member, textChannel: fake<GuildTextBasedChannel>({ id: "t1" }) }, { go: ended }), /세션이 끝났다/);
  assert.equal(players.get("g-join"), existing, "그대로");
});

test("종료 중이면 플레이어를 만들기 전에 bot-shutting-down 으로 거절한다. 남은 플레이어의 정리를 기다린 뒤에도 다시 확인하고 go 를 다시 호출한다", async (t) => {
  t.after(() => _resetShutdown());
  const channel = fake<VoiceBasedChannel>({ id: "v1", permissionsFor: () => ({ has: () => true }) });
  const guild = fake<Guild>({ id: "g-stop", members: { me: { voice: { channel: null } } }, channels: { cache: new Map() } });
  const member = fake<GuildMember>({ id: "u1", voice: { channel } });
  const text = fake<GuildTextBasedChannel>({ id: "t1" });

  beginShutdown();
  const none = new Map<string, Player>();
  const made: string[] = [];
  none.set = (id: string, player: Player) => (made.push(id), Map.prototype.set.call(none, id, player));
  assert.deepEqual(await join({ players: none }, { guild, member, textChannel: text }), { kind: "refused", code: "bot-shutting-down" });
  assert.deepEqual(made, [], "플레이어를 만들지 않는다");
  _resetShutdown();

  // 남은 플레이어를 정리하는 사이 종료가 시작됐다
  const existing = fake<Player>({ voice: { isAlive: () => false }, dispose: async () => beginShutdown() });
  const players = new Map<string, Player>([["g-stop", existing]]);
  assert.deepEqual(await join({ players }, { guild, member, textChannel: text }), { kind: "refused", code: "bot-shutting-down" });
  assert.equal(players.get("g-stop"), existing, "새 플레이어를 만들지 않는다");
  _resetShutdown();

  // 정리하는 사이 상주 설정이 바뀌었다(go 가 두 번째 호출에서 예외를 던진다)
  let goes = 0;
  const replaced = fake<Player>({ voice: { isAlive: () => false }, dispose: async () => undefined });
  const go = () => {
    goes += 1;
    if (goes === 2) throw new Error("바뀜");
  };
  await assert.rejects(joinChannel({ players: new Map([["g-stop", replaced]]) }, { guild, channel, textChannel: text }, { go }), /바뀜/);
  assert.equal(goes, 2);
});

test("세션을 복원하다 종료 중이라 붙지 못하면 bot-shutting-down 으로 거절하고 세션을 남긴 채 플레이어를 정리한다", async () => {
  const channel = fake<VoiceBasedChannel>({ id: "v1", permissionsFor: () => ({ has: () => true }) });
  const guild = fake<Guild>({ id: "g-rs", members: { me: { voice: { channel: null } } }, channels: { cache: new Map() } });
  const member = fake<GuildMember>({ id: "u1", voice: { channel } });
  sessions().saveSession("g-rs", { voiceChannelId: "v1", textChannelId: "t1", volume: 100, loopMode: "off", autoplay: null, userPaused: false, positionMs: 0 });
  sessions().setCurrent("g-rs", { ...youtube("aaaaaaaaaaa"), requestedBy: { id: "u1" } });
  const disposed: unknown[] = [];
  const player = fake<Player>({
    voice: { isAlive: () => false },
    bindChannels: () => {},
    persistence: { restoreFromState: async () => Promise.reject(codedError("bot-shutting-down", "종료 중")) },
    dispose: async (o: { end: string }) => void disposed.push(o.end),
  });
  const result = await join({ players: new Map([["g-rs", player]]) }, { guild, member, textChannel: fake<GuildTextBasedChannel>({ id: "t1" }) });
  assert.deepEqual(result, { kind: "refused", code: "bot-shutting-down" });
  assert.deepEqual(disposed, ["replaced", "connect-failed"]);
  assert.ok(sessions().load("g-rs")?.current, "세션을 남긴다");
  sessions().removeSession("g-rs");
});

test("붙는 사이 종료가 시작돼 연결이 거절되면 voice-failed 가 아니라 bot-shutting-down 으로 거절하고 플레이어를 정리한다(세션은 남긴다)", async () => {
  const channel = fake<VoiceBasedChannel>({ id: "v1", permissionsFor: () => ({ has: () => true }) });
  const guild = fake<Guild>({ id: "g-cf", members: { me: { voice: { channel: null } } }, channels: { cache: new Map() } });
  const member = fake<GuildMember>({ id: "u1", voice: { channel } });
  const disposed: unknown[] = [];
  const player = fake<Player>({
    voice: { isAlive: () => false, connect: async () => Promise.reject(codedError("bot-shutting-down", "종료 중")) },
    bindChannels: () => {},
    dispose: async (o: { end: string; session: string }) => void disposed.push(`${o.end}:${o.session}`),
  });
  const result = await join({ players: new Map([["g-cf", player]]) }, { guild, member, textChannel: fake<GuildTextBasedChannel>({ id: "t1" }) });
  assert.deepEqual(result, { kind: "refused", code: "bot-shutting-down" });
  assert.deepEqual(disposed, ["replaced:keep", "connect-failed:keep"]);
});
