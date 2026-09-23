"use strict";

// YouTube 의 검색 · 정보 · 스트림 · 재생목록이 yt-dlp 응답을 무엇으로 바꾸는지 고정한다(구조 리팩터링 0-B).
//
// 2a 가 URL 지식을 떼어 내고, 2b 가 오류를 코드로 바꾸고, 3 이 스트림 서술자에서 판(lmt)을 읽고, 7 이 파일을 쪼갠다.
// 모듈을 통째로 바꿔 끼우지 않고 youtube-dl-exec 의 exec 하나만 가짜로 둔다. 그래서 src/sources/ytdlpSpawn.js 의 응답 · 오류 모양
// 맞추기까지 진짜로 돈다. 클라이언트 목록(.env)은 시험마다 비워 설정과 무관하게 한 번에 부르게 한다.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-api-"));
const audioCache = require("../../src/store/audioCache");
const trackLookup = require("../../src/store/trackLookup");
audioCache._cacheDir = path.join(TMP, "audio_cache");
audioCache.initialize(path.join(TMP, "cache.db"));

const ytdlExec = require("youtube-dl-exec");
const YouTube = require("../../src/sources/youtube/index");
const { playerClients } = YouTube._internals;

const calls = [];
let respond; // (url, flags) → 응답 객체 · 문자열, 또는 { fail: stderr }

const realExec = ytdlExec.exec;
let savedOrder;

before(() => {
  savedOrder = playerClients.order;
  playerClients.order = [];
  ytdlExec.exec = (url, flags) => {
    calls.push({ url, flags });
    const out = respond(url, flags);
    if (out && out.fail) return Promise.reject(Object.assign(new Error("exit 1"), { stderr: out.fail, exitCode: 1 }));
    return Promise.resolve({ stdout: typeof out === "string" ? out : JSON.stringify(out), stderr: out?.warn ?? "" });
  };
});

