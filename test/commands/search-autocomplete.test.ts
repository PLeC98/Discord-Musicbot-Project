// src/discord/commands/search.ts 의 자동완성: 맨 위 줄과 곡 후보, 스포티파이 섞기, 연령 인증 안내, 마감과 실패, 100자 상한, 고친 선택지 이름, 다음 입력 기다리기

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { ApplicationCommandOptionChoiceData, AutocompleteInteraction } from "discord.js";
import searchCommand from "../../src/discord/commands/search.ts";
import { resetTextSearch, searchText } from "../../src/sources/youtube/text-search.ts";
import type { TextSearchResult } from "../../src/sources/youtube/text-search.ts";
import type { SpotifyTrack } from "../../src/sources/spotify.ts";
import { fake, fakeBot } from "../helpers/fake.ts";
import * as tracks from "../helpers/tracks.ts";
import { searchPage, sessionData, video } from "../helpers/youtube-search.ts";

const bot = fakeBot();

beforeEach(() => resetTextSearch());
after(() => resetTextSearch());

/**
 * 자동완성 하나를 부르고 답한 선택지. createdAt: 상호작용이 만들어진 시각(기본은 방금), user: 입력한 사람,
 * wait: 다음 입력을 기다리는 것(기본은 바로 지나간다)
 */
