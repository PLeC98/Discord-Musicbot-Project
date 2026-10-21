// TrackDownloader 가 캐시에 곡을 다운로드하는 흐름의 지금 동작을 고정한다.
//
// 분기마다 "무엇으로 다운로드했나 · 캐시 DB 에 무엇을 적었나 · 트랙에 무엇을 고쳤나"를 적어 둔다. 진짜 저장소를 임시 DB 로 쓰고
// yt-dlp · 직접 링크 · 변환 · SponsorBlock · 동등물 찾기만 가짜로 넘긴다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { cacheDb } from "../../src/store/cache-db.ts";
import * as stores from "../../src/store/stores.ts";
import { md5 } from "../../src/rules/audio-key-of.ts";
import { codedError } from "../../src/rules/error-kind.ts";
import * as audioCache from "../../src/store/audio-cache.ts";
import * as YouTube from "../../src/sources/youtube/index.ts";
import * as audioConvert from "../../src/media/convert.ts";
import { TrackDownloader, type DownloadTrack, type Sources } from "../../src/media/cache-download.ts";
import type { YtDlpFlags } from "../../src/sources/ytdlp-spawn.ts";
import type { AudioRow } from "../../src/store/audio-cache.ts";
import type { LookupRow } from "../../src/store/rows.ts";
import type { TagInfo } from "../../src/rules/track-tags.ts";
import type { CacheTags } from "../../src/media/convert.ts";
import sharp from "sharp";
import * as tracks from "../helpers/tracks.ts";
import sink from "../../src/infra/log/sink.ts";
import logger from "../../src/infra/log/logger.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cache-download-"));
audioCache._setCacheDir(path.join(TMP, "audio_cache"));
stores.open(TMP);
audioCache.initialize();

// 테스트가 트랙에 달아 두는 것: 동등물을 찾으면 줄 영상
type TestTrack = DownloadTrack & { _equivalent?: string };
// 다운로드는 언제나 출력 경로를 준다
type Options = YtDlpFlags & { output: string };

// 무엇이 불렸는지 모은다
let fileTags: (TagInfo & { picture?: { data: Uint8Array } | null }) | null = null;
const calls = {
  ytdlp: [] as Array<{ url: string; options: Options }>,
  direct: [] as string[],
  convert: [] as Array<{ src: string; out: string; srcExists: boolean; cache?: CacheTags }>,
  sponsor: [] as Array<{ title: string | null; guildId: string }>,
  equivalent: [] as Array<string | null>,
  reresolve: [] as Array<string | null>,
};
// 테스트마다 바꾸는 yt-dlp 의 행동. 기본은 "출력 경로에 파일과 info.json 을 쓴다"
let ytdlpBehavior: (url: string, options: Options) => unknown;
// 만든 .opus 를 잰 길이. 기본은 잴 수 없음(null)
let measuredSec: number | null = null;
const measured: string[] = [];

