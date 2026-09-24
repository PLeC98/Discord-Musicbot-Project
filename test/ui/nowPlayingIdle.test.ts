// 전용 채널의 패널 — 끝난 패널 자리를 재생 화면으로 고쳐 쓰고, 묻히면 맨 아래로, 음성에서 나가면 문구를 고친다.
// 전용 채널이 있으면 패널은 늘 그 채널에 둔다.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import { MusicEmbedManager } from "../../src/ui/nowPlayingPanel.ts";
import * as tempStore from "../helpers/tempStore.ts";
import * as playerEvents from "../../src/player/events.ts";
import type { Client, Guild, GuildBasedChannel, GuildTextBasedChannel, WebhookClient } from "discord.js";
import type { MusicPlayer } from "../../src/player/Player.ts";
import type { PanelStore } from "../../src/ui/panelLocation.ts";
import type { PanelRecord } from "../../src/store/guildSettings.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";

const BOT = "bot-chan";
// 전용 채널은 임시 DB 에 둔다. null 이면 없앤다
const store = tempStore.openTempStore("idle-panel-");
after(() => store.close());
const setBotChannel = (id: string | null) => tempStore.setGuild("g1", { botChannel: id });
beforeEach(() => setBotChannel(BOT));

// 보내고 고친 패널 내용. 여기서 보는 칸만
type Payload = { components: Array<{ toJSON?(): unknown }>; files?: Array<{ name: string }>; attachments?: unknown[] };
type Posted = { channel: string; payload: Payload; id: string };
type Calls = { sent: Posted[]; edited: Posted[]; deleted: string[]; editError?: Error };
// 채널 캐시에 둔 메시지. 묻혔는지 볼 때 읽는 칸
type Cached = { id: string; createdTimestamp: number };

function makeChannel(id: string, calls: Calls) {
  return {
    id,
    send: async (payload: Payload) => {
      const message = { id: `plain-${calls.sent.length}` };
      calls.sent.push({ channel: id, payload, id: message.id });
      return message;
    },
    messages: { cache: new Collection<string, Cached>(), delete: async (messageId: string) => calls.deleted.push(`${id}:${messageId}`) },
  };
}
type TestChannel = ReturnType<typeof makeChannel>;

// 채널마다 웹훅 가짜. 보낸 것 · 고친 것 · 지운 것을 적는다
class TestPanels extends MusicEmbedManager {
  calls: Calls;
  next = 500;

  constructor(client: Client, calls: Calls, panelStore: PanelStore) {
    super(client, { panelStore });
    this.calls = calls;
  }
  async getOrCreateWebhook(channel: GuildBasedChannel) {
    const calls = this.calls;
    return fake<WebhookClient>({
      send: async (payload: Payload) => {
        const id = String(this.next++);
        calls.sent.push({ channel: channel.id, payload, id });
        return { id, channel_id: channel.id };
      },
      async editMessage(id: string, payload: Payload) {
        if (calls.editError) throw calls.editError;
        calls.edited.push({ channel: channel.id, id, payload });
        return { id };
      },
      async deleteMessage(id: string) {
        calls.deleted.push(`${channel.id}:${id}`);
      },
    });
  }
}

function setup({ record = null }: { record?: PanelRecord | null } = {}) {
  const calls: Calls = { sent: [], edited: [], deleted: [] };
  const channels = new Collection<string, TestChannel>([
    [BOT, makeChannel(BOT, calls)],
    ["general", makeChannel("general", calls)],
  ]);
  const guild = fake<Guild>({ id: "g1", channels: { cache: channels } });
  const players = new Map<string, MusicPlayer>();
  const client = fake<Client>({ players, guilds: { cache: new Collection([["g1", guild]]) }, user: { username: "bot", displayName: "bot", displayAvatarURL: () => "https://example.org/a.png" } });
  const records = new Map<string, PanelRecord | null>(record ? [["g1", record]] : []);
  const panelStore: PanelStore = {
    getPanel: async (g) => records.get(g) ?? null,
    setPanel: async (g, channelId, messageId) => {
      records.set(g, messageId ? { channelId, messageId } : null);
    },
  };
  const mem = new TestPanels(client, calls, panelStore);
  // 패널을 둘 채널. 가짜 채널을 글 채널로 본다
  const text = (id: string) => {
    const channel = channels.get(id);
    assert.ok(channel, `${id} 채널이 있다`);
    return fake<GuildTextBasedChannel>(channel);
  };
  return { mem, guild, channels, calls, records, players, text };
}