after(() => {
  ytdlExec.exec = realExec;
  playerClients.order = savedOrder;
  audioCache.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => {
  calls.length = 0;
  respond = () => ({});
  audioCache.db.exec("DELETE FROM track_lookup; DELETE FROM audio_cache;");
});

const video = (id, extra = {}) => ({ id, title: `영상 ${id}`, uploader: "올린 사람", webpage_url: `https://www.youtube.com/watch?v=${id}`, duration: 200, thumbnail: `https://i.ytimg.com/${id}.jpg`, view_count: 5, upload_date: "20260101", ...extra });

// ── ytdlpSpawn.js ───────────────────────────────────────────────────────

test("yt-dlp 가 실패하면 stderr 를 message 로 담은 오류를 던진다", async () => {
  respond = () => ({ fail: "ERROR: [youtube] abc: Video unavailable" });
  const run = require("../../src/sources/ytdlpSpawn");
  await assert.rejects(run("u", {}), (e) => e.message === "ERROR: [youtube] abc: Video unavailable" && e.exitCode === 1);
});

test("성공해도 stderr 의 경고를 _stderr 로 얹는다(열거되지 않게)", async () => {
  respond = () => ({ ok: 1, warn: "WARNING: something" });
  const out = await require("../../src/sources/ytdlpSpawn")("u", {});
  assert.equal(out._stderr, "WARNING: something");
  assert.deepEqual(Object.keys(out), ["ok", "warn"]);
});

// ── 검색 ──────────────────────────────────────────────────────────────

test("검색: ytsearchN 으로 평평하게 받고, 비디오가 아닌 항목(채널 · 재생목록)을 거른다", async () => {
  respond = () => ({
    entries: [video("aaaaaaaaaaa"), { id: "UCxxxxxxxxxxxxxxxxxxxxxx", url: "https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx", title: "채널" }, video("bbbbbbbbbbb")],
  });

  const tracks = await YouTube.search("노래 제목", 3);

  assert.equal(calls[0].url, "ytsearch3:노래 제목");
  assert.equal(calls[0].flags.dumpSingleJson, true);
  assert.equal(calls[0].flags.flatPlaylist, true);
  assert.deepEqual(
    tracks.map((t) => t.id),
    ["aaaaaaaaaaa", "bbbbbbbbbbb"],
  );
  assert.deepEqual({ title: tracks[0].title, artist: tracks[0].artist, url: tracks[0].audioUrl, duration: tracks[0].duration, platform: tracks[0].platform, type: tracks[0].type, isLive: tracks[0].isLive, liveStatus: tracks[0].liveStatus }, { title: "영상 aaaaaaaaaaa", artist: "올린 사람", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", duration: 200, platform: "youtube", type: "track", isLive: false, liveStatus: null });
});

test("검색: 길이가 0 인 항목은 상세 정보를 한 번 더 받아 길이 · 라이브를 채운다", async () => {
  respond = (url) => (url.startsWith("ytsearch") ? { entries: [video("ccccccccccc", { duration: 0 })] } : video("ccccccccccc", { duration: 0, is_live: true, live_status: "is_live", fulltitle: "방송 원제", title: "방송 원제 2026-09-23 12:00" }));

  const [t] = await YouTube.search("라이브", 1);

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://www.youtube.com/watch?v=ccccccccccc");
  assert.equal(t.isLive, true);
  assert.equal(t.liveStatus, "is_live");
});

test("검색: 유튜브 주소를 주면 검색하지 않고 정보를 받는다", async () => {
  respond = () => video("ddddddddddd");
  const [t] = await YouTube.search("https://youtu.be/ddddddddddd");
  assert.equal(calls[0].url, "https://youtu.be/ddddddddddd");
  assert.equal(calls[0].flags.flatPlaylist, undefined);
  assert.equal(t.id, "ddddddddddd");
});

test("검색: 실패하거나 결과가 없으면 빈 배열", async () => {
  respond = () => ({ fail: "ERROR: network" });
  assert.deepEqual(await YouTube.search("x"), []);
  respond = () => ({});
  assert.deepEqual(await YouTube.search("x"), []);
});

// ── 정보 ──────────────────────────────────────────────────────────────

test("정보: 칸을 옮겨 담고 포맷 목록을 붙인다. 라이브는 조회 시각이 빠진 원제를 쓴다", async () => {
  respond = () => video("eeeeeeeeeee", { formats: [{ format_id: "251" }], live_status: "is_live", fulltitle: "원제", title: "원제 2026-09-23 12:00" });

  const t = await YouTube.getInfo("https://www.youtube.com/watch?v=eeeeeeeeeee");

  assert.equal(calls[0].flags.dumpSingleJson, true);
  assert.equal(calls[0].flags.preferFreeFormats, true);
  assert.equal(t.title, "원제");
  assert.deepEqual(t.formats, [{ format_id: "251" }]);
  assert.equal(t.isLive, true);
  assert.equal(t.liveStatus, "is_live");
});

test("정보: 까닭을 모르는 실패는 null(던지지 않는다)", async () => {
  respond = () => ({ fail: "ERROR: [youtube] fffffffffff: Some other failure" });
  assert.equal(await YouTube.getInfo("https://www.youtube.com/watch?v=fffffffffff"), null);
});

// 회귀 대상: 비공개 · 연령 제한 영상 링크를 넣으면 까닭을 삼켜 "결과를 찾을 수 없습니다"로만 나왔다
test("정보 · 링크 검색: 못 트는 까닭이 분명하면(비공개 · 연령 제한) 던진다. 찾는 쪽이 그 까닭을 알린다", async () => {
  respond = () => ({ fail: "ERROR: [youtube] ppppppppppp: Private video. Sign in if you've been granted access to this video" });
  await assert.rejects(YouTube.getInfo("https://www.youtube.com/watch?v=ppppppppppp"), (e) => e.code === "video-unavailable");
  await assert.rejects(YouTube.search("https://www.youtube.com/watch?v=ppppppppppp", 1), (e) => e.code === "video-unavailable");

  const lookup = require("../../src/sources/lookup");
  const result = await lookup.getTrackData("https://www.youtube.com/watch?v=ppppppppppp", "test");
  assert.equal(result.success, false);
  assert.equal(result.message, "❌ 비공개이거나 삭제된 영상은 재생할 수 없어요.");
});

// ── 스트림 ────────────────────────────────────────────────────────────

test("스트림: 서술자의 모양. googlevideo 주소에 위치 재개면 begin= 을 붙이고 원래 주소는 rawUrl 에", async () => {
  respond = () => ({ ...video("ggggggggggg"), url: "https://rr1.googlevideo.com/videoplayback?x=1", acodec: "opus", abr: 130, format: "251 - audio only", http_headers: { "User-Agent": "UA" }, protocol: "https" });

  const s = await YouTube.getStream("https://www.youtube.com/watch?v=ggggggggggg", 12.5);

  assert.equal(calls[0].flags.format, "bestaudio/best");
  assert.deepEqual(s, {
    url: "https://rr1.googlevideo.com/videoplayback?x=1&begin=12500",
    rawUrl: "https://rr1.googlevideo.com/videoplayback?x=1",
    title: "영상 ggggggggggg",
    type: "opus",
    duration: 200,
    bitrate: 130,
    canSeek: true,
    format: "251 - audio only",
    httpHeaders: { "User-Agent": "UA" },
    isLive: false,
    liveStatus: null,
    protocol: "https",
  });
});

test("스트림: HLS 주소에는 begin= 을 붙이지 않는다(위치는 ffmpeg 가 정한다)", async () => {
  respond = () => ({ ...video("hhhhhhhhhhh"), url: "https://manifest.googlevideo.com/x.m3u8", protocol: "m3u8_native", acodec: "mp4a" });

  const s = await YouTube.getStream("https://www.youtube.com/watch?v=hhhhhhhhhhh", 30);

  assert.equal(s.url, "https://manifest.googlevideo.com/x.m3u8");
  assert.equal(s.canSeek, false);
  assert.equal(s.type, "arbitrary");
  assert.deepEqual(s.httpHeaders, {}, "헤더가 없으면 빈 객체");
});

test("스트림: 주소가 없거나 yt-dlp 가 실패하면 던진다", async () => {
  respond = () => video("iiiiiiiiiii");
  await assert.rejects(YouTube.getStream("https://www.youtube.com/watch?v=iiiiiiiiiii"), /스트림 URL을 찾을 수 없음/);
  await assert.rejects(YouTube.getStream(""), /URL이 필요함/);
  respond = () => ({ fail: "ERROR: [youtube] iiiiiiiiiii: Video unavailable" });
  await assert.rejects(YouTube.getStream("https://www.youtube.com/watch?v=iiiiiiiiiii"), /Video unavailable/);
});

// ── 재생목록 ──────────────────────────────────────────────────────────

test("재생목록: 필요한 구간만 받고, 영상 자체에서 확인해 둔 제목이 있으면 그것을 쓴다", async () => {
  audioCache.recordDownloadStart("yt:jjjjjjjjjjj", { title: "t" });
  trackLookup.recordTrackLookup({ requestKey: "https://www.youtube.com/watch?v=jjjjjjjjjjj", pageUrl: "https://www.youtube.com/watch?v=jjjjjjjjjjj", audioUrl: "https://www.youtube.com/watch?v=jjjjjjjjjjj", platform: "youtube", title: "확인된 제목", artist: "가수" }, { verified: true });
  respond = () => ({ title: "목록", playlist_count: 57, entries: [video("jjjjjjjjjjj", { title: "재생목록이 준 낡은 제목" }), { id: "kkkkkkkkkkk", title: "주소만" }, null] });

  const list = await YouTube.getPlaylist("https://www.youtube.com/playlist?list=PL1", { offset: 20, limit: 10 });

  assert.equal(calls[0].flags.playlistItems, "21:30");
  assert.equal(calls[0].flags.flatPlaylist, true);
  assert.deepEqual(
    list.tracks.map((t) => [t.title, t.pageUrl]),
    [
      ["확인된 제목", "https://www.youtube.com/watch?v=jjjjjjjjjjj"],
      ["주소만", "https://www.youtube.com/watch?v=kkkkkkkkkkk"],
    ],
  );
  assert.deepEqual({ title: list.title, total: list.total, nextOffset: list.nextOffset, platform: list.platform, type: list.type }, { title: "목록", total: 57, nextOffset: 23, platform: "youtube", type: "playlist" });
});

test("재생목록: 끝이 없는 믹스는 total 이 null", async () => {
  respond = () => ({ title: "믹스", entries: [video("lllllllllll")] });
  const list = await YouTube.getPlaylist("https://www.youtube.com/watch?v=lllllllllll&list=RDlllllllllll");
  assert.equal(list.total, null);
});

test("재생목록: 항목이 없거나 실패하면 null", async () => {
  respond = () => ({ title: "빈 목록", entries: [] });
  assert.equal(await YouTube.getPlaylist("https://www.youtube.com/playlist?list=PL2"), null);
  respond = () => ({ fail: "ERROR: private playlist" });
  assert.equal(await YouTube.getPlaylist("https://www.youtube.com/playlist?list=PL3"), null);
});

// ── 다시 받기 ─────────────────────────────────────────────────────────

test("미디어 주소가 어긋나면(403) 잠깐 뒤 한 번 더 받는다", async () => {
  let n = 0;
  respond = () => (++n === 1 ? { fail: "ERROR: unable to download video data: HTTP Error 403: Forbidden" } : { ...video("mmmmmmmmmmm"), url: "https://rr1.googlevideo.com/v" });

  const s = await YouTube.getStream("https://www.youtube.com/watch?v=mmmmmmmmmmm");

  assert.equal(calls.length, 2);
  assert.equal(s.url, "https://rr1.googlevideo.com/v");
});

test("영상이 없는 것은 다시 받지 않는다", async () => {
  respond = () => ({ fail: "ERROR: [youtube] nnnnnnnnnnn: Video unavailable" });
  await assert.rejects(YouTube.getStream("https://www.youtube.com/watch?v=nnnnnnnnnnn"));
  assert.equal(calls.length, 1);
});