// 다운로더에 넘기는 가짜 소스와 변환. 무엇을 불렀는지 calls 에 모은다
const deps: Sources = {
  youtube: {
    ...YouTube,
    getYtDlpOptions: (options = {}) => options, // 넘기는 옵션을 그대로 본다
    downloadAudio: async (url, build) => {
      const flags = build(false);
      assert.ok(flags.output, "출력 경로가 없다");
      const options = { ...flags, output: flags.output };
      calls.ytdlp.push({ url, options });
      return ytdlpBehavior(url, options);
    },
  },
  // 사운드클라우드는 유튜브 실행기(클라이언트 바꾸기 · 쿠키)를 거치지 않는다. 어느 길로 갔는지 via 에 적는다
  soundcloud: {
    download: async (url, flags) => {
      assert.ok(flags.output, "출력 경로가 없다");
      const options = { ...flags, output: String(flags.output), via: "soundcloud" };
      calls.ytdlp.push({ url, options });
      return ytdlpBehavior(url, options);
    },
  },
  direct: {
    getStream: async (url: string) => {
      calls.direct.push(url);
      return Object.assign(Readable.from([Buffer.from("raw-audio")]), { headers: { etag: '"v1"', "content-length": "9" }, live: false, bounded: true });
    },
  },
  convert: {
    ...audioConvert,
    toCacheOpus: async (src: string, out: string, cache?: CacheTags) => {
      calls.convert.push({ src, out, srcExists: fs.existsSync(src), cache });
      fs.writeFileSync(out, "opus");
      return { durationSec: 222 };
    },
  },
  // 받은 원본의 태그. 테스트마다 정한다(기본은 읽지 못함)
  tags: { fromFile: async () => fileTags },
  measure: {
    durationSec: async (file: string) => {
      measured.push(file);
      return measuredSec;
    },
  },
  sponsor: {
    forTrack: async (track: DownloadTrack, guildId: string) => {
      calls.sponsor.push({ title: track.title, guildId });
    },
  },
  equivalent: {
    findYouTubeEquivalent: async (track: TestTrack) => {
      calls.equivalent.push(track.title);
      if (track._equivalent) track.audioUrl = track._equivalent;
      return track._equivalent ?? null;
    },
    reresolveYouTube: async (track: DownloadTrack) => {
      calls.reresolve.push(track.title);
      track.audioUrl = "https://www.youtube.com/watch?v=freshfresh01";
      track.audioFoundBy = "search";
      return track.audioUrl;
    },
  },
};

