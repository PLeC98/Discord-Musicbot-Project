// src/discord/interactions/autoplay.ts: 장르 메뉴를 디스코드가 거절하면(없는 앱 이모지) 앱 이모지 목록을 다시 읽어 메뉴가 달라졌을 때만 한 번 더 보낸다

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Guild, GuildMember, RepliableInteraction } from "discord.js";
import { answerAutoplay } from "../../src/discord/interactions/autoplay.ts";
import { useAppEmojis } from "../../src/store/app-emoji-book.ts";
import { fake } from "../helpers/fake.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import { useDefaultDocuments, useDocument } from "../helpers/config-docs.ts";
import { selectOf } from "../helpers/cv2.ts";
import type { AppEmojis } from "../../src/app/app-emojis.ts";

const store = openTempStore("autoplay-menu-");
after(() => store.close());
afterEach(() => {
  useAppEmojis([]);
  useDefaultDocuments();
});

const PARTY = { id: "111111111111111111", name: "party", animated: false };
const INVALID_FORM = Object.assign(new Error("Invalid Form Body"), { code: 50035 });

// 봇이 음성에 있고 부른 사람은 같은 채널의 관리자(DJ)
const guild = fake<Guild>({ id: "g1", members: { me: { voice: { channel: { id: "vc1" } } } } });
const member = fake<GuildMember>({ id: "u1", guild, permissions: { has: () => true }, voice: { channel: { id: "vc1" } }, roles: { cache: new Map() } });

/** 처음 reply 는 failures 차례로 던지고, 보낸 메뉴들의 팝 장르 이모지를 적는다 */
function interaction(failures: Error[]) {
  const sent: unknown[] = [];
  const it = fake<RepliableInteraction<"cached">>({
    id: "i1",
    member,
    guild,
    replied: false,
    deferred: false,
    reply: async (payload: Parameters<typeof selectOf>[0]) => {
      const failure = failures.shift();
      if (failure) throw failure;
      sent.push(selectOf(payload)?.options?.find((one) => one.value === "팝")?.emoji ?? null);
    },
    deleteReply: async () => {},
  });
  return { it, sent };
}

/** reload 가 next 로 목록을 바꾼다 */
function emojis(next: (typeof PARTY)[]) {
  let reloads = 0;
  const api = fake<AppEmojis>({
    reload: async () => {
      reloads++;
      useAppEmojis(next);
      return next;
    },
  });
  return { api, reloads: () => reloads };
}

function partyGenre() {
  useDocument("genres", { defaults: {}, genres: { 팝: { emoji: `<:party:${PARTY.id}>`, sources: [{ type: "keyword", keywords: ["pop"] }] } } });
  useAppEmojis([PARTY]);
}

test("거절당하면 목록을 다시 읽고, 이모지가 사라졌으면 이모지 없이 한 번 더 보낸다", async () => {
  partyGenre();
  const { it, sent } = interaction([INVALID_FORM]);
  const book = emojis([]);
  await answerAutoplay(it, undefined, book.api);
  assert.equal(book.reloads(), 1);
  assert.deepEqual(sent, [null]);
});

test("다시 읽어도 메뉴가 같으면 다시 보내지 않고 처음 오류를 던진다", async () => {
  partyGenre();
  const { it, sent } = interaction([INVALID_FORM]);
  const book = emojis([PARTY]);
  await assert.rejects(answerAutoplay(it, undefined, book.api), INVALID_FORM);
  assert.equal(book.reloads(), 1);
  assert.deepEqual(sent, []);
});

test("본문 거절이 아닌 오류는 목록을 읽지 않고 던진다", async () => {
  partyGenre();
  const other = Object.assign(new Error("Missing Access"), { code: 50001 });
  const { it } = interaction([other]);
  const book = emojis([]);
  await assert.rejects(answerAutoplay(it, undefined, book.api), other);
  assert.equal(book.reloads(), 0);
});

test("거절당하지 않으면 그대로 한 번", async () => {
  partyGenre();
  const { it, sent } = interaction([]);
  const book = emojis([]);
  await answerAutoplay(it, undefined, book.api);
  assert.equal(book.reloads(), 0);
  assert.deepEqual(sent, [{ id: PARTY.id, name: "party", animated: false }]);
});
