// src/discord/gone-guilds.ts — 게이트웨이에 새로 붙을 때 READY 에 없는 서버(끊긴 동안 봇이 나간 서버)를 봇이 나간 서버와 같은 길로 정리한다.
// 지키는 것: READY 에 없는 그 샤드의 서버만 GuildDelete 처리기에 보내고 캐시(서버 · 그 채널)에서 뺀다. 쓸 수 없는 서버(READY 에 있다) · 다른 샤드의 서버는 그대로.
// READY 가 아닌 패킷은 보지 않는다. 잘못 지우면 저장된 세션까지 지우므로 빼는 서버를 info 로 남긴다

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Events } from "discord.js";
import { fake } from "../helpers/fake.ts";
import sink from "../../src/infra/log/sink.ts";
import { watchGoneGuilds } from "../../src/discord/gone-guilds.ts";

type FakeGuild = { id: string; name: string; shardId: number; channels: { cache: Map<string, object> } };
const guild = (id: string, shardId = 0): FakeGuild => ({ id, name: `서버 ${id}`, shardId, channels: { cache: new Map([[`ch-${id}`, {}]]) } });

function setup(guilds: FakeGuild[]) {
  const client = Object.assign(new EventEmitter(), {
    guilds: { cache: new Map(guilds.map((g) => [g.id, g])) },
    channels: { cache: new Map(guilds.map((g) => [`ch-${g.id}`, {}])) },
  });
  const deleted: string[] = [];
  client.on(Events.GuildDelete, (g: FakeGuild) => deleted.push(g.id));
  watchGoneGuilds(fake<Parameters<typeof watchGoneGuilds>[0]>(client));
  return { client, deleted };
}

test("READY 에 없는 서버는 GuildDelete 처리기에 보내고 캐시(서버 · 채널)에서 뺀다. 쓸 수 없는 서버도 READY 에는 있어 그대로", () => {
  const { client, deleted } = setup([guild("kept"), guild("unavailable"), guild("gone")]);
  const from = sink.buffer.length;
  client.emit(Events.Raw, { t: "READY", d: { guilds: [{ id: "kept" }, { id: "unavailable", unavailable: true }] } }, 0);
  assert.deepEqual(deleted, ["gone"]);
  assert.deepEqual([...client.guilds.cache.keys()], ["kept", "unavailable"]);
  assert.equal(client.channels.cache.has("ch-gone"), false);
  assert.ok(
    sink.buffer.slice(from).some((e) => e.level === "info" && e.text.includes("끊긴 동안 나간 서버를 정리합니다: 서버 gone (gone)")),
    "빼는 서버를 남긴다",
  );
});

test("다른 샤드의 서버는 그 샤드의 READY 가 본다", () => {
  const { client, deleted } = setup([guild("here", 0), guild("other", 1)]);
  client.emit(Events.Raw, { t: "READY", d: { guilds: [{ id: "here" }] } }, 0);
  assert.deepEqual(deleted, []);
  assert.deepEqual([...client.guilds.cache.keys()], ["here", "other"]);
});

test("READY 가 아닌 패킷 · 서버 목록이 없는 패킷은 보지 않는다", () => {
  const { client, deleted } = setup([guild("a")]);
  client.emit(Events.Raw, { t: "GUILD_CREATE", d: { id: "b" } }, 0);
  client.emit(Events.Raw, { t: "READY", d: {} }, 0);
  assert.deepEqual(deleted, []);
  assert.equal(client.guilds.cache.size, 1);
});
