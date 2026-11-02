// src/sources/youtube/text-search.ts: 유튜브 글자 검색. 응답을 곡으로 읽기, 연령 인증 안내, 기억과 함께 기다리기, 실패, 세션 다시 만들기.
// 유튜브 응답은 youtubei.js 가 읽는 칸만 남긴 가짜다(실제 응답은 수백 KB 이고 IP, 방문자 값이 들어 있다)

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import sink from "../../src/infra/log/sink.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import { youtubeArt } from "../../src/rules/track-art.ts";
import { rememberedPrefix, rememberedSearch, rememberedVideo, resetTextSearch, searchText } from "../../src/sources/youtube/text-search.ts";

// sw.js_data: 세션을 만들 때 받는 기기 정보. youtubei.js 는 [0][2][0][0] 의 칸 번호로 읽는다(0 언어, 1 지역, 13 방문자, 16 클라이언트 버전)
function sessionData() {
  const device: unknown[] = Array(80).fill(null);
  Object.assign(device, { 0: "en", 1: "KR", 3: "0.0.0.0", 13: "visitor", 16: "2.20251020.00.00", 17: "Windows", 18: "10.0" });
  return `)]}'\n${JSON.stringify([["yt.sw.adr", null, [[device], "key"]]])}`;
}

type Video = { id: string; title: string; channel?: string; length?: string; live?: boolean };
const video = ({ id, title, channel = "채널", length, live = false }: Video) => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: channel, navigationEndpoint: { browseEndpoint: { browseId: "UCxxxxxxxxxxxxxxxxxxxxxx" } } }] },
    thumbnail: { thumbnails: [] },
    ...(length ? { lengthText: { simpleText: length } } : {}),
    // 썸네일 위 길이 자리. 라이브는 LIVE 모양
    thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: live ? "LIVE" : (length ?? "") }, style: live ? "LIVE" : "DEFAULT" } }],
    ...(live ? { badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW", label: "LIVE" } }] } : {}),
  },
});
const GATE = { backgroundPromoRenderer: { title: { runs: [{ text: "Confirm your age" }] }, bodyText: { runs: [{ text: "These results may be inappropriate for some users." }] } } };
const UNKNOWN = { lockupViewModel: { contentId: "abcdefghijk" } };
const searchPage = (items: unknown[]) => JSON.stringify({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } } } } });

let clock = 1_000_000;
const asked: string[] = [];
let sessions = 0;
let answer: (query: string) => Response = () => new Response(searchPage([]));
let sessionAnswer: () => Response = () => new Response(sessionData());

async function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/sw.js_data")) {
    sessions++;
    return sessionAnswer();
  }
  if (url.includes("/youtubei/v1/search")) {
    const query = (JSON.parse(String(init?.body)) as { query: string }).query;
    asked.push(query);
    return answer(query);
  }
  return new Response("", { status: 404 });
}

beforeEach(() => {
  clock = 1_000_000;
  asked.length = 0;
  sessions = 0;
  sessionAnswer = () => new Response(sessionData());
  answer = () => new Response(searchPage([]));
  resetTextSearch({ fetch: fakeFetch as typeof fetch, clock: () => clock });
});
after(() => resetTextSearch());

test("영상 항목을 곡으로 읽는다: 제목, 채널, 길이, 다듬은 주소, 썸네일. 같은 영상은 한 번, 라이브는 길이 0", async () => {
  answer = () => new Response(searchPage([video({ id: "aaaaaaaaaaa", title: " 좋은 날 ", channel: "가수", length: "3:56" }), video({ id: "aaaaaaaaaaa", title: "좋은 날", length: "3:56" }), video({ id: "bbbbbbbbbbb", title: "라디오", live: true })]));
  const found = await searchText("좋은 날");
  assert.equal(found.gated, false);
  assert.deepEqual(
    found.tracks.map((t) => [t.id, t.title, t.artist, t.duration, t.isLive, t.liveStatus, t.pageUrl, t.platform]),
    [
      ["aaaaaaaaaaa", "좋은 날", "가수", 236, false, null, "https://www.youtube.com/watch?v=aaaaaaaaaaa", "youtube"],
      ["bbbbbbbbbbb", "라디오", "채널", 0, true, "is_live", "https://www.youtube.com/watch?v=bbbbbbbbbbb", "youtube"],
    ],
  );
  assert.equal(found.tracks[0].thumbnail, youtubeArt("aaaaaaaaaaa"), "영상 id 로 만든 썸네일");
});

test("연령 인증 안내만 오면 결과 없음과 구분한다", async () => {
  answer = () => new Response(searchPage([GATE]));
  assert.deepEqual(await searchText("閃光"), { tracks: [], gated: true });
  answer = () => new Response(searchPage([]));
  assert.deepEqual(await searchText("아무것도"), { tracks: [], gated: false });
});