function makePlayer(guild: Guild, textChannel: GuildTextBasedChannel, over: object = {}) {
  return fakePlayer({
    guild,
    textChannel,
    sessionId: "s1",
    requesterId: "u1",
    queue: [],
    previousTracks: [],
    loop: false,
    paused: false,
    getCurrentTime: () => 0,
    currentTrack: { title: "곡", pageUrl: "https://example.org/a", requestKey: "https://example.org/a", duration: 100, platform: "youtube", thumbnail: "https://example.org/t.jpg" },
    nowPlayingMessage: null,
    nowPlayingWebhook: null,
    ...over,
  });
}

const textOf = (payload: Payload) => JSON.stringify(payload.components.map((c) => (typeof c.toJSON === "function" ? c.toJSON() : c)));
const bury = (channel: TestChannel | undefined, now: number) => channel?.messages.cache.set("950", { id: "950", createdTimestamp: now - 60_000 });

async function play(mem: MusicEmbedManager, player: MusicPlayer) {
  assert.ok(player.currentTrack, "틀 곡이 있다");
  try {
    await mem.createNewMusicEmbed(player, player.currentTrack, { id: "u1" });
  } finally {
    mem.stopProgressUpdate("g1");
  }
}

test("전용 채널: 끝난 패널이 맨 아래면 그 자리를 재생 화면으로 고친다 — 새로 올리지 않는다", async () => {
  const { mem, guild, calls, records, text } = setup({ record: { channelId: BOT, messageId: "900" } });
  const player = makePlayer(guild, text(BOT));

  await play(mem, player);

  assert.equal(calls.sent.length, 0);
  assert.equal(calls.edited.length, 1);
  assert.equal(calls.edited[0].id, "900");
  assert.deepEqual(calls.edited[0].payload.attachments, [], "종료 모양의 투명 썸네일 첨부를 뗀다");
  assert.match(textOf(calls.edited[0].payload), /현재 재생 중/);
  assert.equal(player.nowPlayingMessage?.id, "900");
  assert.deepEqual(records.get("g1"), { channelId: BOT, messageId: "900" });
});

test("새로 틀기 시작하면 대시보드에 알린다", async () => {
  const { mem, guild, text } = setup({ record: { channelId: BOT, messageId: "900" } });
  const seen: string[] = [];
  const off = playerEvents.on("touched", (g) => seen.push(g));
  try {
    await play(mem, makePlayer(guild, text(BOT)));
  } finally {
    off();
  }
  assert.deepEqual(seen, ["g1"]);
});

test("전용 채널: 끝난 패널이 묻혀 있으면 맨 아래에 새로 올리고 옛 패널을 지운다", async () => {
  const { mem, guild, channels, calls, records, text } = setup({ record: { channelId: BOT, messageId: "900" } });
  bury(channels.get(BOT), Date.now());

  await play(mem, makePlayer(guild, text(BOT)));

  assert.equal(calls.edited.length, 0);
  assert.equal(calls.sent.length, 1);
  assert.ok(calls.deleted.includes(`${BOT}:900`));
  assert.equal(records.get("g1")?.messageId, calls.sent[0].id);
});