after(() => {
  audioCache.close();
  stores.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

// yt-dlp 가 정상으로 다운로드했을 때 남기는 것: 출력 파일과 곁들인 info.json
const writesFile =
  ({ title = "영상 자체 제목", duration = 201 } = {}) =>
  (_url: string, options: Options) => {
    fs.writeFileSync(options.output, "opus-bytes");
    fs.writeFileSync(`${options.output}.info.json`, JSON.stringify({ title, duration, extractor_key: "Youtube", url: "https://rr1.googlevideo.com/videoplayback?itag=251&lmt=1700000000000000" }));
  };

beforeEach(() => {
  for (const list of Object.values(calls)) list.length = 0;
  ytdlpBehavior = writesFile();
  measuredSec = null;
  measured.length = 0;
  cacheDb.get().exec("DELETE FROM track_lookup; DELETE FROM audio_cache;");
  fs.rmSync(audioCache.cacheDir(), { recursive: true, force: true, maxRetries: 5 });
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
});

const downloader = () => new TrackDownloader({ guild: { id: "g1" } }, deps);
const audioRow = (key: string) => cacheDb.get().prepare<[string], AudioRow>("SELECT * FROM audio_cache WHERE audio_key = ?").get(key) || null;
const lookupRow = (requestKey: string) => cacheDb.get().prepare<[string], LookupRow>("SELECT * FROM track_lookup WHERE request_key = ?").get(requestKey) || null;
const leftovers = () => fs.readdirSync(audioCache.cacheDir()).filter((n) => n.includes(".tmp-") || n.endsWith(".raw") || n.endsWith(".info.json"));

const yt = tracks.youtube;

// ── yt-dlp 분기 ────────────────────────────────────────────────────────

test("유튜브: yt-dlp 로 임시 파일에 다운로드해 최종 경로로 올리고 캐시 DB 에 적는다", async () => {
  const track = yt("aaaaaaaaaaa");

  const file = await downloader().downloadTrack(track);

  assert.equal(file, audioCache.getFilePath("yt:aaaaaaaaaaa"));
  assert.equal(fs.readFileSync(file, "utf8"), "opus-bytes");
  assert.equal(calls.ytdlp.length, 1);
  const { url, options } = calls.ytdlp[0];
  assert.equal(url, track.audioUrl);
  assert.match(path.basename(options.output), /\.tmp-\d+-[0-9a-f]{8}\.opus$/, "임시 경로에 다운로드한다");
  assert.deepEqual({ format: options.format, matchFilter: options.matchFilter, extractAudio: options.extractAudio, audioFormat: options.audioFormat, writeInfoJson: options.writeInfoJson, preferFreeFormats: options.preferFreeFormats }, { format: "bestaudio/best", matchFilter: "!is_live", extractAudio: true, audioFormat: "opus", writeInfoJson: true, preferFreeFormats: true });
  assert.deepEqual(options.postprocessorArgs, audioConvert.ytdlpPostprocessorArgs());
  assert.equal(options.concurrentFragments, 2, "유튜브 조각은 둘씩(넷부터 401)");
  assert.deepEqual(calls.sponsor, [{ title: "곡 aaaaaaaaaaa", guildId: "g1" }], "다운로드 전에 SponsorBlock 을 확보한다(제목을 고치기 전)");

  const row = audioRow("yt:aaaaaaaaaaa");
  assert.ok(row, "캐시 파일 기록에 적었다");
  assert.equal(row.status, "cached");
  assert.equal(row.duration_sec, 201, "만든 파일을 잴 수 없으면 info.json 의 값");
  assert.equal(row.audio_version, "lmt:1700000000000000", "다운로드한 포맷의 버전을 적는다");
  assert.ok(Number(row.version_checked_at) > 0);
  const lookup = lookupRow(track.requestKey);
  assert.ok(lookup, "요청을 적었다");
  assert.equal(lookup.audio_url, "https://www.youtube.com/watch?v=aaaaaaaaaaa");
  assert.equal(lookup.title_verified, 1, "유튜브는 영상 자체 제목으로 확인됨");
  assert.equal(track.title, "영상 자체 제목", "유튜브 곡은 제목을 영상 자체 제목으로 고친다");
  assert.deepEqual(leftovers(), [], "info.json 과 임시 파일을 남기지 않는다");
});

test("직접 지정한 음원으로 받는 유튜브 곡은 제목을 고치지 않는다", async () => {
  const track = { ...yt("ppppppppppp"), title: "요청의 제목", audioFoundBy: "pinned" as const };

  await downloader().downloadTrack(track);

  assert.equal(track.title, "요청의 제목");
});

test("스포티파이: 동등물을 찾아 그 영상으로 다운로드하고 제목은 고치지 않는다", async () => {
  const track = { title: "스포티파이 곡", artist: "가수", pageUrl: "https://open.spotify.com/track/sp1", requestKey: "https://open.spotify.com/track/sp1", platform: "spotify", duration: 200, _equivalent: "https://www.youtube.com/watch?v=bbbbbbbbbbb" };

  await downloader().downloadTrack(track);

  assert.deepEqual(calls.equivalent, ["스포티파이 곡"]);
  assert.equal(calls.ytdlp[0].url, "https://www.youtube.com/watch?v=bbbbbbbbbbb");
  assert.equal(track.title, "스포티파이 곡");
  assert.equal(lookupRow(track.requestKey)?.title_verified, 0);
  assert.equal(audioRow("yt:bbbbbbbbbbb")?.status, "cached", "찾은 영상의 키 경로에 다운로드한다");
});

test("스포티파이: 동등물을 못 찾으면 다운로드 전에 실패한다. 아무것도 적거나 남기지 않는다", async () => {
  const track = { title: "못 찾는 곡", pageUrl: "https://open.spotify.com/track/sp2", requestKey: "https://open.spotify.com/track/sp2", platform: "spotify" };

  const from = sink.buffer.length;
  await assert.rejects(downloader().downloadTrack(track), { code: "sp-no-youtube-match" });
  // 다운로드 전 실패도 다운로드가 한 번 남긴다(부르는 쪽은 debug 로 결과만)
  const failed = sink.buffer.slice(from).filter((e) => e.text.includes("캐시 다운로드 실패"));
  assert.deepEqual(
    failed.map((e) => e.level),
    ["error"],
  );

  assert.equal(calls.ytdlp.length, 0);
  assert.equal(cacheDb.get().prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM audio_cache").get()?.n, 0);
  assert.deepEqual(leftovers(), []);
});

// 긴 곡의 캐시가 어디서 오래 걸렸는지 구분할 근거. 완료 줄(debug)에 걸린 시간 · 다운로드한 포맷 · 옮겼나 구웠나를 싣는다
test("다운로드가 끝나면 걸린 시간과 다운로드한 포맷을 한 줄에 남긴다. yt-dlp 가 파일을 다 쓰고 한참 뒤에 끝났으면 그것도", async () => {
  ytdlpBehavior = (url, options) => {
    writesFile()(url, options);
    const info = `${options.output}.info.json`;
    fs.writeFileSync(info, JSON.stringify({ ...JSON.parse(fs.readFileSync(info, "utf8")), format_id: "140", protocol: "http_dash_segments", acodec: "mp4a.40.2" }));
    // 파일을 다 쓴 때를 10초 전으로
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(options.output, past, past);
  };
  const level = logger.level;
  logger.level = "debug";
  const from = sink.buffer.length;
  try {
    await downloader().downloadTrack(yt("ttttttttttt"));
  } finally {
    logger.level = level;
  }
  const line = sink.buffer.slice(from).find((e) => e.text.startsWith("캐시 다운로드 완료"))?.text ?? "";
  assert.match(line, /\| yt-dlp \d+\.\d초 · 포맷 140\(http_dash_segments, mp4a → opus 구움\) · 파일을 다 쓰고 1\d\.\d초 뒤에 끝남 · 길이 재기 \d+\.\d초$/, line);
});

test("사운드클라우드: 제 주소로, 사운드클라우드 출처가 다운로드한다(유튜브에서 찾지 않고 유튜브 옵션도 안 쓴다)", async () => {
  const track = { title: "SC", requestKey: "https://soundcloud.com/a/b", audioUrl: "https://soundcloud.com/a/b", platform: "soundcloud" };

  await downloader().downloadTrack(track);

  assert.equal(calls.ytdlp[0].url, "https://soundcloud.com/a/b");
  assert.equal((calls.ytdlp[0].options as { via?: string }).via, "soundcloud");
  assert.equal(calls.ytdlp[0].options.writeInfoJson, true, "다운로드 옵션은 유튜브와 같다");
  assert.equal(calls.ytdlp[0].options.concurrentFragments, 4, "사운드클라우드 조각은 넷씩");
  assert.equal(track.title, "SC", "유튜브가 아니면 제목을 안 고친다");
});

test("자동재생 출처 곡: 찾아 둔 영상(음원 주소)으로 다운로드한다. 다시 찾지 않는다", async () => {
  const track = { title: "출처 곡", requestKey: "https://www.last.fm/music/a/_/b", platform: "lastfm", audioUrl: "https://www.youtube.com/watch?v=eeeeeeeeeee" };

  await downloader().downloadTrack(track);

  assert.equal(calls.ytdlp[0].url, "https://www.youtube.com/watch?v=eeeeeeeeeee");
  assert.deepEqual(calls.equivalent, []);
  assert.equal(lookupRow(track.requestKey)?.platform, "lastfm");
});

// 회귀 대상: 애니 소스 곡은 링크 데이터에 작품 페이지를 키로 적어 같은 작품의 OP 와 ED 가 한 행을 두고 서로 덮었다
test("자동재생 곡은 링크 데이터에 요청 키(소스 안의 곡)로 적힌다. 같은 작품의 두 곡이 따로 산다", async () => {
  const page = "https://anilist.co/anime/150672";
  const song = (id: number, vid: string) => ({ title: `곡 ${id}`, pageUrl: page, requestKey: `amq:${id}`, platform: "anisongdb", audioUrl: `https://www.youtube.com/watch?v=${vid}` });

  await downloader().downloadTrack(song(1, "fatalfatal1"));
  await downloader().downloadTrack(song(2, "burningburn"));

  assert.equal(lookupRow("amq:1")?.audio_url, "https://www.youtube.com/watch?v=fatalfatal1");
  assert.equal(lookupRow("amq:2")?.audio_url, "https://www.youtube.com/watch?v=burningburn");
  assert.equal(lookupRow("amq:1")?.page_url, page, "작품 페이지는 보여 줄 링크로만 남는다");
  assert.equal(lookupRow(page), null, "작품 페이지는 키가 아니다");
});

test("라이브는 다운로드하지 않는다(끝이 없다). 캐시 파일 기록은 오류로", async () => {
  const track = yt("fffffffffff", { isLive: true });

  await assert.rejects(downloader().downloadTrack(track), /라이브 스트림은 캐시 다운로드 대상이 아님/);

  assert.equal(calls.ytdlp.length, 0);
  assert.equal(audioRow("yt:fffffffffff")?.status, "error");
});

test("yt-dlp 가 건너뛰면(파일 없음) 이유를 알 수 있는 오류로 바꾼다", async () => {
  ytdlpBehavior = () => {};

  await assert.rejects(downloader().downloadTrack(yt("ggggggggggg")), /yt-dlp가 대상을 건너뜀/);
  assert.equal(audioRow("yt:ggggggggggg")?.status, "error");
});

test("빈 파일은 버린다", async () => {
  ytdlpBehavior = (_url, options) => fs.writeFileSync(options.output, "");

  await assert.rejects(downloader().downloadTrack(yt("hhhhhhhhhhh")), { code: "stream-failed", message: "다운로드한 파일이 비어 있습니다" });
  assert.equal(fs.existsSync(audioCache.getFilePath("yt:hhhhhhhhhhh")), false);
  assert.deepEqual(leftovers(), []);
});

test("info.json 이 없으면 제목 · 길이를 모르는 채로 다운로드한다", async () => {
  ytdlpBehavior = (_url, options) => fs.writeFileSync(options.output, "opus-bytes");
  const track = yt("iiiiiiiiiii");

  await downloader().downloadTrack(track);

  assert.equal(track.title, "곡 iiiiiiiiiii");
  assert.equal(audioRow("yt:iiiiiiiiiii")?.duration_sec, 180, "오디오 길이를 모르면 캐시 파일 기록은 트랙이 가진 길이로 채운다");
  assert.equal(lookupRow(track.requestKey)?.title_verified, 0);
});

// ── 직접 링크 분기 ─────────────────────────────────────────────────────

test("직접 링크: 받은 파일에 태그가 있으면 제목과(비어 있으면) 가수 · 앨범을 그것으로 고치고, 링크 데이터에 확인된 제목으로 적는다", async () => {
  const track: DownloadTrack = { title: "a", pageUrl: "https://files.test/t.mp3", requestKey: "https://files.test/t.mp3", audioUrl: "https://files.test/t.mp3", platform: "direct", duration: 100 };
  fileTags = { title: "태그 제목", artist: "태그 가수", album: "태그 앨범" };
  try {
    await downloader().downloadTrack(track);
  } finally {
    fileTags = null;
  }
  assert.deepEqual([track.title, track.artist, track.album], ["태그 제목", "태그 가수", "태그 앨범"]);
  assert.deepEqual([lookupRow(track.requestKey)?.display_title, lookupRow(track.requestKey)?.title_verified], ["태그 제목", 1]);
});

test("직접 링크: 받은 파일의 태그와 다시 구운 그림(JPEG)을 캐시 변환에 넘긴다", async () => {
  const track: DownloadTrack = { title: "a", pageUrl: "https://files.test/art.mp3", requestKey: "https://files.test/art.mp3", audioUrl: "https://files.test/art.mp3", platform: "direct", duration: 100 };
  const png = await sharp({ create: { width: 1500, height: 1500, channels: 3, background: "#336699" } })
    .png()
    .toBuffer();
  fileTags = { title: "태그 제목", artist: null, album: null, picture: { data: png } };
  try {
    await downloader().downloadTrack(track);
  } finally {
    fileTags = null;
  }
  const cache = calls.convert.at(-1)?.cache;
  assert.equal(cache?.tags?.title, "태그 제목");
  assert.deepEqual([cache?.cover?.width, cache?.cover?.height], [1000, 1000]);
  assert.equal((await sharp(cache!.cover!.jpeg).metadata()).format, "jpeg");
});

test("직접 지정한 음원으로 받은 곡은 받은 파일의 태그로 고치지 않는다(곡 정보는 요청의 것)", async () => {
  const track: DownloadTrack = { title: "요청 곡", pageUrl: "https://www.youtube.com/watch?v=pinnedtag01", requestKey: "https://www.youtube.com/watch?v=pinnedtag01", audioUrl: "https://files.test/pin.mp3", audioFoundBy: "pinned", platform: "youtube", duration: 100 };
  fileTags = { title: "파일 제목", artist: "파일 가수", album: "파일 앨범" };
  try {
    await downloader().downloadTrack(track);
  } finally {
    fileTags = null;
  }
  assert.deepEqual([track.title, track.artist, track.album], ["요청 곡", undefined, undefined]);
});

test("직접 링크: SafeUrl 을 거쳐 원본을 다운로드하고, 변환하고, 잰 길이로 모르던 길이를 채운다", async () => {
  const track: DownloadTrack = { title: "파일", pageUrl: "https://files.test/a.flac", requestKey: "https://files.test/a.flac", audioUrl: "https://files.test/a.flac", platform: "direct", duration: 0, durationSource: "unknown" };
  measuredSec = 221.47;

  const file = await downloader().downloadTrack(track);

  assert.deepEqual(calls.direct, ["https://files.test/a.flac"]);
  assert.equal(calls.ytdlp.length, 0);
  assert.equal(calls.convert.length, 1);
  assert.ok(calls.convert[0].src.endsWith(".raw"), "원본을 먼저 파일로 다운로드한다");
  assert.equal(calls.convert[0].srcExists, true);
  assert.equal(track.duration, 221.47);
  assert.equal(track.durationSource, "measured");
  assert.equal(audioRow(`dl:${md5("https://files.test/a.flac")}`)?.audio_version, 'etag="v1";length=9', "응답 헤더에서 버전을 읽는다");
  assert.equal(audioRow(`dl:${md5("https://files.test/a.flac")}`)?.duration_sec, 221.47);
  assert.equal(fs.readFileSync(file, "utf8"), "opus");
  assert.deepEqual(leftovers(), [], ".raw 를 남기지 않는다");
});

test("음원 길이는 만든 .opus 를 재서 소수까지 적는다. 표시는 보이던 값과 2초 넘게 다를 때만 바꾼다", async () => {
  measuredSec = 201.37;
  const close = yt("m1mmmmmmmmm", { duration: 201 });
  await downloader().downloadTrack(close);
  assert.ok(measured[0]?.includes(".tmp-"), "올리기 전의 임시 파일을 잰다");
  assert.equal(audioRow("yt:m1mmmmmmmmm")?.duration_sec, 201.37, "info.json 의 정수보다 잰 값");
  assert.deepEqual({ duration: close.duration, durationSource: close.durationSource }, { duration: 201, durationSource: undefined }, "0.37초 차이로는 표시를 흔들지 않는다");

  measuredSec = 195.5;
  const far = yt("m2mmmmmmmmm", { duration: 201 });
  await downloader().downloadTrack(far);
  assert.deepEqual({ duration: far.duration, durationSource: far.durationSource }, { duration: 195.5, durationSource: "measured" });
});

// ── 이미 있거나 다운로드 중이거나 ──────────────────────────────────────────

test("최종 파일이 이미 있으면 아무것도 다운로드하지 않는다", async () => {
  const track = yt("jjjjjjjjjjj");
  fs.writeFileSync(audioCache.getFilePath("yt:jjjjjjjjjjj"), "old");

  const file = await downloader().downloadTrack(track);

  assert.equal(fs.readFileSync(file, "utf8"), "old");
  assert.equal(calls.ytdlp.length, 0);
  assert.equal(audioRow("yt:jjjjjjjjjjj"), null, "캐시 파일 기록도 안 건드린다");
});

test("같은 곡을 동시에 두 번 부르면 한 번만 다운로드한다", async () => {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
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
  assert.equal(TrackDownloader.isDownloading(fa), false, "끝나면 다운로드 중 목록에서 뺀다");
});

test("다운로드하는 사이 다른 쪽이 먼저 올렸으면 내 것을 버리고 그것을 쓴다", async () => {
  ytdlpBehavior = (url, options) => {
    fs.writeFileSync(audioCache.getFilePath("yt:lllllllllll"), "theirs");
    writesFile()(url, options);
  };

  const file = await downloader().downloadTrack(yt("lllllllllll"));

  assert.equal(fs.readFileSync(file, "utf8"), "theirs");
  assert.deepEqual(leftovers(), []);
});

test("다운로드하는 동안 임시 파일을 퇴거 · 기동 청소에서 보호하고, 끝나면 푼다", async () => {
  let during;
  ytdlpBehavior = (url, options) => {
    during = audioCache._protectedFiles.has(path.resolve(options.output));
    writesFile()(url, options);
  };

  await downloader().downloadTrack(yt("mmmmmmmmmmm"));

  assert.equal(during, true);
  assert.equal(audioCache._protectedFiles.size, 0);
});

// ── 링크 데이터에서 온 영상이 죽었을 때 ────────────────────────────────────────

test("링크 데이터에서 가져온 영상이 내려갔으면 다시 찾아 한 번 더 다운로드한다", async () => {
  ytdlpBehavior = (url, options) => {
    if (url.includes("deaddeaddea")) throw new Error("ERROR: [youtube] deaddeaddea: Video unavailable");
    writesFile()(url, options);
  };
  const track: DownloadTrack = { title: "스포티파이 곡", pageUrl: "https://open.spotify.com/track/sp3", requestKey: "https://open.spotify.com/track/sp3", platform: "spotify", audioUrl: "https://www.youtube.com/watch?v=deaddeaddea", audioFoundBy: "ledger" };

  const owner = { guild: { id: "g-fresh" }, currentTrack: track }; // 지금 트는 곡
  audioCache.protect("g-fresh", "yt:deaddeaddea");
  const file = await new TrackDownloader(owner, deps).downloadTrack(track);

  assert.deepEqual(calls.reresolve, ["스포티파이 곡"]);
  assert.equal(audioCache._protectedKeys.get("g-fresh"), "yt:freshfresh01", "지금 트는 곡이면 보호를 새 음원으로 옮긴다");
  audioCache.unprotect("g-fresh");
  assert.equal(file, audioCache.getFilePath("yt:freshfresh01"), "새 영상의 키 경로로 다운로드한다");
  assert.equal(audioRow("yt:deaddeaddea")?.status, "error");
  assert.equal(audioRow("yt:freshfresh01")?.status, "cached");
});

test("직접 지정한 음원이 사라졌으면 지정을 건너뛰고 원래 링크로 다운로드한다(지금 트는 곡이면 보호도 옮긴다)", async () => {
  ytdlpBehavior = (url, options) => {
    if (url.includes("soundcloud.com")) throw codedError("unavailable-contents", "HTTP Error 404");
    writesFile()(url, options);
  };
  const track: DownloadTrack = { ...yt("origorig001"), audioUrl: "https://soundcloud.com/gone/dl", audioFoundBy: "pinned" };
  const owner = { guild: { id: "g-pindead" }, currentTrack: track };
  audioCache.protect("g-pindead", "sc:gone/dl");

  const file = await new TrackDownloader(owner, deps).downloadTrack(track);

  assert.equal(file, audioCache.getFilePath("yt:origorig001"));
  assert.deepEqual([track.audioUrl, track.audioFoundBy], ["https://www.youtube.com/watch?v=origorig001", "given"]);
  assert.equal(audioCache._protectedKeys.get("g-pindead"), "yt:origorig001");
  audioCache.unprotect("g-pindead");
});

test("직접 지정한 음원이 인터넷 라디오면 받지 않고(끝이 없다) 지정을 건너뛰어 원래 링크로 다운로드한다", async () => {
  ytdlpBehavior = writesFile();
  const radio = { ...deps, direct: { getStream: async (url: string) => (url.includes("radio.test") ? Object.assign(Readable.from([Buffer.from("endless")]), { headers: { "icy-name": "라디오" }, live: true, bounded: false }) : deps.direct.getStream(url)) } };
  const track: DownloadTrack = { ...yt("origradio01"), audioUrl: "https://radio.test/live.mp3", audioFoundBy: "pinned" };

  const file = await new TrackDownloader({ guild: { id: "g-radio" }, currentTrack: null }, radio).downloadTrack(track);

  assert.equal(file, audioCache.getFilePath("yt:origradio01"));
  assert.deepEqual([track.audioUrl, track.audioFoundBy], ["https://www.youtube.com/watch?v=origradio01", "given"]);
  assert.equal(calls.convert.length, 0, "라디오는 받지 않았다");
});

test("새로 검색한 영상(링크 데이터에서 온 것이 아님)이 내려갔으면 다시 찾지 않는다", async () => {
  ytdlpBehavior = () => {
    throw new Error("ERROR: Video unavailable");
  };
  const track: DownloadTrack = { title: "곡", requestKey: "https://open.spotify.com/track/sp4", platform: "spotify", audioUrl: "https://www.youtube.com/watch?v=nnnnnnnnnnn", audioFoundBy: "search" };

  await assert.rejects(downloader().downloadTrack(track), /Video unavailable/);
  assert.deepEqual(calls.reresolve, []);
});

// ── 예열 ──────────────────────────────────────────────────────────────

test("예열: 키를 못 정한 스포티파이 곡은 다운로드 전에 동등물부터 찾는다", async () => {
  const track = { title: "예열 곡", requestKey: "https://open.spotify.com/track/sp5", platform: "spotify", _equivalent: "https://www.youtube.com/watch?v=ooooooooooo" };

  await downloader().warm(track);

  assert.deepEqual(calls.equivalent, ["예열 곡"], "다운로드 전에 한 번. 음원 주소가 생긴 뒤에는 다시 안 찾는다");
  assert.ok(fs.existsSync(audioCache.getFilePath("yt:ooooooooooo")), "키 경로에 다운로드한다(URL 해시 경로가 아니라)");
});

// ── 캐시 파일 찾기 ─────────────────────────────────────────────────

test("findCacheFile: 키 경로에 다운로드를 마친 파일만. 없거나 비었거나 다운로드 중이면 null", () => {
  const track = yt("findfindfin");
  const file = audioCache.getFilePath("yt:findfindfin");

  assert.equal(TrackDownloader.findCacheFile(track), null, "없다");
  fs.writeFileSync(file, "");
  assert.equal(TrackDownloader.findCacheFile(track), null, "비었다");
  fs.writeFileSync(file, "opus");
  assert.equal(TrackDownloader.findCacheFile(track), file);

  TrackDownloader._internals.inFlight.set(file, new Promise(() => {}));
  try {
    assert.equal(TrackDownloader.findCacheFile(track), null, "다운로드 중");
  } finally {
    TrackDownloader._internals.inFlight.delete(file);
  }

  assert.equal(TrackDownloader.findCacheFile({ title: "스포티파이", requestKey: "https://open.spotify.com/track/x" }), null, "음원 주소가 없으면 키도 없다");
  assert.equal(TrackDownloader.findCacheFile(null), null);
});
