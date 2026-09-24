// src/ui/panelLocation.ts — 서버당 패널 하나. 새로 올리면 기록된 옛 패널을 지운다(재시작해도).

import { test } from "node:test";
import assert from "node:assert/strict";
import { NowPlayingPanel, type PanelStore } from "../../src/ui/panelLocation.ts";
import type { Guild, GuildBasedChannel } from "discord.js";
import type { PanelHook } from "../../src/player/Player.ts";
import type { PanelRecord } from "../../src/store/guildSettings.ts";
import { fake } from "../helpers/fake.ts";

function memoryStore(initial: Record<string, PanelRecord> = {}) {
  const records = new Map<string, PanelRecord | null>(Object.entries(initial));
  const store: PanelStore & { records: typeof records } = {
    records,
    getPanel: async (g) => records.get(g) ?? null,
    setPanel: async (g, channelId, messageId) => {
      records.set(g, messageId ? { channelId, messageId } : null);
    },
  };
  return store;
}

function fakeWebhook(log: string[], { failDelete = false } = {}) {
  return fake<PanelHook>({
    async deleteMessage(id: string) {
      if (failDelete) throw Object.assign(new Error("Unknown Webhook"), { code: 10015 });
      log.push(`webhook:${id}`);
    },
  });
}

function fakeChannel(id: string, log: string[]) {
  return fake<GuildBasedChannel>({ id, messages: { delete: async (messageId: string) => log.push(`channel:${id}:${messageId}`) } });
}

function setup({ record, webhooks = {} }: { record?: PanelRecord; webhooks?: Record<string, PanelHook> } = {}) {
  const log: string[] = [];
  const channels = new Map([
    ["c1", fakeChannel("c1", log)],
    ["c2", fakeChannel("c2", log)],
  ]);
  const guild = fake<Guild>({ id: "g1", channels: { cache: channels } });
  const store = memoryStore(record ? { g1: record } : {});
  const embeds = { getOrCreateWebhook: async (channel: GuildBasedChannel) => webhooks[channel.id] ?? null };
  return { log, guild, channels, store, panel: new NowPlayingPanel(embeds, store) };
}

test("새 패널을 기록하고, 같은 채널의 옛 패널은 방금 쓴 웹훅으로 지운다", async () => {
  const { log, guild, channels, store, panel } = setup({ record: { channelId: "c1", messageId: "old" } });
  const webhook = fakeWebhook(log);

  await panel.commit(guild, channels.get("c1"), { id: "new" }, webhook);

  assert.deepEqual(log, ["webhook:old"]);
  assert.deepEqual(store.records.get("g1"), { channelId: "c1", messageId: "new" });
});

test("다른 채널에 있던 옛 패널은 그 채널의 웹훅을 다시 찾아 지운다", async () => {
  const log: string[] = [];
  const { guild, channels, store, panel } = setup({ record: { channelId: "c2", messageId: "old" }, webhooks: { c2: fakeWebhook(log) } });

  await panel.commit(guild, channels.get("c1"), { id: "new" }, fakeWebhook([]));

  assert.deepEqual(log, ["webhook:old"]);
  assert.equal(store.records.get("g1")?.channelId, "c1");
});

test("웹훅으로 못 지우면 채널 권한으로 지운다", async () => {
  const { log, guild, channels, panel } = setup({ record: { channelId: "c2", messageId: "old" }, webhooks: { c2: fakeWebhook([], { failDelete: true }) } });

  await panel.commit(guild, channels.get("c1"), { id: "new" });

  assert.deepEqual(log, ["channel:c2:old"]);
});

test("재시작한 뒤에도 기록만으로 옛 패널을 치운다", async () => {
  const first = setup();
  await first.panel.commit(first.guild, first.channels.get("c1"), { id: "before-restart" }, fakeWebhook(first.log));
  assert.deepEqual(first.log, [], "처음에는 치울 것이 없다");

  const log: string[] = [];
  const restarted = new NowPlayingPanel({ getOrCreateWebhook: async () => fakeWebhook(log) }, first.store);
  await restarted.commit(first.guild, first.channels.get("c1"), { id: "after-restart" });

  assert.deepEqual(log, ["webhook:before-restart"]);
});

test("같은 메시지를 다시 기록해도 지우지 않는다", async () => {
  const { log, guild, channels, panel } = setup({ record: { channelId: "c1", messageId: "same" } });
  await panel.commit(guild, channels.get("c1"), { id: "same" }, fakeWebhook(log));
  assert.deepEqual(log, []);
});

test("동시에 올라온 두 패널은 줄을 서서 — 마지막 것만 남는다", async () => {
  const { log, guild, channels, store, panel } = setup({ record: { channelId: "c1", messageId: "m0" } });
  const webhook = fakeWebhook(log);

  await Promise.all([panel.commit(guild, channels.get("c1"), { id: "m1" }, webhook), panel.commit(guild, channels.get("c1"), { id: "m2" }, webhook)]);

  assert.deepEqual(log, ["webhook:m0", "webhook:m1"]);
  assert.equal(store.records.get("g1")?.messageId, "m2");
  assert.equal(panel.chains.size, 0);
});

test("기록된 패널을 제자리에서 고친다 — 지워졌으면 기록을 비운다", async () => {
  const edits: string[] = [];
  let fail: Error | null = null;
  const webhook = fake<PanelHook>({
    deleteMessage: async () => {},
    editMessage: async (id: string) => {
      if (fail) throw fail;
      edits.push(id);
    },
  });
  const { guild, store, panel } = setup({ record: { channelId: "c1", messageId: "m1" }, webhooks: { c1: webhook } });

  const done = await panel.edit(guild, { components: [] });
  assert.equal(done?.messageId, "m1");
  assert.deepEqual(edits, ["m1"]);

  fail = Object.assign(new Error("Unknown Message"), { code: 10008 });
  assert.equal(await panel.edit(guild, {}), null);
  assert.equal(store.records.get("g1"), null, "다음 게시가 새로 올리도록 기록을 비운다");
  assert.equal(await panel.edit(guild, {}), null, "기록이 없으면 할 일이 없다");
});

test("패널을 지우고 기록을 비운다", async () => {
  const log: string[] = [];
  const { guild, store, panel } = setup({ record: { channelId: "c2", messageId: "old" }, webhooks: { c2: fakeWebhook(log) } });
  await panel.remove(guild);
  assert.deepEqual(log, ["webhook:old"]);
  assert.equal(store.records.get("g1"), null);

  await panel.remove(guild);
  assert.deepEqual(log, ["webhook:old"], "기록이 없으면 할 일이 없다");
});