test("전용 채널이 있으면 다른 채널에서 틀어도 패널은 전용 채널에 — 없으면 요청한 채널", async () => {
  const withBot = setup();
  await play(withBot.mem, makePlayer(withBot.guild, withBot.text("general")));
  assert.equal(withBot.calls.sent[0].channel, BOT);

  setBotChannel(null);
  const noBot = setup({ record: { channelId: "general", messageId: "800" } });
  await play(noBot.mem, makePlayer(noBot.guild, noBot.text("general")));
  assert.equal(noBot.calls.sent[0].channel, "general");
  assert.equal(noBot.calls.edited.length, 0, "전용 채널이 아니면 옛 패널을 고쳐 쓰지 않는다");
  assert.ok(noBot.calls.deleted.includes("general:800"));
});

test("살아 있는 패널이 없을 때 끝나면 기록된 패널의 문구만 고친다 — 종료 메시지는 없다", async () => {
  const { mem, guild, calls, text } = setup({ record: { channelId: BOT, messageId: "900" } });
  const player = makePlayer(guild, text("general"), { currentTrack: null });

  await mem.handlePlaybackEnd(player, { reason: "disconnected" });

  assert.equal(calls.edited.length, 1);
  assert.equal(calls.edited[0].id, "900");
  assert.match(textOf(calls.edited[0].payload), /쉬는 중이에요.*곡을 입력하면/);
  assert.equal(calls.sent.length, 0);
});

test("끝난 패널이 묻히면 기억해 둔 문구로 맨 아래에 다시 올린다", async () => {
  const { mem, guild, channels, calls, records, players } = setup({ record: { channelId: BOT, messageId: "900" } });
  const now = Date.now();
  mem.idleViews.set("g1", { reason: "leave", leavesAt: null });

  await mem.repinIdlePanel(guild, BOT, now);
  assert.equal(calls.sent.length, 0, "묻히지 않았으면 그대로");

  bury(channels.get(BOT), now);
  await mem.repinIdlePanel(guild, "general", now);
  assert.equal(calls.sent.length, 0, "전용 채널이 아닌 곳의 메시지는 상관없다");

  players.set("g1", fakePlayer({ currentTrack: {}, nowPlayingMessage: { id: "1" } }));
  await mem.repinIdlePanel(guild, BOT, now);
  assert.equal(calls.sent.length, 0, "재생 중이면 5초 갱신이 맡는다");
  players.clear();

  await mem.repinIdlePanel(guild, BOT, now);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].channel, BOT);
  assert.match(textOf(calls.sent[0].payload), /듣고 있던 곡이 있어요/);
  assert.equal(calls.sent[0].payload.files?.[0].name, "blank.png");
  assert.ok(calls.deleted.includes(`${BOT}:900`));
  assert.equal(records.get("g1")?.messageId, calls.sent[0].id);
});

test("전용 채널이 있는 서버에서 다른 채널로 틀고 끝나도 종료 메시지는 요청한 채널에 가지 않는다", async () => {
  const { mem, guild, calls, text } = setup({ record: { channelId: BOT, messageId: "900" } });
  const player = makePlayer(guild, text("general"));

  await play(mem, player); // 전용 채널의 끝난 패널을 고쳐 쓴다
  await mem.handlePlaybackEnd(player, { reason: "queue-end" });

  assert.equal(calls.edited.at(-1)?.id, "900", "패널은 전용 채널에서 종료 모양으로");
  assert.equal(calls.sent.filter((s) => s.channel === "general").length, 0);
});

test("기동: 전용 채널에 남은 패널은 음성 밖 문구로 고친다 — 새로 올리지 않는다", async () => {
  const { mem, calls } = setup({ record: { channelId: BOT, messageId: "900" } });
  await mem.restorePanels();
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.edited.length, 1);
  assert.match(textOf(calls.edited[0].payload), /쉬는 중이에요.*곡을 입력하면/);
});

