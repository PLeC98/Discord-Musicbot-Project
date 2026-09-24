// src/usecases/playlistMore.js — 재생목록 이어 넣기의 상태(custom_id)·선택지·누를 때 판정

import { test } from "node:test";
import assert from "node:assert/strict";
import * as More from "../../src/usecases/playlistMore.ts";
import type { More as Offer, MoreState } from "../../src/usecases/playlistMore.ts";
import type { RepliableInteraction } from "discord.js";
import { fake, fakePlayer } from "../helpers/fake.ts";

const PL = "37i9dQZF1E3aglU7q0y10F";
const TRACK = "3385Kx5khQ1JpCVFJjKAPa";
const data = (over = {}) => ({ isPlaylist: true, total: 120, nextOffset: 50, tracks: [{ id: "x".repeat(22) }, { id: TRACK }], ...over });
// 누른 사람만 다른 위치
const stateOf = (requesterId: string | null): MoreState => ({ kind: "spp", listId: PL, offset: 0, anchorId: TRACK, insertFirst: false, requesterId });

test("continuation: 이어 받을 수 있는 목록일 때만 상태를 만든다", () => {
  assert.deepEqual(More.continuation(`https://open.spotify.com/playlist/${PL}`, data()), { kind: "spp", listId: PL, offset: 50, anchorId: TRACK, insertFirst: false, requesterId: null, total: 120, remaining: 70 });
  assert.equal(More.continuation(`https://open.spotify.com/album/${PL}`, data())?.kind, "spa");
  assert.equal(More.continuation("https://www.youtube.com/playlist?list=PL0123456789abcdefghij0123456789ab", data({ tracks: [{ id: "dQw4w9WgXcQ" }] }))?.kind, "ytp");

  assert.equal(More.continuation("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ", data({ tracks: [{ id: "dQw4w9WgXcQ" }] })), null, "믹스는 이어 받을 수 없다");
  assert.equal(More.continuation(`https://open.spotify.com/playlist/${PL}`, data({ nextOffset: 120 })), null, "끝까지 넣었다");
  assert.equal(More.continuation(`https://open.spotify.com/playlist/${PL}`, data({ total: null })), null, "총 곡 수를 모른다");
  assert.equal(More.continuation(`https://open.spotify.com/playlist/${PL}`, data({ isPlaylist: false })), null, "한 곡만 넣었다");
  assert.equal(More.continuation(`https://open.spotify.com/artist/${PL}`, data()), null, "인기곡");
});

test("custom_id: 되돌리면 같고, 가장 긴 조합도 100자 안이며, 깨진 값은 거절한다", () => {
  const s: MoreState = { kind: "ytp", listId: `OLAK5uy_${"a".repeat(33)}`, offset: 99950, anchorId: "dQw4w9WgXcQ", insertFirst: true, requesterId: "12345678901234567890" };
  const id = More.encodeState(More.MODAL_PREFIX, s);
  assert.ok(id.length <= 100, `${id.length}자`);
  assert.deepEqual(More.decodeState(id), s);

  for (const bad of [`plm:xx:${PL}:0:${TRACK}:b`, `plm:spp:${PL}:-1:${TRACK}:b`, `plm:spp:${PL}:0:${TRACK}:z`, `plm:spp:${PL}:0:${TRACK}:b:notauser`, `other:spp:${PL}:0:${TRACK}:b`, `plm:spp:../x:0:${TRACK}:b`]) {
    assert.equal(More.decodeState(bad), null, bad);
  }
});

test("선택지: 묶음 단위로, 남은 곡과 남은 자리 중 작은 쪽을 넘지 않는다", () => {
  assert.deepEqual(More.moreChoices({ remaining: 9896, room: 200, batch: 50 }), { cap: 200, steps: [50, 100] });
  assert.deepEqual(More.moreChoices({ remaining: 70, room: Infinity, batch: 50 }), { cap: 70, steps: [50] });
  assert.deepEqual(More.moreChoices({ remaining: 70, room: 0, batch: 50 }), { cap: 0, steps: [] });
});

test("메뉴: 자리가 없으면 메뉴를 붙이지 않고, 있으면 선택지 뒤에 직접 입력", () => {
  const more: Offer = { kind: "spp", listId: PL, offset: 50, anchorId: TRACK, insertFirst: false, requesterId: null, total: 9946, remaining: 9896 };
  assert.equal(More.offerMessage(more, 0).components.length, 0);

  const menu = More.offerMessage(more, 120).components[0].components[0].toJSON();
  assert.deepEqual(
    menu.options.map((o) => o.value),
    ["50", "100", "120", "custom", "stop"],
  );
  assert.match(menu.options[2].label, /넣을 수 있는 만큼/);
});

test("누를 때: 전용 채널 메뉴는 넣은 사람만, 30초가 지나면 닫힌다", () => {
  const now = 1_000_000;
  const mine = stateOf("12345678901234567");
  assert.match(More.clickError(mine, { userId: "99999999999999999", lastTouched: now, now }) ?? "", /넣은 사람만/);
  assert.match(More.clickError(stateOf(null), { userId: "a", lastTouched: now - More.LIFETIME_MS - 1, now }) ?? "", /시간이 지나/);
  assert.equal(More.clickError(mine, { userId: "12345678901234567", lastTouched: now - 1000, now }), null);
});

test("곡 수 입력: 1 이상의 정수만", () => {
  assert.equal(More.parseCount(" 120 "), 120);
  for (const bad of ["0", "-5", "1.5", "abc", "", "123456"]) assert.equal(More.parseCount(bad), null, bad);
});

test("슬래시 명령 메뉴: 채널 메시지로 띄우고(요청자 기록), 채널에 못 쓰면 본인 전용 후속 메시지로", async () => {
  const more: Offer = { kind: "spp", listId: PL, offset: 50, anchorId: TRACK, insertFirst: false, requesterId: null, total: 9945, remaining: 9895, batch: 50 };
  const player = fakePlayer({ queue: [] });
  // 보낸 메뉴. 여기서 보는 칸만
  type Sent = { flags?: number; components: Array<{ components: Array<{ toJSON(): { custom_id?: string } }> }> };
  const sent: Sent[] = [];
  const followUps: Sent[] = [];
  const interaction = (channel: object) => fake<RepliableInteraction>({ channel, user: { id: "12345678901234567" }, followUp: async (p: Sent) => (followUps.push(p), { id: "f1" }), deleteReply: async () => {} });

  await More.offerOnInteraction(interaction({ send: async (p: Sent) => (sent.push(p), { id: "m1", delete: async () => {} }) }), more, player);
  assert.equal(sent.length, 1);
  assert.equal(followUps.length, 0);
  assert.equal(sent[0].flags, undefined, "공개 메시지");
  assert.equal(More.decodeState(sent[0].components[0].components[0].toJSON().custom_id)?.requesterId, "12345678901234567");
  More.clearExpiry("m1");

  await More.offerOnInteraction(
    interaction({
      send: async () => {
        throw new Error("Missing Permissions");
      },
    }),
    more,
    player,
  );
  assert.equal(followUps.length, 1);
  assert.ok(followUps[0].flags, "본인 전용");
  More.clearExpiry("f1");
});
