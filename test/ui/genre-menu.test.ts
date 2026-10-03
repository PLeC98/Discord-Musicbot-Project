// src/ui/genre-menu.ts — 자동재생 장르 선택 화면.
//
// 회귀 대상: 켜기(버튼)와 끄기·명령이 각자 화면을 만들던 시절, 명령 쪽만 영문 키를 보여줬다.
// 두 화면이 한 빌더를 지나는지 잠가 둔다. 지금은 키가 곧 이름이라 그 자리에 쓰인다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { buildGenreMenu, buildAutoplayOffMenu, autoplayOn } from "../../src/ui/genre-menu.ts";
import * as genresModule from "../../src/config/genres.ts";
import { useExampleConfig } from "../helpers/example-config.ts";
import { headOf, selectOf, separatorsOf, textsOf } from "../helpers/cv2.ts";
import { post } from "../../src/ui/frame.ts";

useExampleConfig();
const { genres } = genresModule.genres();

const ids = Object.keys(genres);
// 화면 안의 장르 메뉴
const menuOf = (payload: ReturnType<typeof buildGenreMenu>) => {
  const select = selectOf(payload);
  assert.ok(select?.options, "장르 메뉴가 있다");
  return { custom_id: select.custom_id, options: select.options };
};

test("켜기·끄기가 같은 장르 목록과 같은 핸들러를 쓴다", () => {
  const on = menuOf(buildGenreMenu());
  const off = menuOf(buildAutoplayOffMenu());

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

  assert.equal(on.custom_id, "autoplay:genre");
  assert.equal(off.custom_id, on.custom_id, "고른 결과는 한 핸들러가 받는다");
});

test("장르 수가 디스코드 셀렉트 상한을 넘지 않는다", () => {
  assert.ok(ids.length <= 25, `장르 ${ids.length}개 — 25개를 넘으면 메뉴가 거부된다`);
});

test("끄기 화면: 이미 꺼졌음을 알리고 다시 고를 기회를 준다", () => {
  const off = buildAutoplayOffMenu();
  assert.match(headOf(off) ?? "", /자동 재생을 껐어요/);
});

test("켠 결과: 고른 장르와 누가 켰는지, 그 줄 위에 구분선", () => {
  const on = post(autoplayOn("가요", "<@1>"));
  assert.deepEqual(textsOf(on), ["### 🎲 자동 재생을 시작할게요!\n**가요** 장르로 켰어요. 직접 넣어둔 대기열이 끝나면 자동 재생 곡들이 나와요.", "-# 👤 요청한 사람 <@1>"]);
  assert.equal(separatorsOf(on), 1);
});

test("두 화면 다 본인에게만 보인다", () => {
  for (const payload of [buildGenreMenu(), buildAutoplayOffMenu()]) {
    assert.deepEqual(payload.flags, [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral]);
  }
});

test("이모지를 비워 둔 장르도 메뉴에 들어간다", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const yamlStore = await import("../../src/config/yaml-store.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-genre-menu-"));
  fs.writeFileSync(path.join(dir, "genres.yaml"), ["defaults: {}", "genres:", "  팝:", '    emoji: ""', "    sources: [{ type: keyword, keywords: [pop] }]", "  재즈:", "    sources: [{ type: keyword, keywords: [jazz] }]", "  록:", "    emoji: 🤘", "    sources: [{ type: keyword, keywords: [rock] }]", ""].join("\n"));
  yamlStore._setConfigDir(dir);
  try {
    const menu = menuOf(buildGenreMenu());
    assert.deepEqual(
      menu.options.map((o) => [o.value, o.emoji?.name]),
      [
        ["팝", undefined],
        ["재즈", undefined],
        ["록", "🤘"],
      ],
    );
  } finally {
    yamlStore._setConfigDir(path.join(import.meta.dirname, "..", "..", "config"));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
