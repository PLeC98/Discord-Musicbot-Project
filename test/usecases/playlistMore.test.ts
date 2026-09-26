// src/usecases/playlistMore.ts — 재생목록 이어 넣기의 상태(custom_id)·선택지·누를 때 판정

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

// 사운드클라우드 세트: 주소 대신 곡 찾기가 알려 준 숫자 id 로 이어 받고, 한 번에 10곡까지(곡마다 요청이 들어 IP 가 막히지 않게)
test("사운드클라우드 세트: 숫자 id 로 이어 받고, 서버 설정과 상관없이 한 번에 10곡", () => {
  const set = { isPlaylist: true, collectionId: "2284916349", total: 41, nextOffset: 10, tracks: [{ id: "2227247837" }] };
  const more = More.continuation("https://soundcloud.com/chillhopdotcom/sets/best-of-essentials-fall", set);
  assert.deepEqual(more && { kind: more.kind, listId: more.listId, anchorId: more.anchorId, remaining: more.remaining }, { kind: "scs", listId: "2284916349", anchorId: "2227247837", remaining: 31 });
  assert.equal(More.continuation("https://soundcloud.com/a/sets/b", { ...set, collectionId: null }), null, "id 가 없으면(비밀 공유 세트) 권하지 않는다");
  assert.equal(More.KINDS.scs.url("2284916349"), "https://api.soundcloud.com/playlists/2284916349");

  assert.equal(More.batchFor("https://soundcloud.com/a/sets/b", 50), 10);
  assert.equal(More.batchFor("https://on.soundcloud.com/AbCd", 50), 10, "짧은 링크는 세트일 수 있다");
  assert.equal(More.batchFor("https://www.youtube.com/playlist?list=PLx", 50), 50);

  const s: MoreState = { kind: "scs", listId: "2284916349", offset: 99990, anchorId: "22272478371", insertFirst: true, requesterId: "12345678901234567890" };
  assert.deepEqual(More.decodeState(More.encodeState(More.MODAL_PREFIX, s)), s);
});

test("사운드클라우드 세트 메뉴: 한 번 상한에 걸리면 'N곡 더', 남은 곡이 적으면 전부. 결과 문장에 뺀 곡", () => {
  const more: Offer = { kind: "scs", listId: "123", offset: 10, anchorId: "2227247837", insertFirst: false, requesterId: null, total: 41, remaining: 31, batch: 10 };
  const menu = More.offerMessage(more, 200).components[0].components[0].toJSON();
  assert.deepEqual(
    menu.options.map((o) => [o.value, o.label]),
    [
      ["10", "10곡 더"],
      ["custom", "직접 입력…"],
      ["stop", "그만 넣기"],
    ],
  );
  const last = More.offerMessage({ ...more, remaining: 4 }, 200).components[0].components[0].toJSON();
  assert.equal(last.options[0].label, "남은 곡 전부 (4곡)");

  const result = More.resultMessage(more, { added: 7, skipped: 3, total: 41, remaining: 21, next: { ...more, offset: 20, remaining: 21 } }, 200);
  assert.match(result.content, /7곡을 더 넣었어요\. 받을 수 없는 3곡\(미리듣기 · 지역 제한 등\)은 뺐어요\./);
});

// 사운드클라우드가 만든 믹스는 숫자 id 가 없다(yt-dlp: soundcloud:system-playlists:…). 주소의 이름으로 이어 받는다
test("사운드클라우드 믹스: 주소의 이름으로 이어 받고, 이름의 ':'는 custom_id 를 깨지 않게 싣는다", () => {
  const mix = { isPlaylist: true, collectionId: "soundcloud:system-playlists:trending-by-genre:indie", total: 50, nextOffset: 10, tracks: [{ id: "2227247837" }] };
  const more = More.continuation("https://soundcloud.com/discover/sets/trending-by-genre:indie?si=abc", mix);
  assert.deepEqual(more && { kind: more.kind, listId: more.listId }, { kind: "scd", listId: "trending-by-genre~indie" });
  assert.equal(More.KINDS.scd.url("trending-by-genre~indie"), "https://soundcloud.com/discover/sets/trending-by-genre:indie");
  assert.equal(More.batchFor("https://soundcloud.com/discover/sets/trending-by-genre:indie", 50), 10);
  if (!more) return;
  const state: MoreState = { kind: more.kind, listId: more.listId, offset: more.offset, anchorId: more.anchorId, insertFirst: true, requesterId: "12345678901234567890" };
  const id = More.encodeState(More.MODAL_PREFIX, state);
  assert.ok(id.length <= 100, `${id.length}자`);
  assert.deepEqual(More.decodeState(id), state);
});
