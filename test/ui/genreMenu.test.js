// src/ui/genreMenu.js — 자동재생 장르 선택 화면.
//
// 회귀 대상: 켜기(버튼)와 끄기·명령이 각자 화면을 만들던 시절, 명령 쪽만 영문 키를 보여줬다.
// 두 화면이 한 빌더를 지나는지 잠가 둔다. 지금은 키가 곧 이름이라 그 자리에 쓰인다.

import { test } from "node:test";
import assert from "node:assert/strict";
import genreMenu from "../../src/ui/genreMenu.js";
const { buildGenreMenu, buildAutoplayOffMenu, OFF_MENU_MS } = genreMenu;
import genresModule from "../../src/config/genres.js";
const { genres } = genresModule.genres();

const ids = Object.keys(genres);
const selectOf = (payload) => payload.components[0].toJSON().components[0];

test("켜기·끄기가 같은 장르 목록과 같은 핸들러를 쓴다", () => {
  const on = selectOf(buildGenreMenu("u1", "s1"));
  const off = selectOf(buildAutoplayOffMenu("u1", "s1"));

  for (const menu of [on, off]) {
    assert.deepEqual(
      menu.options.map((o) => o.value),
      ids,
    );
    assert.deepEqual(
      menu.options.map((o) => o.label),
      ids,
      "키가 곧 이름이다 — 따로 표시용 이름을 두지 않는다",
    );
  }

  assert.equal(on.custom_id, "autoplay_genre:u1:s1");
  assert.equal(off.custom_id, on.custom_id, "고른 결과는 한 핸들러가 받는다");
});

test("장르 수가 디스코드 셀렉트 상한을 넘지 않는다", () => {
  assert.ok(ids.length <= 25, `장르 ${ids.length}개 — 25개를 넘으면 메뉴가 거부된다`);
});

test("끄기 화면: 이미 꺼졌음을 알리고 30초 동안 다시 고를 기회를 준다", () => {
  const off = buildAutoplayOffMenu("u1", "s1");
  assert.match(off.embeds[0].data.title, /비활성화/);
  assert.equal(OFF_MENU_MS, 30_000, '"더 넣기" 메뉴와 같은 수명');
});

test("두 화면 다 본인에게만 보인다", () => {
  for (const payload of [buildGenreMenu("u1", "s1"), buildAutoplayOffMenu("u1", "s1")]) {
    assert.deepEqual(payload.flags, [1 << 6]);
  }
});
