// src/discord/commands/search.ts 의 자동완성: 맨 위 줄과 곡 후보, 연령 인증 안내, 마감과 실패, 100자 상한

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { ApplicationCommandOptionChoiceData, AutocompleteInteraction } from "discord.js";
import searchCommand from "../../src/discord/commands/search.ts";
import { resetTextSearch } from "../../src/sources/youtube/text-search.ts";
import type { TextSearchResult } from "../../src/sources/youtube/text-search.ts";
import { fake, fakeBot } from "../helpers/fake.ts";
import * as tracks from "../helpers/tracks.ts";

const bot = fakeBot();

beforeEach(() => resetTextSearch());
after(() => resetTextSearch());

/** 자동완성 하나를 부르고 답한 선택지. createdAt: 상호작용이 만들어진 시각(기본은 방금) */
async function complete(typed: string, search: (query: string) => Promise<TextSearchResult>, { createdAt = Date.now() } = {}) {
  const answered: ApplicationCommandOptionChoiceData[][] = [];
  const it = fake<AutocompleteInteraction<"cached">>({
    options: { getFocused: () => typed },
    createdTimestamp: createdAt,
    respond: async (choices: ApplicationCommandOptionChoiceData[]) => void answered.push(choices),
  });
  await searchCommand.autocomplete(it, bot, { search });
  assert.equal(answered.length, 1, "늘 한 번 답한다");
  return answered[0];
}

const never = () => new Promise<TextSearchResult>(() => {});
const found = (list: ReturnType<typeof tracks.youtube>[]) => async () => ({ tracks: list, gated: false });

test("빈 입력, 링크는 빈 목록. 짧은 검색어는 찾지 않고 맨 위 줄만", async () => {
  assert.deepEqual(await complete("  ", never), []);
  assert.deepEqual(await complete("https://youtu.be/abcdefghijk", never), []);
  assert.deepEqual(await complete("spotify:track:1SwZVVH9BnXtLRLi2cbFhw", never), []);
  assert.deepEqual(await complete("아", never), [{ name: '🔍 "아" 검색 결과 보기', value: "아" }]);
});

test("맨 위 줄(값은 입력한 글자)과 곡 후보 10개(값은 yt:<영상 id>). 이름은 제목 - 채널 (길이), 라이브는 🔴LIVE, 제목이 없으면 알 수 없는 곡", async () => {
  const list = [tracks.youtube("aaaaaaaaaaa", { title: "좋은 날", artist: "아이유", duration: 236 }), tracks.youtube("bbbbbbbbbbb", { title: "라디오", artist: "채널", isLive: true }), tracks.youtube("ccccccccccc", { title: null, artist: "", duration: 0 }), ...Array.from({ length: 12 }, (_, i) => tracks.youtube(`d${String(i).padStart(10, "0")}`, { title: `곡 ${i}`, artist: "채널", duration: 60 }))];
  const choices = await complete(" 아이유 좋은 날 ", found(list));
  assert.equal(choices.length, 11, "맨 위 줄과 후보 10개");
  assert.deepEqual(choices.slice(0, 4), [
    { name: '🔍 "아이유 좋은 날" 검색 결과 보기', value: "아이유 좋은 날" },
    { name: "좋은 날 - 아이유 (3:56)", value: "yt:aaaaaaaaaaa" },
    { name: "라디오 - 채널 (🔴LIVE)", value: "yt:bbbbbbbbbbb" },
    { name: "알 수 없는 곡 (알 수 없음)", value: "yt:ccccccccccc" },
  ]);
});

test("이름은 100자를 넘지 않는다. 곡 후보는 길이를 남기고 앞을 자르고, 맨 위 줄은 검색어를 자른다(값은 그대로)", async () => {
  const query = "가".repeat(100);
  const list = [tracks.youtube("aaaaaaaaaaa", { title: "제".repeat(120), artist: "채널", duration: 61 })];
  const [top, song] = await complete(query, found(list));
  assert.ok(top.name.length <= 100 && top.name.endsWith('…" 검색 결과 보기'));
  assert.equal(top.value, query);
  assert.ok(song.name.length <= 100 && song.name.endsWith("… (1:01)"));
});

test("연령 인증 안내만 왔으면 맨 위 줄 하나, 이름이 그 문장이다(값은 입력한 글자라 보내면 같은 안내가 뜬다)", async () => {
  assert.deepEqual(await complete("閃光", async () => ({ tracks: [], gated: true })), [{ name: "유튜브가 연령 인증을 요구하는 검색어예요. 링크로 직접 넣어 주세요.", value: "閃光" }]);
});

test("마감 안에 못 찾거나 검색이 실패하면 맨 위 줄만 답한다(던지지 않는다)", async () => {
  const late = await complete("노래", never, { createdAt: Date.now() - 10_000 });
  assert.deepEqual(late, [{ name: '🔍 "노래" 검색 결과 보기', value: "노래" }]);
  const failed = await complete("노래", async () => {
    throw new Error("끊김");
  });
  assert.deepEqual(failed, [{ name: '🔍 "노래" 검색 결과 보기', value: "노래" }]);
});
