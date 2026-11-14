// src/app/welcome.ts: 봇이 새 서버에 들어왔을 때의 안내 메시지. 올릴 채널 고르기, 끄기, 들어온 지 오래된 서버는 올리지 않기, 화면(수정본 저장소, 대시보드, 서버 이름).
// 서버 설정(전용 채널)은 진짜를 임시 DB 로 쓴다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ChannelType, Collection, type Guild } from "discord.js";
import { fake } from "../helpers/fake.ts";
import { withConfig } from "../helpers/config.ts";
import { textOf, thumbnailOf } from "../helpers/cv2.ts";
import { openTempStore, setGuild } from "../helpers/temp-store.ts";
const store = openTempStore("welcome-");
after(() => store.close());

const { welcomeGuild, welcomeChannel, welcomeView, RECENT_MS } = await import("../../src/app/welcome.ts");
const config = (await import("../../src/config/index.ts")).default;

type FakeChannel = { id: string; type: ChannelType; rawPosition: number; writable: boolean; sent: unknown[] };
function channel(id: string, rawPosition: number, writable = true, type = ChannelType.GuildText): FakeChannel {
  return { id, type, rawPosition, writable, sent: [] };
}

function guild({ channels, system = null, joinedAgoMs = 0, now = 1_000_000_000, name = "서버" }: { channels: FakeChannel[]; system?: string | null; joinedAgoMs?: number; now?: number; name?: string }) {
  const toDiscord = (c: FakeChannel) => ({
    id: c.id,
    type: c.type,
    rawPosition: c.rawPosition,
    isTextBased: () => c.type === ChannelType.GuildText,
    permissionsFor: () => ({ has: () => c.writable }),
    send: async (payload: unknown) => void c.sent.push(payload),
  });
  const cache = new Collection(channels.map((c) => [c.id, toDiscord(c)]));
  const client = { user: { displayAvatarURL: () => "https://cdn.discordapp.com/avatars/bot/a.png" } };
  return fake<Guild>({ id: "g", name, client, joinedTimestamp: now - joinedAgoMs, members: { me: {} }, systemChannel: system ? cache.get(system) : null, channels: { cache } });
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

/** 컨테이너 밖 버튼 줄의 이름과 주소 */
const buttonsOf = (payload: ReturnType<typeof welcomeView>) => (payload.components[1].toJSON() as { components: Array<{ label: string; url: string }> }).components.map((b) => [b.label, b.url]);

test("화면: 봇 프로필 썸네일, 서버 이름, 쓰는 법, 원본 저장소, 저작권 줄. 버튼은 컨테이너 밖, 멘션은 울리지 않는다", () => {
  const view = withConfig({ dashboard: { url: "http://localhost:33333" } }, () => welcomeView(guild({ channels: [], name: "음악방" })));
  const text = textOf(view);
  assert.equal(thumbnailOf(view), "https://cdn.discordapp.com/avatars/bot/a.png");
  assert.ok(text.startsWith("### 🎵 반가워요!\n**음악방** 서버에 초대해 주셔서 고마워요!"), text);
  assert.ok(text.includes("`/play`로 곡을 재생해요") && text.includes("`/setchannel`로") && text.includes("`/help`를"), text);
  assert.ok(!text.includes("대시보드"), "닿지 않는 대시보드는 말하지 않는다");
  assert.ok(text.includes(`[GitHub 페이지](${config.bot.projectRepo})`) && !text.includes("포크"), text);
  assert.ok(text.endsWith("-# Copyright (C) 2026 PLeC - GNU AGPL-3.0-or-later"), text);
  assert.deepEqual(buttonsOf(view), [["GitHub", config.bot.projectRepo]]);
  assert.deepEqual(view.allowedMentions, { parse: [] });
});

test("화면: 대시보드가 밖에서 열리면 대시보드 줄과 버튼, 수정본 저장소를 정했으면 포크 안내와 두 저장소 버튼", () => {
  const view = withConfig({ dashboard: { url: "https://music.example.com" }, bot: { sourceRepo: "https://github.com/someone/fork" } }, () => welcomeView(guild({ channels: [] })));
  const text = textOf(view);
  assert.ok(text.includes("대시보드에서도 가능해요"), text);
  assert.ok(text.includes("[이쪽](https://github.com/someone/fork)"), text);
  assert.ok(text.endsWith("-# GNU AGPL-3.0-or-later"), text);
  assert.deepEqual(buttonsOf(view), [
    ["웹 대시보드", "https://music.example.com"],
    ["원본 GitHub", config.bot.projectRepo],
    ["운영 버전 GitHub", "https://github.com/someone/fork"],
  ]);
});

test("화면: 서버 이름의 마크다운(링크 포함)은 글자 그대로, 멘션은 울리지 않는다", () => {
  const view = welcomeView(guild({ channels: [], name: "**@everyone** _방_ [링크](https://x.y)" }));
  assert.ok(textOf(view).includes("**\\*\\*@everyone\\*\\* \\_방\\_ \\[링크](https://x.y)** 서버에 초대해"), textOf(view));
  assert.deepEqual(view.allowedMentions, { parse: [] });
});