async function complete(typed: string, search: (query: string) => Promise<TextSearchResult>, { createdAt = Date.now(), user = "u1", wait = async () => {}, spotify = null as ((query: string) => Promise<SpotifyTrack[]>) | null } = {}) {
  const answered: ApplicationCommandOptionChoiceData[][] = [];
  const it = fake<AutocompleteInteraction<"cached">>({
    options: { getFocused: () => typed },
    createdTimestamp: createdAt,
    user: { id: user },
    respond: async (choices: ApplicationCommandOptionChoiceData[]) => void answered.push(choices),
  });
  // 스포티파이는 정하지 않으면 준비되지 않은 것(진짜 준비는 네트워크로 상태를 받는다)
  await searchCommand.autocomplete(it, bot, { search, wait, searchSpotify: spotify ?? (() => assert.fail("스포티파이를 찾지 않는다")), spotifyReady: () => spotify !== null });
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

test("이름이 같은 후보는 하나만 둔다(겹치면 디스코드가 응답을 거절할 수 있다). 100자를 넘는 입력은 빈 목록", async () => {
  const same = { title: "좋은 날", artist: "아이유", duration: 236 };
  const choices = await complete("좋은 날", found([tracks.youtube("aaaaaaaaaaa", same), tracks.youtube("bbbbbbbbbbb", same), tracks.youtube("ccccccccccc", { ...same, duration: 240 })]));
  assert.deepEqual(
    choices.map((c) => c.value),
    ["좋은 날", "yt:aaaaaaaaaaa", "yt:ccccccccccc"],
  );
  assert.deepEqual(await complete("가".repeat(101), never), []);
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

test("선택한 후보의 이름을 고쳐 온 것: 맨 위 줄은 따옴표 안의 검색어, 곡 후보는 끝의 길이를 떼고 찾는다. 연령 인증 문장은 찾지 않는다", async () => {
  const asked: string[] = [];
  const record = async (q: string) => (asked.push(q), { tracks: [], gated: false });
  await complete('🔍 "mik" 검색 결과 보', record);
  await complete('🔍 "miku', record);
  await complete("좋은 날 - 아이유 (3:56)", record);
  await complete("라디오 - 채널 (🔴LIVE)", record);
  await complete("閃光 - [Alexandros] (4:10) (Spotify)", record);
  assert.deepEqual(asked, ["mik", "miku", "좋은 날 - 아이유", "라디오 - 채널", "閃光 - [Alexandros]"]);
  assert.deepEqual(await complete("유튜브가 연령 인증을 요구하는 검색어예요. 링크로", () => assert.fail("찾지 않는다")), []);
});

test("같은 사람의 다음 입력이 기다리는 동안 오면 앞 요청은 찾지 않고 기억으로만 답한다. 다른 사람은 따로 센다", async () => {
  const asked: string[] = [];
  const record = async (q: string) => (asked.push(q), { tracks: [], gated: false });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const first = complete("아이", record, { wait: () => held });
  const other = complete("다른 사람", record, { user: "u2" });
  const second = complete("아이유", record);
  release();
  assert.deepEqual(await first, [{ name: '🔍 "아이" 검색 결과 보기', value: "아이" }]);
  await second;
  await other;
  assert.deepEqual(asked.sort(), ["다른 사람", "아이유"]);
});

test("이미 찾아 둔 검색어는 기다리지도 다시 찾지도 않는다", async () => {
  resetTextSearch({
    fetch: (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      return new Response(url.includes("/sw.js_data") ? sessionData() : searchPage([video({ id: "aaaaaaaaaaa", title: "좋은 날", channel: "아이유", length: "3:56" })]));
    }) as typeof fetch,
  });
  await searchText("좋은 날");
  const choices = await complete("좋은 날", () => assert.fail("다시 찾지 않는다"), { wait: () => assert.fail("기다리지 않는다") });
  assert.deepEqual(choices[1], { name: "좋은 날 - 아이유 (3:56)", value: "yt:aaaaaaaaaaa" });
});

// 스포티파이 곡 id 는 22자. i 는 0 ~ 9
const spotifyTrack = (i: number): SpotifyTrack => ({ title: `스포티파이 ${i}`, artist: "가수", album: null, pageUrl: `https://open.spotify.com/track/${String(i).repeat(22)}`, requestKey: "", duration: 200, thumbnail: null, platform: "spotify", id: String(i).repeat(22) });
const youtubeList = (n: number) => Array.from({ length: n }, (_, i) => tracks.youtube(`y${String(i).padStart(10, "0")}`, { title: `유튜브 ${i}`, artist: "채널", duration: 60 }));
const spotifyList = (n: number) => Array.from({ length: n }, (_, i) => spotifyTrack(i));

test("스포티파이가 준비돼 있으면 유튜브 7, 스포티파이 3 을 섞는다. 이름 끝 (Spotify), 값 sp:<곡 id>. 한쪽이 모자라면 다른 쪽으로 채운다", async () => {
  const both = await complete("노래", found(youtubeList(12)), { spotify: async () => spotifyList(10) });
  assert.equal(both.length, 11);
  assert.deepEqual(
    both.slice(1).map((c) => String(c.value).slice(0, 3)),
    ["yt:", "yt:", "yt:", "yt:", "yt:", "yt:", "yt:", "sp:", "sp:", "sp:"],
  );
  assert.deepEqual(both[8], { name: "스포티파이 0 - 가수 (3:20) (Spotify)", value: `sp:${"0".repeat(22)}` });

  const fewYoutube = await complete("노래 둘", found(youtubeList(2)), { spotify: async () => spotifyList(10) });
  assert.deepEqual(
    fewYoutube.slice(1).map((c) => String(c.value).slice(0, 3)),
    ["yt:", "yt:", ...Array(8).fill("sp:")],
  );
  const fewSpotify = await complete("노래 셋", found(youtubeList(12)), { spotify: async () => spotifyList(1) });
  assert.deepEqual(
    fewSpotify.slice(1).map((c) => String(c.value).slice(0, 3)),
    [...Array(9).fill("yt:"), "sp:"],
  );
});

test("유튜브가 연령 인증으로 막으면 스포티파이 곡으로 채운다. 스포티파이도 없으면 연령 인증 문장", async () => {
  const gated = async () => ({ tracks: [], gated: true });
  const filled = await complete("閃光", gated, { spotify: async () => spotifyList(10) });
  assert.equal(filled[0].name, '🔍 "閃光" 검색 결과 보기');
  assert.equal(filled.length, 11);
  assert.ok(filled.slice(1).every((c) => String(c.value).startsWith("sp:")));
  assert.deepEqual(await complete("閃光 둘", gated, { spotify: async () => [] }), [{ name: "유튜브가 연령 인증을 요구하는 검색어예요. 링크로 직접 넣어 주세요.", value: "閃光 둘" }]);
});

test("스포티파이 검색이 실패하면 유튜브만", async () => {
  const choices = await complete("노래 넷", found(youtubeList(12)), {
    spotify: async () => {
      throw new Error("429");
    },
  });
  assert.equal(choices.length, 11);
  assert.ok(choices.slice(1).every((c) => String(c.value).startsWith("yt:")));
});
