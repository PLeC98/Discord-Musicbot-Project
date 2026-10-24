// src/usecases/playlist-more.ts — 재생목록 이어 넣기의 상태(custom_id)·메뉴·누를 때 판정

import { test } from "node:test";
import assert from "node:assert/strict";
import * as More from "../../src/usecases/playlist-more.ts";
import type { More as Offer, MoreState } from "../../src/rules/more-choices.ts";
import { MessageFlags, type RepliableInteraction } from "discord.js";
import { fake, fakePlayer } from "../helpers/fake.ts";
import { post } from "../../src/ui/frame.ts";
import { selectOf, textsOf } from "../helpers/cv2.ts";

// 화면 안의 곡 수 메뉴
function menuOf(offer: { view: Parameters<typeof post>[0]; menu: boolean }) {
  const select = selectOf(post(offer.view));
  assert.ok(offer.menu && select?.options, "메뉴가 있다");
  return { options: select.options };
}

const PL = "37i9dQZF1E3aglU7q0y10F";
const TRACK = "3385Kx5khQ1JpCVFJjKAPa";
const data = (over = {}) => ({ isPlaylist: true, total: 120, nextOffset: 50, tracks: [{ id: "x".repeat(22) }, { id: TRACK }], ...over });
// 누른 사람만 다른 위치
const stateOf = (requesterId: string | null): MoreState => ({ kind: "spp", listId: PL, offset: 0, anchorId: TRACK, insertFirst: false, requesterId });

test("continuation: 이어 불러올 수 있는 목록일 때만 상태를 만든다", () => {
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

test("메뉴: 자리가 없으면 메뉴를 붙이지 않고, 있으면 선택지 뒤에 직접 입력", () => {
  const more: Offer = { kind: "spp", listId: PL, offset: 50, anchorId: TRACK, insertFirst: false, requesterId: null, total: 9946, remaining: 9896 };
  const full = More.offerView(more, 0);
  assert.equal(full.menu, false);
  assert.equal(selectOf(post(full.view)), undefined);

  const menu = menuOf(More.offerView(more, 120));
  assert.deepEqual(
    menu.options.map((o) => o.value),
    ["50", "100", "120", "custom", "stop"],
  );
  assert.match(menu.options[2].label, /넣을 수 있는 만큼/);
});

test("누를 때: 전용 채널 메뉴는 넣은 사람만, 30초가 지나면 닫힌다", () => {
  const now = 1_000_000;
  const mine = stateOf("12345678901234567");
  assert.equal(More.clickError(mine, { userId: "99999999999999999", lastTouched: now, now }), "more-not-requester");
  assert.equal(More.clickError(stateOf(null), { userId: "a", lastTouched: now - More.LIFETIME_MS - 1, now }), "more-expired");
  assert.equal(More.clickError(mine, { userId: "12345678901234567", lastTouched: now - 1000, now }), null);
});

test("슬래시 명령 메뉴: 본인 자리표시자를 메뉴로 고친다(요청자 기록). 못 고치면 false", async () => {
  const more: Offer = { kind: "spp", listId: PL, offset: 50, anchorId: TRACK, insertFirst: false, requesterId: null, total: 9945, remaining: 9895, batch: 50 };
  const player = fakePlayer({ queue: [] });
  // 보낸 메뉴. 여기서 보는 필드만
  type Sent = { flags?: unknown; components: Array<{ toJSON(): unknown }> };
  const edited: Sent[] = [];
  const interaction = (editReply: (p: Sent) => Promise<unknown>) => fake<RepliableInteraction>({ user: { id: "12345678901234567" }, editReply, deleteReply: async () => {} });

  assert.equal(
    await More.offerOnInteraction(
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
  assert.equal(await More.offerOnInteraction(gone, more, player), false);
});

// 사운드클라우드 세트: 주소 대신 곡 찾기가 알려 준 숫자 id 로 이어 불러오고, 한 번에 10곡까지(곡마다 요청이 들어 IP 가 막히지 않게)
test("사운드클라우드 세트: 숫자 id 로 이어 불러오고, 서버 설정과 상관없이 한 번에 10곡", () => {
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
  const menu = menuOf(More.offerView(more, 200));
  assert.deepEqual(
    menu.options.map((o) => [o.value, o.label]),
    [
      ["10", "10곡 더"],
      ["custom", "직접 입력…"],
      ["stop", "그만 넣기"],
    ],
  );
  const last = menuOf(More.offerView({ ...more, remaining: 4 }, 200));
  assert.equal(last.options[0].label, "남은 곡 전부 (4곡)");

  const result = More.resultView(more, { added: 7, skipped: 3, total: 41, remaining: 21, next: { ...more, offset: 20, remaining: 21 } }, 200);
  assert.equal(result.menu, true);
  assert.match(textsOf(post(result.view))[0], /7곡을 더 넣었어요\. 재생할 수 없는 3곡\(미리듣기 · 지역 제한 등\)은 제외했어요\./);
});

// 사운드클라우드가 만든 믹스는 숫자 id 가 없다(yt-dlp: soundcloud:system-playlists:…). 주소의 이름으로 이어 불러온다
test("사운드클라우드 믹스: 주소의 이름으로 이어 불러오고, 이름의 ':'는 custom_id 를 깨지 않게 싣는다", () => {
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
