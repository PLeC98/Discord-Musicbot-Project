// src/discord/interactions/playlist-more-handler.ts: 곡을 넣은 뒤 더 넣기 메뉴 표시(슬래시 명령은 본인에게만 보이는 자리표시자를 메뉴로 고치고, 전용 채널은 공개 메시지로 보낸다)

import { test } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, type RepliableInteraction, type TextBasedChannel } from "discord.js";
import config from "../../src/config/index.ts";
import * as More from "../../src/usecases/playlist-more.ts";
import type { More as Offer } from "../../src/rules/more-choices.ts";
import { offerOnChannel, offerOnInteraction } from "../../src/discord/interactions/playlist-more-handler.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";
import { selectOf } from "../helpers/cv2.ts";

const PL = "37i9dQZF1E3aglU7q0y10F";
const TRACK = "3385Kx5khQ1JpCVFJjKAPa";
const more: Offer = { kind: "spp", listId: PL, offset: 50, anchorId: TRACK, insertFirst: false, requesterId: null, total: 9945, remaining: 9895, batch: 50 };
// 보낸 메뉴. 여기서 보는 필드만
type Sent = { flags?: unknown; components: Array<{ toJSON(): unknown }> };

test("슬래시 명령 메뉴: 본인 자리표시자를 메뉴로 고친다(요청자 기록). 못 고치면 false", async () => {
  const player = fakePlayer({ queue: [] });
  const edited: Sent[] = [];
  const interaction = (editReply: (p: Sent) => Promise<unknown>) => fake<RepliableInteraction>({ user: { id: "12345678901234567" }, editReply, deleteReply: async () => {} });

  assert.equal(
    await offerOnInteraction(
      interaction(async (p) => (edited.push(p), { id: "m1" })),
      more,
      player,
    ),
    true,
  );
  assert.equal(edited.length, 1);
  assert.deepEqual(edited[0].flags, [MessageFlags.IsComponentsV2], "자리표시자를 고친다(본인 표시는 처음 응답이 정했다)");
  assert.equal(More.decodeState(selectOf(edited[0])?.custom_id)?.requesterId, "12345678901234567");
  More.clearExpiry("m1");

  const gone = interaction(async () => {
    throw new Error("Unknown Message");
  });
  assert.equal(await offerOnInteraction(gone, more, player), false);
});

test("전용 채널 메뉴: 공개 메시지로 보내고 요청자를 custom_id에 싣는다. 자리가 없으면 보내지 않고 true, 보낼 수 없는 채널이거나 실패하면 false", async (t) => {
  const savedMax = config.bot.maxQueueSize;
  t.after(() => {
    config.bot.maxQueueSize = savedMax;
  });
  config.bot.maxQueueSize = 100;
  const sent: Sent[] = [];
  const channel = (send: (p: Sent) => Promise<unknown>) => fake<TextBasedChannel>({ send });
  const ok = channel(async (p) => (sent.push(p), { id: "m2", delete: async () => {} }));

  assert.equal(await offerOnChannel(ok, more, fakePlayer({ queue: [] }), "22345678901234567"), true);
  assert.equal(sent.length, 1);
  assert.equal(More.decodeState(selectOf(sent[0])?.custom_id)?.requesterId, "22345678901234567");
  More.clearExpiry("m2");

  const full = fakePlayer({ queue: Array.from({ length: 100 }, () => ({})), currentTrack: {} });
  assert.equal(await offerOnChannel(ok, more, full, "22345678901234567"), true, "자리가 없으면 표시할 것이 없다");
  assert.equal(sent.length, 1);

  assert.equal(await offerOnChannel(null, more, fakePlayer({ queue: [] }), "22345678901234567"), false);
  const broken = channel(async () => {
    throw new Error("Missing Access");
  });
  assert.equal(await offerOnChannel(broken, more, fakePlayer({ queue: [] }), "22345678901234567", { quiet: true }), false);
});
