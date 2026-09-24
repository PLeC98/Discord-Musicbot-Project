// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// TrackDownloader 가 캐시에 곡을 받는 흐름의 지금 동작을 고정한다(구조 리팩터링 0-B).
//
// 3단계가 받을 때 `audio_version` 을 채우고 열쇠 모양을 바꾸고, 5단계가 CacheManager 를 쪼갠다. 그 전에 갈래마다
// "무엇으로 받았나 · 장부에 무엇을 적었나 · 트랙에 무엇을 고쳤나"를 적어 둔다. 진짜 저장소를 임시 DB 로 쓰고
// yt-dlp · 직접 링크 · 변환 · SponsorBlock · 동등물 찾기만 가짜로 넘긴다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as storeDb from "../../src/store/db.ts";
import { md5 } from "../../src/rules/audioKeyOf.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cache-download-"));
const audioCache = await import("../../src/store/audioCache.ts");
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
audioCache.initialize(path.join(TMP, "cache.db"));

const YouTube = await import("../../src/sources/youtube/index.ts");
const audioConvert = await import("../../src/media/convert.ts");
const { TrackDownloader } = await import("../../src/media/cacheDownload.ts");

// 무엇이 불렸는지 모은다
const calls = { ytdlp: [], direct: [], convert: [], sponsor: [], equivalent: [], reresolve: [] };
// 시험마다 바꾸는 yt-dlp 의 행동. 기본은 "출력 경로에 파일과 info.json 을 쓴다"
let ytdlpBehavior;

// 다운로더에 넘기는 가짜 소스와 변환. 무엇을 불렀는지 calls 에 모은다
const deps = {
  youtube: {
    ...YouTube,
    getYtDlpOptions: (options) => options, // 넘기는 선택지를 그대로 본다
    runYtDlp: async (url, build) => {
      const options = build(false);
      calls.ytdlp.push({ url, options });
      return ytdlpBehavior(url, options);
    },
  },
  direct: {
    getStream: async (url) => {
      calls.direct.push(url);
      return Object.assign(Readable.from([Buffer.from("raw-audio")]), { headers: { etag: '"v1"', "content-length": "9" } });
    },
  },
  convert: {
    ...audioConvert,
    toCacheOpus: async (src, out) => {
      calls.convert.push({ src, out, srcExists: fs.existsSync(src) });
      fs.writeFileSync(out, "opus");
      return { durationSec: 222 };
    },
  },
  sponsor: {
    forTrack: async (track, guildId) => {
      calls.sponsor.push({ title: track.title, guildId });
    },
  },
  equivalent: {
    findYouTubeEquivalent: async (track) => {
      calls.equivalent.push(track.title);
      if (track._equivalent) track.audioUrl = track._equivalent;
      return track._equivalent ?? null;
    },
    reresolveYouTube: async (track) => {
      calls.reresolve.push(track.title);
      track.audioUrl = "https://www.youtube.com/watch?v=freshfresh01";
      track.audioFoundBy = "search";
      return track.audioUrl;
    },
  },
};