test("같은 검색어(대소문자, 앞뒤 공백 무시)는 기억에서 꺼내고, 시간이 지나면 다시 묻는다", async () => {
  answer = () => new Response(searchPage([video({ id: "aaaaaaaaaaa", title: "곡", length: "1:00" })]));
  await searchText("Lofi");
  await searchText("  lofi ");
  assert.deepEqual(asked, ["Lofi"]);
  assert.equal(rememberedSearch("LOFI")?.tracks.length, 1);
  assert.equal(rememberedVideo("aaaaaaaaaaa")?.title, "곡");
  clock += 10 * 60_000 + 1;
  assert.equal(rememberedSearch("lofi"), null);
  await searchText("lofi");
  assert.deepEqual(asked, ["Lofi", "lofi"]);
});

test("같은 검색어로 동시에 오면 한 번만 묻는다. 세션도 하나만 만든다", async () => {
  answer = () => new Response(searchPage([video({ id: "aaaaaaaaaaa", title: "곡", length: "1:00" })]));
  const [a, b] = await Promise.all([searchText("노래"), searchText("노래")]);
  assert.equal(a, b);
  assert.deepEqual(asked, ["노래"]);
  await Promise.all([searchText("하나"), searchText("둘")]);
  assert.equal(sessions, 1);
});

test("앞부분이 같은 이전 검색 중 가장 긴 것의 기억을 꺼낸다", async () => {
  answer = (query) => new Response(searchPage([video({ id: query === "아이" ? "aaaaaaaaaaa" : "bbbbbbbbbbb", title: query, length: "1:00" })]));
  await searchText("아이");
  await searchText("아이유");
  assert.equal(rememberedPrefix("아이유 좋은")?.tracks[0].title, "아이유");
  assert.equal(rememberedPrefix("아이폰")?.tracks[0].title, "아이");
  assert.equal(rememberedPrefix("다른"), null);
});

test("429 는 rate-limited, 그 밖의 실패 상태는 network-error 로 던지고 기억하지 않는다. 실패는 한 번 warn, 풀리면 info", async () => {
  const from = sink.buffer.length;
  answer = () => new Response("", { status: 429 });
  await assert.rejects(searchText("노래"), (error) => codeOf(error) === "rate-limited");
  await assert.rejects(searchText("노래"), (error) => codeOf(error) === "rate-limited");
  answer = () => new Response("", { status: 500 });
  await assert.rejects(searchText("다른"), (error) => codeOf(error) === "network-error");
  answer = () => new Response(searchPage([video({ id: "aaaaaaaaaaa", title: "곡", length: "1:00" })]));
  assert.equal((await searchText("노래")).tracks.length, 1, "실패는 기억하지 않아 다시 묻는다");
  const lines = sink.buffer.slice(from).filter((e) => e.text.startsWith("유튜브 검색"));
  assert.deepEqual(
    lines.map((e) => e.level),
    ["warn", "warn", "info"],
    "같은 까닭은 한 번, 까닭이 바뀌면 다시, 풀리면 한 줄",
  );
});

test("항목은 왔는데 읽은 영상이 없으면(응답 모양이 바뀜) 빈 결과와 warn", async () => {
  const from = sink.buffer.length;
  answer = () => new Response(searchPage([UNKNOWN]));
  assert.deepEqual(await searchText("노래"), { tracks: [], gated: false });
  assert.ok(sink.buffer.slice(from).some((e) => e.level === "warn" && e.text.startsWith("유튜브 검색 실패: 결과 1개를 읽지 못함")));
});

test("세션을 만들지 못하면 30초 동안 다시 만들지 않는다", async () => {
  sessionAnswer = () => new Response("", { status: 503 });
  await assert.rejects(searchText("하나"));
  await assert.rejects(searchText("둘"));
  assert.equal(sessions, 1, "장애 때 요청마다 만들지 않는다");
  clock += 30_001;
  sessionAnswer = () => new Response(sessionData());
  answer = () => new Response(searchPage([]));
  await searchText("셋");
  assert.equal(sessions, 2);
});

test("검색이 4xx(429 빼고)로 실패하면 다음 검색이 세션을 새로 만든다", async () => {
  answer = () => new Response("", { status: 400 });
  await assert.rejects(searchText("하나"));
  answer = () => new Response(searchPage([]));
  await searchText("둘");
  assert.equal(sessions, 2);
  answer = () => new Response("", { status: 429 });
  await assert.rejects(searchText("셋"));
  answer = () => new Response(searchPage([]));
  await searchText("넷");
  assert.equal(sessions, 2, "429 는 세션 탓이 아니다");
});