test("기동: 전용 채널 패널이 없거나 지워졌으면 새로 올린다", async () => {
  const fresh = setup();
  await fresh.mem.restorePanels();
  assert.equal(fresh.calls.sent.length, 1);
  assert.equal(fresh.calls.sent[0].channel, BOT);
  assert.equal(fresh.records.get("g1")?.messageId, fresh.calls.sent[0].id);

  const gone = setup({ record: { channelId: BOT, messageId: "900" } });
  gone.calls.editError = Object.assign(new Error("Unknown Message"), { code: 10008 });
  await gone.mem.restorePanels();
  assert.equal(gone.calls.sent.length, 1);
  assert.equal(gone.records.get("g1")?.messageId, gone.calls.sent[0].id);
});

test("기동: 세션을 복원해 패널을 올린 서버는 건너뛰고, 전용 채널이 없으면 기록된 패널만 고친다", async () => {
  const restored = setup({ record: { channelId: BOT, messageId: "900" } });
  restored.players.set("g1", fakePlayer({ nowPlayingMessage: { id: "900" } }));
  await restored.mem.restorePanels();
  assert.equal(restored.calls.edited.length + restored.calls.sent.length, 0);

  setBotChannel(null);
  const plain = setup({ record: { channelId: "general", messageId: "800" } });
  await plain.mem.restorePanels();
  assert.equal(plain.calls.sent.length, 0);
  assert.equal(plain.calls.edited[0].id, "800");
  assert.match(textOf(plain.calls.edited[0].payload), /\/play/);
});

test("전용 채널을 정하면 끝난 패널을 그 채널에 올리고 옛 패널을 지운다 — 풀면 지운다", async () => {
  const { mem, guild, calls, records } = setup({ record: { channelId: "general", messageId: "800" } });
  await mem.onBotChannelChanged(guild);
  assert.equal(calls.sent[0].channel, BOT);
  assert.ok(calls.deleted.includes("general:800"));

  setBotChannel(null);
  const current = records.get("g1")?.messageId;
  await mem.onBotChannelChanged(guild);
  assert.ok(calls.deleted.includes(`${BOT}:${current}`));
  assert.equal(records.get("g1"), null);
});

test("재생 중에 전용 채널을 정하면 재생 패널을 옮기고, 풀면 그대로 둔다", async () => {
  const { mem, guild, calls, players, text } = setup({ record: { channelId: "general", messageId: "800" } });
  const player = makePlayer(guild, text("general"), { nowPlayingMessage: { id: "800", channel_id: "general" } });
  players.set("g1", player);

  await mem.onBotChannelChanged(guild);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].channel, BOT);
  assert.match(textOf(calls.sent[0].payload), /현재 재생 중/);
  assert.ok(calls.deleted.includes("general:800"));

  setBotChannel(null);
  const deletedBefore = calls.deleted.length;
  await mem.onBotChannelChanged(guild);
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.deleted.length, deletedBefore);
});

test("곡이 없을 때 /dashboard는 끝난 패널을 그 채널에 다시 올린다", async () => {
  const { mem, guild, calls, records, text } = setup({ record: { channelId: BOT, messageId: "900" } });
  await mem.repostIdlePanel(guild, text(BOT));
  assert.equal(calls.sent[0].channel, BOT);
  assert.match(textOf(calls.sent[0].payload), /곡을 입력하면/);
  assert.ok(calls.deleted.includes(`${BOT}:900`));
  assert.equal(records.get("g1")?.messageId, calls.sent[0].id);
});

test("다음 곡 버튼: 대기열이 비면 끄되, 자동재생이 켜져 있으면 켠다", async () => {
  const { mem, guild, text } = setup({});
  const skipDisabled = async (over: object) => {
    const rows = await mem.createControlButtons(makePlayer(guild, text(BOT), over));
    const buttons = rows.flatMap((row) => row.toJSON().components);
    return buttons.find((b) => "custom_id" in b && b.custom_id.startsWith("music_skip:"))?.disabled;
  };
  assert.equal(await skipDisabled({}), true);
  assert.equal(await skipDisabled({ autoplay: "pop" }), false);
});
