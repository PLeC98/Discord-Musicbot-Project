// 곡 찾기(sources/lookup) · 유튜브 동등물(youtube/equivalent) · 스트림(streamUrl)의 분기를 고정한다
// (링크 종류별 조회 · 캐시 지름길 · 키 만들기 · 동등물 찾기 · 재검색 · 스트림).
//
// 부르는 소스(YouTube · Spotify · SoundCloud · DirectLink)는 가짜를 넘기고, 링크 데이터는 진짜 저장소를 임시 DB 로 쓴다.
// 유튜브 검색 결과도 트랙 모양이다(음원 주소가 audioUrl).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { cacheDb } from "../../src/store/cache-db.ts";
import * as stores from "../../src/store/stores.ts";
import type { Range } from "../../src/sources/lookup.ts";
import type { TrackInfo } from "../../src/player/track.ts";
import * as tracks from "../helpers/tracks.ts";
import type { Seeking } from "../../src/sources/youtube/equivalent.ts";
import { networkError } from "../helpers/errors.ts";
import { codedError, errorKind } from "../../src/rules/error-kind.ts";
import sink from "../../src/infra/log/sink.ts";
import { plainText } from "../helpers/notice.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-paths-"));
const audioCache = await import("../../src/store/audio-cache.ts");
const trackLookup = await import("../../src/store/track-lookup.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
stores.open(TMP);
audioCache.initialize();

const YouTube = await import("../../src/sources/youtube/index.ts");
const Spotify = await import("../../src/sources/spotify.ts");
const equivalent = await import("../../src/sources/youtube/equivalent.ts");
const lookup = await import("../../src/sources/lookup.ts");
const pinnedSources = await import("../../src/store/pinned-sources.ts");
const streamUrl = await import("../../src/sources/stream-url.ts");
const { audioKeyOf } = await import("../../src/rules/audio-key-of.ts");

beforeEach(() => {
  cacheDb.get().exec("DELETE FROM track_lookup; DELETE FROM audio_cache; DELETE FROM pinned_sources;");
  fs.rmSync(audioCache.cacheDir(), { recursive: true, force: true, maxRetries: 5 });
});

after(() => {
  audioCache.close();
  stores.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

const ytTrack = (id: string, extra: Partial<TrackInfo> = {}): TrackInfo => tracks.youtube(id, { duration: 200, ...extra });
// 소스가 준 곡. 받은 인자를 곡 필드에 실어 그대로 넘어왔는지 본다
const found = (title: string, extra: Partial<TrackInfo> = {}): TrackInfo => ({ title, pageUrl: title, requestKey: title, platform: "test", duration: 0, ...extra });

// ── 링크 종류 ─────────────────────────────────────────────────────────

test("링크 종류: 유튜브 · 스포티파이 · 사운드클라우드 · 직접 링크, 검색어는 유튜브(검색), 알려진 사이트의 다른 주소는 unknown", () => {
  const cases = [
    ["https://youtu.be/aaaaaaaaaaa", "youtube"],
    ["https://open.spotify.com/track/abc", "spotify"],
    ["spotify:album:abc", "spotify"],
    ["https://soundcloud.com/a/b", "soundcloud"],
    ["https://files.test/a.mp3", "direct"],
    ["https://anilist.co/anime/1", "direct"],
    ["https://open.spotify.com/episode/abc", "unknown"],
    ["그냥 검색어", "youtube"],
  ];
  for (const [q, want] of cases) assert.equal(lookup.detectPlatform(q), want, q);
  assert.equal(lookup.isUnsupportedLink("https://www.youtube.com/@channel"), true);
  assert.equal(lookup.isUnsupportedLink("https://www.youtube.com/watch?v=aaaaaaaaaaa"), false);
});

// ── 조회 ──────────────────────────────────────────────────────────────

test("조회: 유튜브 재생목록은 구간을 넘겨 받는다. 영상도 가리키는 주소만 목록을 못 받으면 그 영상으로 간다", async () => {
  const seen: Array<Range | undefined> = [];
  const listed = {
    youtube: {
      ...YouTube,
      getPlaylist: async (_url: string, range?: Range) => {
        seen.push(range);
        return { tracks: [ytTrack("p1")], total: 40, nextOffset: 10 };
      },
    },
  };
  const r = await lookup.getTrackData("https://www.youtube.com/playlist?list=PL1", "t", { offset: 0, limit: 10 }, listed);
  assert.deepEqual(seen, [{ offset: 0, limit: 10 }]);
  assert.deepEqual({ success: r.success, isPlaylist: r.isPlaylist, collection: r.collection, total: r.total, nextOffset: r.nextOffset }, { success: true, isPlaylist: true, collection: "playlist", total: 40, nextOffset: 10 });

  // 목록만 가리키는 주소: 비면 없음, 못 받으면 그 까닭(검색으로 흘리지 않는다)
  const noSearch = (getPlaylist: () => Promise<null>) => ({ youtube: { ...YouTube, getPlaylist, search: async () => assert.fail("검색하면 안 된다") } });
  assert.deepEqual(
    await lookup.getTrackData(
      "https://www.youtube.com/playlist?list=PL2",
      undefined,
      undefined,
      noSearch(async () => null),
    ),
    { success: false, code: "no-song-result" },
  );
  const gone = codedError("unavailable-playlist", "ERROR: [youtube:tab] PL3: The playlist does not exist.");
  const failed = await lookup.getTrackData(
    "https://www.youtube.com/playlist?list=PL3",
    undefined,
    undefined,
    noSearch(async () => Promise.reject(gone)),
  );
  assert.deepEqual([failed.success, failed.code, failed.error], [false, "lookup-failed", gone]);

  // 영상도 가리키는 주소: 목록을 못 받거나 비면 그 영상 하나
  for (const getPlaylist of [async () => null, async () => Promise.reject(gone)]) {
    const video = { youtube: { ...YouTube, getPlaylist, search: async (q: string, n: number) => [ytTrack("s1", { title: q, duration: n })] } };
    const from = sink.buffer.length;
    const one = await lookup.getTrackData("https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PL4", undefined, undefined, video);
    assert.equal(one.isPlaylist, false);
    assert.equal(sink.buffer.slice(from).filter((e) => e.text.includes("영상 하나로")).length, 1, "영상 하나로 간 것을 한 줄 남긴다");
    assert.deepEqual([one.tracks?.[0].title, one.tracks?.[0].duration], ["https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PL4", 1]);
  }
});

test("조회: 모르는 모양의 유튜브 링크는 검색으로 흘리지 않고 거절한다", async () => {
  const noSearch = { youtube: { ...YouTube, search: async () => assert.fail("검색하면 안 된다") } };
  assert.deepEqual(await lookup.getTrackData("https://www.youtube.com/@channel", undefined, undefined, noSearch), { success: false, code: "yt-unplayable" });
});

test("조회: 스포티파이 앨범 · 가수 · 재생목록은 모음으로, 곡은 한 곡으로, 글자는 스포티파이 검색으로", async () => {
  const spotify = { spotify: { ...Spotify, getCollection: async (url: string) => ({ tracks: [found(url)], total: 12, nextOffset: 1 }) } };
  const album = await lookup.getTrackData("https://open.spotify.com/album/al1", undefined, undefined, spotify);
  assert.deepEqual([album.isPlaylist, album.collection, album.total], [true, "album", 12]);
  const one = await lookup.getTrackData("https://open.spotify.com/track/tr1", undefined, undefined, spotify);
  assert.deepEqual([one.isPlaylist, one.collection, one.total, one.nextOffset], [false, null, null, null]);
});

// 사운드클라우드 곡 · 세트의 한 구간, 곡 찾기가 넘기는 것. 물은 주소와 구간을 적는다
const scAsked: Array<{ url: string; range?: Range & { what?: string } }> = [];
const scTrack = (url: string) => ({ ...found(url), platform: "soundcloud" as const, audioUrl: url, pageUrl: url, requestKey: url });
const soundcloud = (kind: "track" | "set", skipped = 0, tracks = 2) => ({
  find: async (url: string, range?: Range & { what?: "track" | "set" }) => {
    scAsked.push({ url, range });
    if (kind === "track") return { kind, track: scTrack(url) };
    return { kind, title: "세트", setId: "123", tracks: Array.from({ length: tracks }, (_, i) => scTrack(`${url}#${i}`)), total: 30, nextOffset: 10, skipped };
  },
});

test("조회: 사운드클라우드 곡 링크 · 직접 링크는 한 곡", async () => {
  const sources = { soundcloud: soundcloud("track"), direct: { getInfo: async (url: string) => [found(url)] } };
  scAsked.length = 0;
  const sc = await lookup.getTrackData("https://soundcloud.com/a/b", undefined, undefined, sources);
  assert.deepEqual([sc.isPlaylist, sc.tracks?.[0].title], [false, "https://soundcloud.com/a/b"]);
  assert.equal(scAsked[0].range?.what, "track");
  const direct = await lookup.getTrackData("https://files.test/a.mp3", undefined, undefined, sources);
  assert.equal(direct.tracks?.[0].title, "https://files.test/a.mp3");
});

// 받는 범위: 곡 · 세트 · 짧은 링크. 프로필 · 좋아요 같은 모음은 조회하지 않고 알린다
test("조회: 사운드클라우드 세트는 모음(이어 받을 id 와 뺀 곡 수), 모음 링크는 거절", async () => {
  scAsked.length = 0;
  const set = await lookup.getTrackData("https://soundcloud.com/a/sets/b", undefined, { limit: 50 }, { soundcloud: soundcloud("set", 3) });
  assert.deepEqual([set.isPlaylist, set.collection, set.collectionId, set.total, set.nextOffset, set.skipped, set.tracks?.length], [true, "playlist", "123", 30, 10, 3, 2]);
  assert.deepEqual(scAsked[0].range, { offset: 0, limit: 50, what: "set" }, "10곡으로 자르는 것은 출처다");

  const secret = await lookup.getTrackData("https://soundcloud.com/a/sets/b/s-Tok3n", undefined, undefined, { soundcloud: soundcloud("set") });
  assert.equal(secret.collectionId, null, "비밀 공유 세트는 숫자 id 로 다시 부를 수 없다");

  const nothing = await lookup.getTrackData("https://soundcloud.com/a/sets/b", undefined, undefined, { soundcloud: soundcloud("set", 10, 0) });
  assert.equal(nothing.success, false);
  assert.deepEqual([nothing.code, nothing.skipped], ["nothing-playable", 10], "뺀 곡 수를 싣는다(안내가 몇 곡인지 말한다)");

  scAsked.length = 0;
  for (const url of ["https://soundcloud.com/artist", "https://soundcloud.com/artist/likes"]) {
    const r = await lookup.getTrackData(url, undefined, undefined, { soundcloud: soundcloud("track") });
    assert.equal(r.code, "sc-unsupported", url);
  }
  assert.equal(scAsked.length, 0, "모음은 부르지 않는다");
});

test("조회: 결과가 없으면 no-song-result, 던지면 lookup-failed 와 그 오류. 문장은 부르는 쪽이 만든다", async () => {
  const empty = { youtube: { ...YouTube, search: async () => [] } };
  assert.deepEqual(await lookup.getTrackData("없는 곡", undefined, undefined, empty), { success: false, code: "no-song-result" });
  const boom = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  const broken = {
    youtube: {
      ...YouTube,
      search: async () => {
        throw boom;
      },
    },
  };
  assert.deepEqual(await lookup.getTrackData("끊긴 곡", undefined, undefined, broken), { success: false, code: "lookup-failed", error: boom });
});

test("조회 실패의 안내문: 까닭의 문장 · 조회가 던진 오류는 그 종류로", async () => {
  const { addFailureMessage } = await import("../../src/ui/error-messages.ts");
  assert.equal(plainText(addFailureMessage({ code: "no-song-result" })), "곡을 찾지 못했어요.\n다른 검색어나 링크로 시도해 주세요.");
  assert.equal(plainText(addFailureMessage({ code: "unsupported-link" })), "알 수 없는 링크예요!\n재생을 지원하지 않는 플랫폼이에요.");
  assert.match(plainText(addFailureMessage({ code: "nothing-playable", skipped: 10 })), /앞의 10곡이 전부 재생할 수 없는 곡이에요/);
  assert.match(plainText(addFailureMessage({ code: "sc-unsupported" })), /지원하지 않는 사운드클라우드 링크/);
  assert.match(plainText(addFailureMessage({ code: "lookup-failed", kind: errorKind(networkError()) })), /연결 오류가 발생했어요/);
  assert.match(plainText(addFailureMessage({ code: "lookup-failed" })), /예상치 못한 오류예요/, "종류를 모르면 unknown");
});

test("모음 이어 받기: 유튜브 재생목록 · 스포티파이 · 사운드클라우드 세트. 못 받으면 빈 구간(검색으로 안 넘어간다)", async () => {
  const gone = { youtube: { ...YouTube, getPlaylist: async () => null } };
  assert.deepEqual(await lookup.getCollection("https://www.youtube.com/playlist?list=PL", { offset: 50, limit: 10 }, gone), { tracks: [], total: null, nextOffset: null });
  const one = found("1", { id: "1" });
  const part = { youtube: { ...YouTube, getPlaylist: async () => ({ tracks: [one], total: 60 }) } };
  assert.deepEqual(await lookup.getCollection("https://www.youtube.com/playlist?list=PL", undefined, part), { tracks: [one], total: 60, nextOffset: null });
  // 스포티파이의 답은 그대로 넘긴다. 물은 주소와 구간을 적는다
  const asked: Array<{ url: string; range?: Range }> = [];
  const spotify = {
    spotify: {
      ...Spotify,
      getCollection: async (url: string, range?: Range) => {
        asked.push({ url, range });
        return { tracks: [one] };
      },
    },
  };
  assert.deepEqual(await lookup.getCollection("https://open.spotify.com/playlist/p", { offset: 5 }, spotify), { tracks: [one] });
  assert.deepEqual(asked, [{ url: "https://open.spotify.com/playlist/p", range: { offset: 5 } }]);
  const part2 = await lookup.getCollection("https://api.soundcloud.com/playlists/123", { offset: 10, limit: 11 }, { soundcloud: soundcloud("set", 1) });
  assert.deepEqual([part2.tracks.length, part2.total, part2.nextOffset, part2.skipped], [2, 30, 10, 1]);
  assert.deepEqual(await lookup.getCollection("https://soundcloud.com/a/b", undefined, { soundcloud: soundcloud("track") }), { tracks: [], total: null, nextOffset: null }, "곡 링크는 모음이 아니다");
});

test("캐시 지름길: 캐시 파일이 있는 곡은 조회 없이 링크 데이터의 트랙으로. 재생목록 · 모르는 유튜브 링크는 지름길을 안 탄다", async () => {
  const url = "https://www.youtube.com/watch?v=ccccccccccc";
  const file = audioCache.getFilePath("yt:ccccccccccc");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x");
  audioCache.recordDownloadStart("yt:ccccccccccc", { title: "t" });
  audioCache.recordDownloadComplete("yt:ccccccccccc", file, 1, { title: "t" }, { durationSec: 99 });
  trackLookup.recordTrackLookup({ requestKey: url, pageUrl: url, audioUrl: "https://www.youtube.com/watch?v=ccccccccccc", platform: "youtube", title: "장부 제목", artist: "장부 가수" });
  const noLookup = { youtube: { ...YouTube, search: async () => assert.fail("조회하면 안 된다") } };

  const hit = await lookup.resolveQuery(`https://youtu.be/ccccccccccc?si=share`, undefined, undefined, noLookup);
  assert.deepEqual([hit.success, hit.isPlaylist, hit.tracks?.[0].title, hit.tracks?.[0].duration, hit.tracks?.[0].audioUrl], [true, false, "장부 제목", 99, url]);

  let playlistAsked = false;
  const listed = {
    youtube: {
      getPlaylist: async () => {
        playlistAsked = true;
        return null;
      },
      search: async () => [],
    },
  };
  await lookup.resolveQuery(`${url}&list=PLx`, undefined, undefined, listed);
  assert.equal(playlistAsked, true, "list= 가 있으면 캐시의 한 곡이 재생목록을 가리지 않게 지름길을 건너뛴다");

  // 사운드클라우드 세트가 한 곡으로 캐시돼 있어도(옛 판이 세트를 한 곡으로 받아 둔 것) 세트로 다시 읽는다
  const setUrl = "https://soundcloud.com/a/sets/b";
  const setFile = audioCache.getFilePath("sc:a/sets/b");
  fs.writeFileSync(setFile, "x");
  audioCache.recordDownloadStart("sc:a/sets/b", { title: "t" });
  audioCache.recordDownloadComplete("sc:a/sets/b", setFile, 1, { title: "t" }, { durationSec: 194 });
  trackLookup.recordTrackLookup({ requestKey: setUrl, pageUrl: setUrl, audioUrl: setUrl, platform: "soundcloud", title: "세트를 한 곡으로" });
  scAsked.length = 0;
  const set = await lookup.resolveQuery(setUrl, undefined, undefined, { soundcloud: soundcloud("set") });
  assert.deepEqual([set.isPlaylist, scAsked.length], [true, 1]);
});

test("캐시 지름길: 직접 링크는 음원이 요청 그대로인 행만 쓴다(검색으로 맺힌 다른 음원은 되살리지 않는다)", async () => {
  const cached = (key: string) => {
    const file = audioCache.getFilePath(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x");
    audioCache.recordDownloadStart(key, { title: "t" });
    audioCache.recordDownloadComplete(key, file, 1, { title: "t" }, { durationSec: 42 });
  };
  const opened: string[] = [];
  const direct = {
    getInfo: async (url: string) => {
      opened.push(url);
      throw codedError("unsupported-link", "음원이 아닌 링크입니다(page)");
    },
  };

  const page = "https://blog.test/post/1";
  cached("yt:ddddddddddd");
  trackLookup.recordTrackLookup({ requestKey: page, pageUrl: page, audioUrl: "https://www.youtube.com/watch?v=ddddddddddd", platform: "youtube", title: "엉뚱한 영상" });
  const refused = await lookup.resolveQuery(page, undefined, undefined, { direct });
  assert.deepEqual([refused.success, refused.code, opened], [false, "unsupported-link", [page]]);

  const file = "https://files.test/stream";
  cached(audioKeyOf(file)!);
  trackLookup.recordTrackLookup({ requestKey: file, pageUrl: file, audioUrl: file, platform: "direct", title: "파일" });
  const hit = await lookup.resolveQuery(file, undefined, undefined, { direct });
  assert.deepEqual([hit.success, hit.tracks?.[0].title, opened.length], [true, "파일", 1]);
});

// ── 직접 지정한 음원 ──────────────────────────────────────────────────
// 운영자가 캐시 DB 에서 지정한 음원이 링크 데이터 · 원래 링크보다 앞선다. 곡 정보는 요청의 것이다

test("지정한 음원: 링크 데이터가 표시 정보를 기억하면 조회 없이 그 정보와 지정한 음원으로 곡을 만든다", async () => {
  const url = "https://www.youtube.com/watch?v=pinlookup01";
  trackLookup.recordTrackLookup({ requestKey: url, pageUrl: url, audioUrl: url, platform: "youtube", title: "원래 제목", artist: "원래 가수" });
  pinnedSources.setPin(url, "https://soundcloud.com/pinned/track");
  const noLookup = { youtube: { ...YouTube, search: async () => assert.fail("조회하면 안 된다") } };

  const got = await lookup.resolveQuery("https://youtu.be/pinlookup01?si=share", undefined, undefined, noLookup);

  const t = got.tracks?.[0];
  assert.deepEqual([got.success, got.isPlaylist, t?.title, t?.requestKey, t?.audioUrl, t?.audioFoundBy, t?.isLive], [true, false, "원래 제목", url, "https://soundcloud.com/pinned/track", "pinned", false]);
});

test("지정한 음원: 원래 영상이 죽었어도 지정한 음원에서 읽은 제목으로 곡을 만든다. 요청 키 · 링크 · 출처는 원래 요청의 것", async () => {
  const url = "https://www.youtube.com/watch?v=pindead0001";
  pinnedSources.setPin(url, "https://soundcloud.com/alive/song");
  const dead = { youtube: { ...YouTube, search: async () => [] }, soundcloud: { find: async (scUrl: string) => ({ kind: "track" as const, track: { ...scTrack(scUrl), title: "살아 있는 음원의 제목" } }) } };

  const got = await lookup.resolveQuery(url, undefined, undefined, dead);

  const t = got.tracks?.[0];
  assert.deepEqual([t?.title, t?.requestKey, t?.pageUrl, t?.platform, t?.audioUrl, t?.audioFoundBy], ["살아 있는 음원의 제목", url, url, "youtube", "https://soundcloud.com/alive/song", "pinned"]);
});

test("지정한 음원: 재생목록 주소는 지정 하나로 바뀌지 않는다(캐시 지름길과 같은 규칙)", async () => {
  const video = "https://www.youtube.com/watch?v=pinlist0001";
  pinnedSources.setPin(video, "https://soundcloud.com/pinned/x");
  let playlistAsked = false;
  const listed = {
    youtube: {
      getPlaylist: async () => {
        playlistAsked = true;
        return { tracks: [found("목록의 곡")], total: 1, nextOffset: null };
      },
      search: async () => [],
    },
  };
  const got = await lookup.resolveQuery(`${video}&list=PLx`, undefined, undefined, listed);
  assert.equal(playlistAsked, true);
  assert.equal(got.isPlaylist, true);
});

test("동등물: 지정한 음원이 있으면 검색 · 링크 데이터보다 먼저 쓰고, 다시 찾을 때(skipPin)는 건너뛴다", async () => {
  const sp = "https://open.spotify.com/track/pinequiv01";
  trackLookup.recordTrackLookup({ requestKey: sp, pageUrl: sp, audioUrl: "https://www.youtube.com/watch?v=ledgerequiv", platform: "spotify", title: "곡" });
  pinnedSources.setPin(sp, "https://soundcloud.com/pinned/equiv");
  const search = async () => assert.fail("검색하면 안 된다");

  const pinned: Seeking = { title: "곡", requestKey: sp, platform: "spotify", duration: 200 };
  assert.equal(await equivalent.findYouTubeEquivalent(pinned, { search }), "https://soundcloud.com/pinned/equiv");
  assert.equal(pinned.audioFoundBy, "pinned");

  const skipping: Seeking = { title: "곡", requestKey: sp, platform: "spotify", duration: 200 };
  assert.equal(await equivalent.findYouTubeEquivalent(skipping, { search, skipPin: true }), "https://www.youtube.com/watch?v=ledgerequiv");
  assert.equal(skipping.audioFoundBy, "ledger");
});

// ── 동등물 찾기 · 재검색 ──────────────────────────────────────────────

test("동등물: 링크 데이터에 매핑이 있으면 검색하지 않고 쓰며, 링크 데이터에서 왔다고 표시한다", async () => {
  audioCache.recordDownloadStart("yt:fffffffffff", { title: "t" });
  trackLookup.recordTrackLookup({ requestKey: "https://open.spotify.com/track/sp1", pageUrl: "https://open.spotify.com/track/sp1", audioUrl: "https://www.youtube.com/watch?v=fffffffffff", platform: "spotify", title: "곡", artist: "가수" });
  const search = async () => assert.fail("검색하면 안 된다");
  const track: Seeking = { title: "곡", artist: "가수", pageUrl: "https://open.spotify.com/track/sp1", requestKey: "https://open.spotify.com/track/sp1", platform: "spotify", duration: 200 };

  const url = await equivalent.findYouTubeEquivalent(track, { search });

  assert.equal(url, "https://www.youtube.com/watch?v=fffffffffff");
  assert.equal(audioKeyOf(track.audioUrl), "yt:fffffffffff");
  assert.equal(track.audioFoundBy, "ledger");
});

test("동등물: 검색 결과에서 라이브를 빼고 점수로 고른다", async () => {
  const queries: Array<[string, number]> = [];
  const search = async (q: string, n: number) => {
    queries.push([q, n]);
    return [
      { id: "livelivelil", audioUrl: "https://www.youtube.com/watch?v=livelivelil", title: "곡 라이브 방송", artist: "가수", duration: 0, isLive: true },
      { id: "goodgoodgoo", audioUrl: "https://www.youtube.com/watch?v=goodgoodgoo", title: "가수 - 곡", artist: "가수", duration: 200 },
    ];
  };
  const track: Seeking = { title: "곡", artist: "가수", pageUrl: "https://open.spotify.com/track/sp2", requestKey: "https://open.spotify.com/track/sp2", platform: "spotify", duration: 200 };

  const url = await equivalent.findYouTubeEquivalent(track, { search });

  assert.ok(queries.length >= 1);
  assert.ok(
    queries.every(([q, n]) => n === (q === "가수" ? 15 : 6)),
    "검색어마다 6개씩, 아티스트 이름만은 15개",
  );
  assert.equal(url, "https://www.youtube.com/watch?v=goodgoodgoo");
  assert.equal(track.audioUrl, "https://www.youtube.com/watch?v=goodgoodgoo");
  assert.equal(track.audioFoundBy, "search", "새로 찾은 것은 내려가도 다시 찾지 않는다");
});

test("동등물: 이미 음원 주소가 있으면 그대로 돌려주고, 후보가 없으면 null", async () => {
  const has = { platform: "lastfm", audioUrl: "https://www.youtube.com/watch?v=hhhhhhhhhhh" };
  assert.equal(await equivalent.findYouTubeEquivalent(has), has.audioUrl);

  const nothing = { search: async () => [] };
  assert.equal(await equivalent.findYouTubeEquivalent({ title: "없음", artist: "?", pageUrl: "https://open.spotify.com/track/none", requestKey: "https://open.spotify.com/track/none", platform: "spotify" }, nothing), null);
});

test("재검색: 링크 데이터의 매핑을 삭제하고 필드를 비운 뒤 새로 찾는다", async () => {
  audioCache.recordDownloadStart("yt:deaddeaddea", { title: "t" });
  trackLookup.recordTrackLookup({ requestKey: "https://open.spotify.com/track/sp3", pageUrl: "https://open.spotify.com/track/sp3", audioUrl: "https://www.youtube.com/watch?v=deaddeaddea", platform: "spotify", title: "곡", artist: "가수" });
  const search = async () => [{ id: "newnewnewne", audioUrl: "https://www.youtube.com/watch?v=newnewnewne", title: "곡", artist: "가수", duration: 200 }];
  const track: Seeking = { title: "곡", artist: "가수", pageUrl: "https://open.spotify.com/track/sp3", requestKey: "https://open.spotify.com/track/sp3", platform: "spotify", duration: 200, audioUrl: "https://www.youtube.com/watch?v=deaddeaddea", audioFoundBy: "ledger" };

  const url = await equivalent.reresolveYouTube(track, { search });

  assert.equal(url, "https://www.youtube.com/watch?v=newnewnewne");
  assert.equal(track.audioFoundBy, "search");
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/track/sp3"), null, "링크 데이터 매핑을 삭제한다(새 매핑은 다운로드할 때 적힌다)");
});

// ── 스트림 ────────────────────────────────────────────────────────────

test("스트림: 링크 데이터에서 온 영상이 내려갔으면 한 번 다시 찾아 그것으로 연다", async () => {
  const asked: string[] = [];
  const youtube = {
    ...YouTube,
    getStream: async (url: string) => {
      asked.push(url);
      if (url.includes("deaddeaddea")) throw new Error("ERROR: Video unavailable");
      return { url: "https://rr.googlevideo.com/new" };
    },
  };
  const found = {
    ...equivalent,
    reresolveYouTube: async (t: Seeking) => {
      t.audioUrl = "https://www.youtube.com/watch?v=newnewnewne";
      return t.audioUrl;
    },
  };
  const track: Seeking = { title: "곡", platform: "spotify", pageUrl: "https://open.spotify.com/track/sp4", requestKey: "https://open.spotify.com/track/sp4", audioUrl: "https://www.youtube.com/watch?v=deaddeaddea", audioFoundBy: "ledger" };

  const s = await streamUrl.getStream(track, { youtube, equivalent: found });

  assert.deepEqual(asked, ["https://www.youtube.com/watch?v=deaddeaddea", "https://www.youtube.com/watch?v=newnewnewne"]);
  assert.equal(s.url, "https://rr.googlevideo.com/new");
});

// ── 직접 지정한 음원이 죽었을 때 ──────────────────────────────────────────

test("사라졌다는 판정: 확실히 사라진 것만(일시 오류 · 연령 제한으로 지정을 버리지 않는다)", async () => {
  const { deadSourceCode } = await import("../../src/sources/dead-source.ts");
  assert.equal(deadSourceCode(new Error("ERROR: [youtube] abc: Video unavailable")), "unavailable-contents");
  assert.equal(deadSourceCode(codedError("unavailable-contents", "HTTP Error 404")), "unavailable-contents");
  assert.equal(deadSourceCode(codedError("sc-preview-only", "미리듣기")), "sc-preview-only");
  assert.equal(deadSourceCode(codedError("direct-unavailable", "x", { cause: new Error("요청 실패: HTTP 404") })), "direct-unavailable");
  assert.equal(deadSourceCode(codedError("direct-unavailable", "x", { cause: new Error("요청 실패: HTTP 503") })), null, "5xx 는 일시 오류");
  assert.equal(deadSourceCode(codedError("direct-unavailable", "x", { cause: networkError("ECONNRESET") })), null);
  assert.equal(deadSourceCode(codedError("rate-limited", "HTTP Error 403")), null);
  assert.equal(deadSourceCode(new Error("ERROR: Sign in to confirm your age")), null, "연령 제한은 사라진 것이 아니다");
  assert.equal(deadSourceCode(codedError("pinned-live", "라이브")), "live", "라이브는 지정할 수 없다");
  assert.equal(deadSourceCode(codedError("unsupported-link", "음원이 아닌 링크입니다(page)")), "unsupported-link", "지운 파일 자리에 웹 페이지를 주는 서버");
});

// 사운드클라우드 지정이 404 로 죽는다
const deadSoundCloud = { getStream: async () => Promise.reject(codedError("unavailable-contents", "HTTP Error 404")) };

test("스트림: 지정한 음원이 사라졌으면 원래 링크로 한 번 더 열고, 실패를 재생 테스트 결과로 남긴다. 지정은 그대로", async () => {
  const url = "https://www.youtube.com/watch?v=pindeadstr1";
  pinnedSources.setPin(url, "https://soundcloud.com/gone/one");
  const youtube = { ...YouTube, getStream: async (u: string) => ({ url: `${u}#stream` }) };
  const track: Seeking = { title: "곡", platform: "youtube", requestKey: url, audioUrl: "https://soundcloud.com/gone/one", audioFoundBy: "pinned" };

  const s = await streamUrl.getStream(track, { youtube, soundcloud: deadSoundCloud, equivalent });

  assert.equal(s.url, `${url}#stream`);
  assert.deepEqual([track.audioUrl, track.audioFoundBy], [url, "given"]);
  const { getCheck } = await import("../../src/store/source-checks.ts");
  assert.equal(getCheck("sc:gone/one")?.ok, false);
  assert.equal(pinnedSources.getPin(url)?.audioUrl, "https://soundcloud.com/gone/one", "지정은 사람이 해제할 때까지 그대로");
});

test("스트림: 스포티파이 곡의 지정이 사라졌으면 지정을 건너뛰고 링크 데이터로, 자동재생 곡은 링크 데이터의 유튜브 영상으로", async () => {
  const youtube = { ...YouTube, getStream: async (u: string) => ({ url: `${u}#stream` }) };
  const sp = "https://open.spotify.com/track/pindeadsp01";
  pinnedSources.setPin(sp, "https://soundcloud.com/gone/two");
  trackLookup.recordTrackLookup({ requestKey: sp, pageUrl: sp, audioUrl: "https://www.youtube.com/watch?v=spledger001", platform: "spotify", title: "곡" });
  const spotify: Seeking = { title: "곡", platform: "spotify", requestKey: sp, audioUrl: "https://soundcloud.com/gone/two", audioFoundBy: "pinned" };
  assert.equal((await streamUrl.getStream(spotify, { youtube, soundcloud: deadSoundCloud, equivalent })).url, "https://www.youtube.com/watch?v=spledger001#stream");
  assert.equal(spotify.audioFoundBy, "ledger", "죽은 지정을 다시 붙이지 않았다");

  trackLookup.recordTrackLookup({ requestKey: "amq:pindead", pageUrl: "https://anilist.co/anime/9", audioUrl: "https://www.youtube.com/watch?v=autoledger1", platform: "anisongdb", title: "곡" });
  const auto: Seeking = { title: "곡", platform: "anisongdb", requestKey: "amq:pindead", audioUrl: "https://soundcloud.com/gone/three", audioFoundBy: "pinned" };
  assert.equal((await streamUrl.getStream(auto, { youtube, soundcloud: deadSoundCloud, equivalent })).url, "https://www.youtube.com/watch?v=autoledger1#stream");

  const orphan: Seeking = { title: "곡", platform: "anisongdb", requestKey: "amq:noledger", audioUrl: "https://soundcloud.com/gone/four", audioFoundBy: "pinned" };
  await assert.rejects(streamUrl.getStream(orphan, { youtube, soundcloud: deadSoundCloud, equivalent }), /404/, "링크 데이터도 없으면 원래 오류(자동재생이 다음 후보를 선택한다)");
});

test("스트림: 직접 링크 요청의 지정이 사라졌으면 그 링크로 담은 곡만 요청 주소로. 자동재생 곡의 요청 키(출처 페이지)는 음원으로 쓰지 않는다", async () => {
  const youtube = { ...YouTube, getStream: async (u: string) => ({ url: `${u}#stream` }) };
  const file = "https://files.test/pindead/stream";
  const own: Seeking = { title: "곡", platform: "direct", requestKey: file, audioUrl: "https://soundcloud.com/gone/five", audioFoundBy: "pinned" };
  assert.equal((await streamUrl.getStream(own, { youtube, soundcloud: deadSoundCloud, equivalent })).url, file);
  assert.deepEqual([own.audioUrl, own.audioFoundBy], [file, "given"]);

  const page = "https://www.last.fm/music/Artist/_/Song";
  trackLookup.recordTrackLookup({ requestKey: page, pageUrl: page, audioUrl: "https://www.youtube.com/watch?v=lfmledger01", platform: "lastfm", title: "곡" });
  const auto: Seeking = { title: "곡", platform: "lastfm", requestKey: page, audioUrl: "https://soundcloud.com/gone/six", audioFoundBy: "pinned" };
  assert.equal((await streamUrl.getStream(auto, { youtube, soundcloud: deadSoundCloud, equivalent })).url, "https://www.youtube.com/watch?v=lfmledger01#stream");
});

test("스트림: 지정한 음원이 라이브(방송 중 · 시작 전 · 인터넷 라디오)면 사라진 것과 같이 원래 링크로, 결과는 live", async () => {
  const { getCheck } = await import("../../src/store/source-checks.ts");
  for (const liveStatus of ["is_live", "is_upcoming"]) {
    const url = `https://www.youtube.com/watch?v=pinlive${liveStatus === "is_live" ? "0001" : "0002"}`;
    const pinned = "https://www.youtube.com/watch?v=livestream01";
    const youtube = { ...YouTube, getStream: async (u: string) => ({ url: `${u}#stream`, liveStatus: u === pinned ? liveStatus : null }) };
    const track: Seeking = { title: "곡", platform: "youtube", requestKey: url, audioUrl: pinned, audioFoundBy: "pinned" };
    assert.equal((await streamUrl.getStream(track, { youtube, equivalent })).url, `${url}#stream`, liveStatus);
    assert.deepEqual(getCheck("yt:livestream01"), { ok: false, code: "live", at: getCheck("yt:livestream01")!.at });
  }
  const radio = "https://radio.example.com/stream.mp3";
  const direct = { getInfo: async (u: string) => [{ isLive: u === radio }] };
  const youtube = { ...YouTube, getStream: async (u: string) => ({ url: `${u}#stream` }) };
  const req = "https://www.youtube.com/watch?v=pinradio001";
  const track: Seeking = { title: "곡", platform: "youtube", requestKey: req, audioUrl: radio, audioFoundBy: "pinned" };
  assert.equal((await streamUrl.getStream(track, { youtube, direct, equivalent })).url, `${req}#stream`);
  // 지정하지 않은 라이브는 그대로 라이브로 튼다
  const live: Seeking = { title: "곡", platform: "youtube", requestKey: req, audioUrl: req, audioFoundBy: "given" };
  const yt = { ...YouTube, getStream: async (u: string) => ({ url: `${u}#stream`, liveStatus: "is_live" }) };
  assert.equal((await streamUrl.getStream(live, { youtube: yt, direct, equivalent })).liveStatus, "is_live");
});

test("스트림: 지정한 음원의 일시 오류는 지정을 건너뛰지 않는다", async () => {
  const flaky = { getStream: async () => Promise.reject(codedError("rate-limited", "HTTP Error 403")) };
  const track: Seeking = { title: "곡", platform: "youtube", requestKey: "https://www.youtube.com/watch?v=pinflaky001", audioUrl: "https://soundcloud.com/flaky/one", audioFoundBy: "pinned" };
  await assert.rejects(streamUrl.getStream(track, { soundcloud: flaky, equivalent }), /403/);
  assert.equal(track.audioFoundBy, "pinned");
});

test("스트림: 새로 찾은 영상이 내려간 것은 다시 찾지 않는다. 사운드클라우드는 제 주소로", async () => {
  const youtube = {
    ...YouTube,
    getStream: async () => {
      throw new Error("ERROR: Video unavailable");
    },
  };
  const noResearch = { ...equivalent, reresolveYouTube: async () => assert.fail("다시 찾으면 안 된다") };
  await assert.rejects(streamUrl.getStream({ platform: "spotify", audioUrl: "https://www.youtube.com/watch?v=x", audioFoundBy: "search" }, { youtube, equivalent: noResearch }), /Video unavailable/);

  const soundcloud = { getStream: async (url: string) => ({ url: `${url}#stream` }) };
  assert.deepEqual(await streamUrl.getStream({ platform: "soundcloud", audioUrl: "https://soundcloud.com/a/b" }, { soundcloud }), { url: "https://soundcloud.com/a/b#stream" });
});
