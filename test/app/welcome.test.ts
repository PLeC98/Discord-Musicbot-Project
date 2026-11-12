// src/app/welcome.ts: 봇이 새 서버에 들어왔을 때의 안내 메시지. 올릴 채널 고르기, 끄기, 들어온 지 오래된 서버는 올리지 않기.
// 서버 설정(전용 채널)은 진짜를 임시 DB 로 쓴다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, Collection, type Guild } from "discord.js";
import { fake } from "../helpers/fake.ts";
import { withConfig } from "../helpers/config.ts";
import { textOf } from "../helpers/cv2.ts";
import { openTempStore, setGuild } from "../helpers/temp-store.ts";
const store = openTempStore("welcome-");
after(() => store.close());

const { welcomeGuild, welcomeChannel, RECENT_MS } = await import("../../src/app/welcome.ts");

type FakeChannel = { id: string; type: ChannelType; rawPosition: number; writable: boolean; sent: unknown[] };
function channel(id: string, rawPosition: number, writable = true, type = ChannelType.GuildText): FakeChannel {
  return { id, type, rawPosition, writable, sent: [] };
}

function guild({ channels, system = null, joinedAgoMs = 0, now = 1_000_000_000 }: { channels: FakeChannel[]; system?: string | null; joinedAgoMs?: number; now?: number }) {
  const toDiscord = (c: FakeChannel) => ({
    id: c.id,
    type: c.type,
    rawPosition: c.rawPosition,
    isTextBased: () => c.type === ChannelType.GuildText,
    permissionsFor: () => ({ has: () => c.writable }),
    send: async (payload: unknown) => void c.sent.push(payload),
  });
  const cache = new Collection(channels.map((c) => [c.id, toDiscord(c)]));
  return fake<Guild>({ id: "g", name: "서버", joinedTimestamp: now - joinedAgoMs, members: { me: {} }, systemChannel: system ? cache.get(system) : null, channels: { cache } });
}

test("올릴 채널: 전용 채널, 시스템 채널, 위치 순서로 첫 텍스트 채널 가운데 봇이 쓸 수 있는 첫 곳", async () => {
  setGuild("g", { botChannel: null });
  const pick = async (g: Guild) => (await welcomeChannel(g))?.id ?? null;
  assert.equal(await pick(guild({ channels: [channel("b", 1), channel("a", 0), channel("sys", 5)], system: "sys" })), "sys");
  assert.equal(await pick(guild({ channels: [channel("b", 1), channel("a", 0), channel("sys", 5, false)], system: "sys" })), "a", "시스템 채널에 쓸 수 없으면 위치가 앞선 텍스트 채널");
  assert.equal(await pick(guild({ channels: [channel("v", 0, true, ChannelType.GuildVoice), channel("b", 1, false)] })), null);
  setGuild("g", { botChannel: "b" });
  assert.equal(await pick(guild({ channels: [channel("b", 1), channel("sys", 0)], system: "sys" })), "b", "다시 초대한 서버는 전용 채널");
  assert.equal(await pick(guild({ channels: [channel("b", 1, true, ChannelType.PublicThread), channel("sys", 0)], system: "sys" })), "sys", "전용 채널이 스레드면 보지 않는다");
  setGuild("g", { botChannel: null });
});

test("새로 들어온 서버에만, 켜져 있을 때만 한 번 올린다", async () => {
  setGuild("g", { botChannel: null });
  const now = 1_000_000_000;
  const fresh = channel("a", 0);
  await welcomeGuild(guild({ channels: [fresh], now }), now);
  assert.equal(fresh.sent.length, 1);
  assert.match(textOf(fresh.sent[0]), /`\/play`/);

  const old = channel("a", 0);
  await welcomeGuild(guild({ channels: [old], joinedAgoMs: RECENT_MS + 1, now }), now);
  assert.equal(old.sent.length, 0, "들어온 지 오래된 서버(이미 있던 서버)에는 올리지 않는다");

  const off = channel("a", 0);
  await withConfig({ bot: { welcomeMessage: false } }, () => welcomeGuild(guild({ channels: [off], now }), now));
  assert.equal(off.sent.length, 0, "끄면 올리지 않는다");
});