after(() => {
  audioCache.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

// yt-dlp 가 정상으로 받았을 때 남기는 것: 출력 파일과 곁들인 info.json
const writesFile =
  ({ title = "영상 자체 제목", duration = 201 } = {}) =>
  (_url, options) => {
    fs.writeFileSync(options.output, "opus-bytes");
    fs.writeFileSync(`${options.output}.info.json`, JSON.stringify({ title, duration, extractor_key: "Youtube", url: "https://rr1.googlevideo.com/videoplayback?itag=251&lmt=1700000000000000" }));
  };

beforeEach(() => {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  ytdlpBehavior = writesFile();
  storeDb.get().exec("DELETE FROM track_lookup; DELETE FROM audio_cache;");
  fs.rmSync(audioCache.cacheDir(), { recursive: true, force: true, maxRetries: 5 });
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
});

const downloader = () => new TrackDownloader({ guild: { id: "g1" } }, deps);
const audioRow = (key) => storeDb.get().prepare("SELECT * FROM audio_cache WHERE audio_key = ?").get(key) || null;
const lookupRow = (requestKey) => storeDb.get().prepare("SELECT * FROM track_lookup WHERE request_key = ?").get(requestKey) || null;
const leftovers = () => fs.readdirSync(audioCache.cacheDir()).filter((n) => n.includes(".tmp-") || n.endsWith(".raw") || n.endsWith(".info.json"));

const yt = (await import("../helpers/tracks.js")).default.youtube;

// ── yt-dlp 갈래 ────────────────────────────────────────────────────────

test("유튜브: yt-dlp 로 임시 파일에 받아 최종 경로로 올리고 장부에 적는다", async () => {
  const track = yt("aaaaaaaaaaa");

  const file = await downloader().downloadTrack(track);

  assert.equal(file, audioCache.getFilePath("yt:aaaaaaaaaaa"));
  assert.equal(fs.readFileSync(file, "utf8"), "opus-bytes");
  assert.equal(calls.ytdlp.length, 1);
  const { url, options } = calls.ytdlp[0];
  assert.equal(url, track.audioUrl);
  assert.match(path.basename(options.output), /\.tmp-\d+-[0-9a-f]{8}\.opus$/, "임시 경로에 받는다");
  assert.deepEqual({ format: options.format, matchFilter: options.matchFilter, extractAudio: options.extractAudio, audioFormat: options.audioFormat, writeInfoJson: options.writeInfoJson, preferFreeFormats: options.preferFreeFormats }, { format: "bestaudio/best", matchFilter: "!is_live", extractAudio: true, audioFormat: "opus", writeInfoJson: true, preferFreeFormats: true });
  assert.deepEqual(options.postprocessorArgs, audioConvert.ytdlpPostprocessorArgs());
  assert.deepEqual(calls.sponsor, [{ title: "곡 aaaaaaaaaaa", guildId: "g1" }], "받기 전에 SponsorBlock 을 확보한다(제목을 고치기 전)");

  const row = audioRow("yt:aaaaaaaaaaa");
  assert.equal(row.status, "cached");
  assert.equal(row.duration_sec, 201, "오디오 길이는 info.json 의 값");
  assert.equal(row.audio_version, "lmt:1700000000000000", "받은 포맷의 판을 적는다");
  assert.ok(row.version_checked_at > 0);
  const lookup = lookupRow(track.requestKey);
  assert.equal(lookup.audio_url, "https://www.youtube.com/watch?v=aaaaaaaaaaa");
  assert.equal(lookup.title_verified, 1, "유튜브는 영상 자체 제목으로 확인됨");
  assert.equal(track.title, "영상 자체 제목", "유튜브 곡은 제목을 영상 자체 제목으로 고친다");
  assert.deepEqual(leftovers(), [], "info.json 과 임시 파일을 남기지 않는다");
});

test("스포티파이: 동등물을 찾아 그 영상으로 받고 제목은 고치지 않는다", async () => {
  const track = { title: "스포티파이 곡", artist: "가수", pageUrl: "https://open.spotify.com/track/sp1", requestKey: "https://open.spotify.com/track/sp1", platform: "spotify", duration: 200, _equivalent: "https://www.youtube.com/watch?v=bbbbbbbbbbb" };

  await downloader().downloadTrack(track);

  assert.deepEqual(calls.equivalent, ["스포티파이 곡"]);
  assert.equal(calls.ytdlp[0].url, "https://www.youtube.com/watch?v=bbbbbbbbbbb");
  assert.equal(track.title, "스포티파이 곡");
  assert.equal(lookupRow(track.requestKey).title_verified, 0);
  assert.equal(audioRow("yt:bbbbbbbbbbb").status, "cached", "찾은 영상의 열쇠 자리에 받는다");
});

test("스포티파이: 동등물을 못 찾으면 받기 전에 실패한다. 아무것도 적거나 남기지 않는다", async () => {
  const track = { title: "못 찾는 곡", pageUrl: "https://open.spotify.com/track/sp2", requestKey: "https://open.spotify.com/track/sp2", platform: "spotify" };

  await assert.rejects(downloader().downloadTrack(track), /Could not find YouTube equivalent/);

  assert.equal(calls.ytdlp.length, 0);
  assert.equal(storeDb.get().prepare("SELECT COUNT(*) AS n FROM audio_cache").get().n, 0);
  assert.deepEqual(leftovers(), []);
});

test("사운드클라우드: 제 주소로 받는다(유튜브에서 찾지 않는다)", async () => {
  const track = { title: "SC", requestKey: "https://soundcloud.com/a/b", audioUrl: "https://soundcloud.com/a/b", platform: "soundcloud" };

  await downloader().downloadTrack(track);

  assert.equal(calls.ytdlp[0].url, "https://soundcloud.com/a/b");
  assert.equal(track.title, "SC", "유튜브가 아니면 제목을 안 고친다");
});

test("자동재생 출처 곡: 찾아 둔 영상(음원 주소)으로 받는다. 다시 찾지 않는다", async () => {
  const track = { title: "출처 곡", requestKey: "https://www.last.fm/music/a/_/b", platform: "lastfm", audioUrl: "https://www.youtube.com/watch?v=eeeeeeeeeee" };

  await downloader().downloadTrack(track);

  assert.equal(calls.ytdlp[0].url, "https://www.youtube.com/watch?v=eeeeeeeeeee");
  assert.deepEqual(calls.equivalent, []);
  assert.equal(lookupRow(track.requestKey).platform, "lastfm");
});

// 회귀 대상: 애니 소스 곡은 장부에 작품 페이지를 열쇠로 적어 같은 작품의 OP 와 ED 가 한 줄을 두고 서로 덮었다
test("자동재생 곡은 장부에 요청 열쇠(소스 안의 곡)로 적힌다. 같은 작품의 두 곡이 따로 산다", async () => {
  const page = "https://anilist.co/anime/150672";
  const song = (id, vid) => ({ title: `곡 ${id}`, pageUrl: page, requestKey: `amq:${id}`, platform: "anisongdb", audioUrl: `https://www.youtube.com/watch?v=${vid}` });

  await downloader().downloadTrack(song(1, "fatalfatal1"));
  await downloader().downloadTrack(song(2, "burningburn"));

  assert.equal(lookupRow("amq:1").audio_url, "https://www.youtube.com/watch?v=fatalfatal1");
  assert.equal(lookupRow("amq:2").audio_url, "https://www.youtube.com/watch?v=burningburn");
  assert.equal(lookupRow("amq:1").page_url, page, "작품 페이지는 보여 줄 링크로만 남는다");
  assert.equal(lookupRow(page), null, "작품 페이지는 열쇠가 아니다");
});

test("라이브는 받지 않는다(끝이 없다). 장부는 오류로", async () => {
  const track = yt("fffffffffff", { isLive: true });

  await assert.rejects(downloader().downloadTrack(track), /라이브 스트림은 캐시 다운로드 대상이 아님/);

  assert.equal(calls.ytdlp.length, 0);
  assert.equal(audioRow("yt:fffffffffff").status, "error");
});

test("yt-dlp 가 건너뛰면(파일 없음) 이유를 알 수 있는 오류로 바꾼다", async () => {
  ytdlpBehavior = () => {};

  await assert.rejects(downloader().downloadTrack(yt("ggggggggggg")), /yt-dlp가 대상을 건너뜀/);
  assert.equal(audioRow("yt:ggggggggggg").status, "error");
});

test("빈 파일은 버린다", async () => {
  ytdlpBehavior = (_url, options) => fs.writeFileSync(options.output, "");

  await assert.rejects(downloader().downloadTrack(yt("hhhhhhhhhhh")), /Downloaded file is empty/);
  assert.equal(fs.existsSync(audioCache.getFilePath("yt:hhhhhhhhhhh")), false);
  assert.deepEqual(leftovers(), []);
});

test("info.json 이 없으면 제목 · 길이를 모르는 채로 받는다", async () => {
  ytdlpBehavior = (_url, options) => fs.writeFileSync(options.output, "opus-bytes");
  const track = yt("iiiiiiiiiii");

  await downloader().downloadTrack(track);

  assert.equal(track.title, "곡 iiiiiiiiiii");
  assert.equal(audioRow("yt:iiiiiiiiiii").duration_sec, 180, "오디오 길이를 모르면 장부는 트랙이 가진 길이로 채운다");
  assert.equal(lookupRow(track.requestKey).title_verified, 0);
});

// ── 직접 링크 갈래 ─────────────────────────────────────────────────────

test("직접 링크: SafeUrl 을 거쳐 원본을 받고, 변환하고, 실측 길이로 트랙을 고친다", async () => {
  const track = { title: "파일", pageUrl: "https://files.test/a.flac", requestKey: "https://files.test/a.flac", audioUrl: "https://files.test/a.flac", platform: "direct", duration: 100 };

  const file = await downloader().downloadTrack(track);

  assert.deepEqual(calls.direct, ["https://files.test/a.flac"]);
  assert.equal(calls.ytdlp.length, 0);
  assert.equal(calls.convert.length, 1);
  assert.ok(calls.convert[0].src.endsWith(".raw"), "원본을 먼저 파일로 받는다");
  assert.equal(calls.convert[0].srcExists, true);
  assert.equal(track.duration, 222);
  assert.equal(track.durationSource, "실측");
  assert.equal(audioRow(`dl:${md5("https://files.test/a.flac")}`).audio_version, 'etag="v1";length=9', "응답 헤더에서 판을 읽는다");
  assert.equal(audioRow(`dl:${md5("https://files.test/a.flac")}`).duration_sec, 222);
  assert.equal(fs.readFileSync(file, "utf8"), "opus");
  assert.deepEqual(leftovers(), [], ".raw 를 남기지 않는다");
});

// ── 이미 있거나 받는 중이거나 ──────────────────────────────────────────

test("최종 파일이 이미 있으면 아무것도 안 받는다", async () => {
  const track = yt("jjjjjjjjjjj");
  fs.writeFileSync(audioCache.getFilePath("yt:jjjjjjjjjjj"), "old");

  const file = await downloader().downloadTrack(track);

  assert.equal(fs.readFileSync(file, "utf8"), "old");
  assert.equal(calls.ytdlp.length, 0);
  assert.equal(audioRow("yt:jjjjjjjjjjj"), null, "장부도 안 건드린다");
});

test("같은 곡을 동시에 두 번 부르면 한 번만 받는다", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  ytdlpBehavior = async (url, options) => {
    await gate;
    writesFile()(url, options);
  };
  const d = downloader();

  const a = d.downloadTrack(yt("kkkkkkkkkkk"));
  const b = d.downloadTrack(yt("kkkkkkkkkkk"));
  assert.equal(TrackDownloader.isDownloading(audioCache.getFilePath("yt:kkkkkkkkkkk")), true);
  release();
  const [fa, fb] = await Promise.all([a, b]);

  assert.equal(fa, fb);
  assert.equal(calls.ytdlp.length, 1);
  assert.equal(TrackDownloader.isDownloading(fa), false, "끝나면 받는 중 목록에서 뺀다");
});

test("받는 사이 다른 쪽이 먼저 올렸으면 내 것을 버리고 그것을 쓴다", async () => {
  ytdlpBehavior = (url, options) => {
    fs.writeFileSync(audioCache.getFilePath("yt:lllllllllll"), "theirs");
    writesFile()(url, options);
  };

  const file = await downloader().downloadTrack(yt("lllllllllll"));

  assert.equal(fs.readFileSync(file, "utf8"), "theirs");
  assert.deepEqual(leftovers(), []);
});

test("받는 동안 임시 파일을 퇴거 · 기동 청소에서 보호하고, 끝나면 푼다", async () => {
  let during;
  ytdlpBehavior = (url, options) => {
    during = audioCache._protectedFiles.has(path.resolve(options.output));
    writesFile()(url, options);
  };

  await downloader().downloadTrack(yt("mmmmmmmmmmm"));

  assert.equal(during, true);
  assert.equal(audioCache._protectedFiles.size, 0);
});

// ── 장부에서 온 영상이 죽었을 때 ────────────────────────────────────────

test("장부에서 가져온 영상이 내려갔으면 다시 찾아 한 번 더 받는다", async () => {
  ytdlpBehavior = (url, options) => {
    if (url.includes("deaddeaddea")) throw new Error("ERROR: [youtube] deaddeaddea: Video unavailable");
    writesFile()(url, options);
  };
  const track = { title: "스포티파이 곡", pageUrl: "https://open.spotify.com/track/sp3", requestKey: "https://open.spotify.com/track/sp3", platform: "spotify", audioUrl: "https://www.youtube.com/watch?v=deaddeaddea", audioFoundBy: "ledger" };

  const file = await downloader().downloadTrack(track);

  assert.deepEqual(calls.reresolve, ["스포티파이 곡"]);
  assert.equal(file, audioCache.getFilePath("yt:freshfresh01"), "새 영상의 열쇠 자리로 받는다");
  assert.equal(audioRow("yt:deaddeaddea").status, "error");
  assert.equal(audioRow("yt:freshfresh01").status, "cached");
});

test("새로 검색한 영상(장부에서 온 것이 아님)이 내려갔으면 다시 찾지 않는다", async () => {
  ytdlpBehavior = () => {
    throw new Error("ERROR: Video unavailable");
  };
  const track = { title: "곡", requestKey: "https://open.spotify.com/track/sp4", platform: "spotify", audioUrl: "https://www.youtube.com/watch?v=nnnnnnnnnnn", audioFoundBy: "search" };

  await assert.rejects(downloader().downloadTrack(track), /Video unavailable/);
  assert.deepEqual(calls.reresolve, []);
});

// ── 예열 ──────────────────────────────────────────────────────────────

test("예열: 열쇠를 못 정한 스포티파이 곡은 받기 전에 동등물부터 찾는다", async () => {
  const track = { title: "예열 곡", requestKey: "https://open.spotify.com/track/sp5", platform: "spotify", _equivalent: "https://www.youtube.com/watch?v=ooooooooooo" };

  await downloader().warm(track);

  assert.deepEqual(calls.equivalent, ["예열 곡"], "받기 전에 한 번. 음원 주소가 생긴 뒤에는 다시 안 찾는다");
  assert.ok(fs.existsSync(audioCache.getFilePath("yt:ooooooooooo")), "열쇠 자리에 받는다(URL 해시 자리가 아니라)");
});

// ── 받아 둔 파일 찾기 ─────────────────────────────────────────────────

test("findCacheFile: 열쇠 자리에 다 받아 둔 파일만. 없거나 비었거나 받는 중이면 null", () => {
  const track = yt("findfindfin");
  const file = audioCache.getFilePath("yt:findfindfin");

  assert.equal(TrackDownloader.findCacheFile(track), null, "없다");
  fs.writeFileSync(file, "");
  assert.equal(TrackDownloader.findCacheFile(track), null, "비었다");
  fs.writeFileSync(file, "opus");
  assert.equal(TrackDownloader.findCacheFile(track), file);

  TrackDownloader._internals.inFlight.set(file, new Promise(() => {}));
  try {
    assert.equal(TrackDownloader.findCacheFile(track), null, "받는 중");
  } finally {
    TrackDownloader._internals.inFlight.delete(file);
  }

  assert.equal(TrackDownloader.findCacheFile({ title: "스포티파이", requestKey: "https://open.spotify.com/track/x" }), null, "음원 주소가 없으면 열쇠도 없다");
  assert.equal(TrackDownloader.findCacheFile(null), null);
});
