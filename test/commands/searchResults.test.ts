// commands/search.ts 의 결과 화면 + interactions/buttonHandler.ts 의 고르기. 버튼이 자기 영상 ID 를 싣는다.
// 같은 사람이 다시 검색해도 앞 메시지의 버튼은 앞 검색의 영상을 고른다(버튼 밖에 기억해 둔 것이 없다)

import { test } from "node:test";
import assert from "node:assert/strict";
import { showSearchMenu } from "../../commands/search.ts";
import type { ChatInputCommandInteraction } from "discord.js";
import { fake } from "../helpers/fake.ts";
import * as tracks from "../helpers/tracks.ts";
import { partsOf } from "../../src/ui/customIds.ts";

type Row = { components: Array<{ data: { custom_id: string; label?: string } }> };
type Shown = { embeds: Array<{ data: { fields: Array<{ name: string }> } }>; components: Row[] };

// 검색 결과 화면을 그려 보낸 것을 돌려준다
async function menuOf(results: ReturnType<typeof tracks.youtube>[], userId = "u1") {
  let shown: Shown | null = null;
  const interaction = fake<ChatInputCommandInteraction>({
    user: { id: userId },
    editReply: async (payload: Shown) => {
      shown = payload;
    },
  });
  await showSearchMenu(interaction, results, "검색어");
  assert.ok(shown);
  return shown as Shown;
}

const pickIds = (shown: Shown) =>
  shown.components
    .flatMap((row) => row.components)
    .map((b) => b.data.custom_id)
    .filter((id) => partsOf(id).action === "pick");

test("다시 검색해도 앞 메시지의 1번은 앞 검색의 영상을 고른다", async () => {
  const first = await menuOf([tracks.youtube("aaaaaaaaaaa")]);
  const second = await menuOf([tracks.youtube("bbbbbbbbbbb")]);
  assert.deepEqual(pickIds(first), ["search:pick:u1:1:aaaaaaaaaaa"]);
  assert.deepEqual(pickIds(second), ["search:pick:u1:1:bbbbbbbbbbb"]);
});

test("영상 ID 가 없는 결과는 빼고 번호를 매긴다. 목록과 버튼의 번호가 맞는다", async () => {
  const shown = await menuOf([tracks.youtube("aaaaaaaaaaa", { title: "A" }), tracks.youtube("", { id: undefined, title: "ID 없음" }), tracks.youtube("ccccccccccc", { title: "C" })]);
  assert.deepEqual(
    shown.embeds[0].data.fields.map((f) => f.name),
    ["1. A", "2. C"],
  );
  assert.deepEqual(pickIds(shown), ["search:pick:u1:1:aaaaaaaaaaa", "search:pick:u1:2:ccccccccccc"]);
});

test("같은 영상이 두 번 나와도 버튼 custom_id 는 겹치지 않는다(한 메시지에서 겹치면 디스코드가 거절한다)", async () => {
  const shown = await menuOf([tracks.youtube("aaaaaaaaaaa"), tracks.youtube("aaaaaaaaaaa")]);
  const ids = shown.components.flatMap((row) => row.components).map((b) => b.data.custom_id);
  assert.equal(new Set(ids).size, ids.length);
});
