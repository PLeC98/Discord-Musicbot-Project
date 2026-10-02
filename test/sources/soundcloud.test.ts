// 사운드클라우드 출처(sources/soundcloud). yt-dlp 는 띄우는 exec 만 가짜로 둔다(응답 · 오류 모양 맞추기는 진짜가 돈다).
// 응답 모양은 2026-09-27 실측(곡 · 세트 · 미리듣기 · 지역 제한)을 따른다.

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as SoundCloud from "../../src/sources/soundcloud/index.ts";
import { codeOf, errorKind } from "../../src/rules/errorKind.ts";
import { useExec, type Exec, type YtDlpFlags } from "../../src/sources/ytdlpSpawn.ts";

// yt-dlp 가 줄 것. fail 이면 그 stderr 로 1 을 내고 끝난다(json 이 있으면 stdout 에 함께)
type Reply = { json?: unknown; fail?: string };
const calls: Array<{ url: string; flags: YtDlpFlags }> = [];
let respond: (url: string, flags: YtDlpFlags) => Reply;

const harness = ((url: string, flags: YtDlpFlags = {}) => {
  calls.push({ url, flags });
  const { json, fail } = respond(url, flags);
  const stdout = json === undefined ? "" : JSON.stringify(json);
  if (fail) return Promise.reject(Object.assign(new Error("exit 1"), { stderr: fail, stdout, exitCode: 1 }));
  return Promise.resolve({ stdout, stderr: "" });
}) as unknown as Exec;

before(() => useExec(harness));
after(() => useExec(null));
beforeEach(() => {
  calls.length = 0;
});

const aac = [{ format_id: "hls_aac_96k" }, { format_id: "hls_aac_160k" }];
const preview = [{ format_id: "http_mp3_1_0_preview" }];
const item = (slug: string, extra: Record<string, unknown> = {}) => ({ id: 2000000000 + slug.length, title: `SC ${slug}`, uploader: "올린 사람", webpage_url: `https://soundcloud.com/artist/${slug}`, duration: 139.671, thumbnail: "https://i1.sndcdn.com/a.jpg", formats: aac, ...extra });
const GEO = "ERROR: [soundcloud] This video is not available from your location due to geo restriction\nYou might want to use a VPN or a proxy server (with --proxy) to workaround.";

test("곡 링크: 곡 찾기용 포맷(aac · mp3)만 묻고, 공통 옵션만 쓴다", async () => {
  respond = () => ({ json: item("one") });
  const found = await SoundCloud.find("https://m.soundcloud.com/artist/one?in=a/sets/b");
  assert.equal(found.kind, "track");
  assert.deepEqual(found.kind === "track" && found.track, {
    title: "SC one",
    artist: "올린 사람",
    duration: 139.671,
    thumbnail: "https://i1.sndcdn.com/a.jpg",
    platform: "soundcloud",
    id: "2000000003",
    pageUrl: "https://soundcloud.com/artist/one",
    requestKey: "https://soundcloud.com/artist/one",
    audioUrl: "https://soundcloud.com/artist/one",
  });
  const { flags } = calls[0];
  assert.equal(flags.extractorArgs, "soundcloud:formats=hls_aac,http_mp3");
  assert.equal(flags.retries, 3);
  assert.equal(flags.jsRuntimes, undefined, "유튜브 전용 옵션은 없다");
  assert.equal(flags.noWarnings, undefined, "경고를 끄지 않는다");
});

test("짧은 링크 · API 주소로 들어와도 곡 페이지 주소가 열쇠다", async () => {
  respond = () => ({ json: item("two") });
  const found = await SoundCloud.find("https://on.soundcloud.com/AbCd");
  assert.equal(found.kind === "track" && found.track.requestKey, "https://soundcloud.com/artist/two");
});

test("미리듣기만 열린 곡은 틀지 않는다(이름을 단 오류)", async () => {
  respond = () => ({ json: item("preview", { duration: 30, formats: preview }) });
  await assert.rejects(SoundCloud.find("https://soundcloud.com/artist/preview"), (e: unknown) => codeOf(e) === "sc-preview-only" && errorKind(e) === "sc-preview-only");
});

test("곡 링크의 실패는 까닭의 이름을 단다: 없음 · 지역 제한 · 요청 제한 · 네트워크", async () => {
  const cases: Array<[string, string, "track" | "set"]> = [
    ["ERROR: [soundcloud] artist/gone: Unable to download JSON metadata: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)", "unavailable-contents", "track"],
    ["ERROR: [soundcloud:set] artist/sets/gone: Unable to download JSON metadata: HTTP Error 404: Not Found", "unavailable-playlist", "set"],
    [GEO, "geo-blocked", "track"],
    ["ERROR: [soundcloud:set] a/sets/b: Unable to download JSON metadata: HTTP Error 403: Forbidden (caused by <HTTPError 403: Forbidden>)", "rate-limited", "set"],
    ["ERROR: [soundcloud] 1: Unable to download JSON metadata: <urlopen error [Errno 11001] getaddrinfo failed>", "network-error", "track"],
  ];
  for (const [stderr, kind, what] of cases) {
    respond = () => ({ fail: stderr });
    await assert.rejects(SoundCloud.find("https://soundcloud.com/artist/x", { what }), (e: unknown) => errorKind(e) === kind, kind);
  }
});

test("세트: 한 구간을 온전히 읽고, 받을 수 없는 곡과 미리듣기는 빼고 센다", async () => {
  // 실측 모양: 지역 제한이 섞이면 1 로 끝나지만 JSON 은 끝까지 오고, 못 받은 곡은 null
  respond = () => ({
    json: { _type: "playlist", id: "1860035430", title: "Chill Guitar", playlist_count: 50, entries: [null, item("a"), item("p", { duration: 30, formats: preview }), null, item("b")] },
    fail: GEO,
  });
  const found = await SoundCloud.find("https://soundcloud.com/lofi_girl/sets/chill-guitar", { offset: 10, limit: 50, what: "set" });
  assert.equal(found.kind, "set");
  if (found.kind !== "set") return;
  assert.deepEqual(
    found.tracks.map((t) => t.title),
    ["SC a", "SC b"],
  );
  assert.deepEqual({ total: found.total, nextOffset: found.nextOffset, setId: found.setId, skipped: found.skipped }, { total: 50, nextOffset: 15, setId: "1860035430", skipped: 3 });
  assert.equal(calls[0].flags.playlistItems, "11:20", "서버 설정이 50이어도 10곡씩");
  assert.equal(calls[0].flags.extractorArgs, "soundcloud:formats=hls_aac", "세트는 AAC 만 묻는다(요청을 줄인다)");
});

test("짧은 링크가 세트를 가리키면 세트로 읽는다", async () => {
  respond = () => ({ json: { _type: "playlist", id: "9", title: "세트", playlist_count: 1, entries: [item("a")] } });
  const found = await SoundCloud.find("https://on.soundcloud.com/Set1");
  assert.equal(found.kind, "set");
});

test("스트림: AAC(HLS)만 묻고, HLS 를 못 여는 ffmpeg 면 mp3 만 묻는다", async () => {
  respond = () => ({ json: { url: "https://cf-hls-media.sndcdn.com/x.m3u8", protocol: "m3u8_native", format_id: "hls_aac_160k", duration: 180.6, abr: 160, http_headers: { A: "b" } } });
  const s = await SoundCloud.getStream("https://soundcloud.com/artist/track");
  assert.deepEqual(s, { url: "https://cf-hls-media.sndcdn.com/x.m3u8", protocol: "m3u8_native", duration: 181, bitrate: 160, platform: "soundcloud", httpHeaders: { A: "b" } });
  assert.equal(calls[0].flags.extractorArgs, "soundcloud:formats=hls_aac");
  await SoundCloud.getStream("https://soundcloud.com/artist/track", { canPlayHls: false });
  assert.equal(calls[1].flags.extractorArgs, "soundcloud:formats=http_mp3");
});

test("스트림: AAC 가 없는 곡은 mp3 까지 물어 한 번 더, 미리듣기 조각이 골리면 틀지 않는다", async () => {
  const NO_FORMATS = "ERROR: [soundcloud] 123: No video formats found!; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues";
  respond = (_url, flags) => (flags.extractorArgs === "soundcloud:formats=hls_aac" ? { fail: NO_FORMATS } : { json: { url: "https://cf-media.sndcdn.com/x.mp3", protocol: "http", format_id: "http_mp3_0_1", duration: 100 } });
  const s = await SoundCloud.getStream("https://soundcloud.com/artist/old");
  assert.equal(s.url, "https://cf-media.sndcdn.com/x.mp3");
  assert.equal(calls.length, 2);

  respond = (_url, flags) => (flags.extractorArgs === "soundcloud:formats=hls_aac" ? { fail: NO_FORMATS } : { json: { url: "https://cf-preview-media.sndcdn.com/p.mp3", protocol: "http", format_id: "http_mp3_1_0_preview", duration: 30 } });
  await assert.rejects(SoundCloud.getStream("https://soundcloud.com/artist/preview"), (e: unknown) => codeOf(e) === "sc-preview-only");

  respond = () => ({ fail: NO_FORMATS });
  await assert.rejects(SoundCloud.getStream("https://soundcloud.com/artist/aac-only", { canPlayHls: false }), (e: unknown) => codeOf(e) === "stream-failed");
});

test("캐시 받기용 옵션: 공통 옵션 위에 재생 포맷", () => {
  const flags = SoundCloud.flagsFor("play", { output: "x.opus" });
  assert.equal(flags.extractorArgs, "soundcloud:formats=hls_aac");
  assert.equal(flags.output, "x.opus");
  assert.equal(flags.retries, 3);
});

test("캐시 받기: AAC 를 받고, AAC 가 없는 곡은 미리듣기 조각이 아닌 mp3 를 받는다", async () => {
  const NO_FORMATS = "ERROR: [soundcloud] 123: No video formats found!";
  respond = (_url, flags) => (flags.extractorArgs === "soundcloud:formats=hls_aac" ? { fail: NO_FORMATS } : { json: {} });
  await SoundCloud.download("https://soundcloud.com/artist/old", { output: "x.opus", format: "bestaudio/best" });
  assert.deepEqual(
    calls.map((c) => [c.flags.extractorArgs, c.flags.format, c.flags.output]),
    [
      ["soundcloud:formats=hls_aac", "bestaudio/best", "x.opus"],
      ["soundcloud:formats=hls_aac,http_mp3", "bestaudio[format_id!*=preview]/best[format_id!*=preview]", "x.opus"],
    ],
  );
  assert.equal(calls[0].flags.dumpSingleJson, undefined, "받는 것이지 정보만 읽는 것이 아니다");
});

test("캐시 받기: 미리듣기 곡은 고를 포맷이 없어 '포맷 없음'으로 끝난다(유튜브의 클라이언트 탓이 아니다)", async () => {
  respond = (_url, flags) => ({ fail: flags.extractorArgs === "soundcloud:formats=hls_aac" ? "ERROR: [soundcloud] 1: No video formats found!" : "ERROR: [soundcloud] 1: Requested format is not available. Use --list-formats for a list of available formats" });
  await assert.rejects(SoundCloud.download("https://soundcloud.com/artist/preview", { output: "x.opus" }), (e: unknown) => codeOf(e) === "no-formats");
});

// 세트 하나가 곡마다 요청을 30개 남짓 쓴다. 서버 여럿이 동시에 넣어 겹치면 IP 가 막힌다(실측)
test("세트 읽기는 한 번에 하나씩, 곡 하나는 기다리지 않는다", async () => {
  const order: string[] = [];
  const held: Array<() => void> = [];
  useExec(((url: string) => {
    order.push(`시작 ${url.slice(-5)}`);
    const json = url.includes("/sets/") ? { _type: "playlist", id: "1", entries: [] } : item("t");
    return new Promise((done) => {
      const finish = () => {
        order.push(`끝 ${url.slice(-5)}`);
        done({ stdout: JSON.stringify(json), stderr: "" });
      };
      if (url.endsWith("set-a")) held.push(finish);
      else finish();
    });
  }) as unknown as Exec);
  try {
    const a = SoundCloud.find("https://soundcloud.com/x/sets/set-a", { what: "set" });
    const b = SoundCloud.find("https://soundcloud.com/x/sets/set-b", { what: "set" });
    const one = SoundCloud.find("https://soundcloud.com/x/trk-1");
    await one;
    await new Promise((done) => setImmediate(done));
    // 시작 차례(세트 a 와 곡)는 보지 않는다. 곡이 끝났고, 세트 b 는 세트 a 가 끝나기 전에 시작하지 않았는지만
    assert.ok(order.includes("끝 trk-1"), "곡은 세트를 기다리지 않는다");
    assert.ok(order.includes("시작 set-a"));
    assert.ok(!order.some((line) => line.includes("set-b")), `둘째 세트는 첫 세트를 기다린다: ${order.join(", ")}`);
    held.shift()?.();
    await Promise.all([a, b]);
    assert.deepEqual(order.slice(-3), ["끝 set-a", "시작 set-b", "끝 set-b"]);
  } finally {
    // 단언이 실패해도 붙잡은 세트를 푼다. 안 풀면 줄 선 세트 읽기가 모두 영영 기다린다
    for (const finish of held) finish();
    useExec(harness);
  }
});

// 요청 제한에 걸린 곡은 받을 수 없는 곡이 아니다. 받을 수 없는 곡으로 세면 까닭이 묻힌다
test("세트 읽기 중 요청 제한(403 · 429)이 섞이면 뺀 곡으로 세지 않고 요청 제한으로 알린다", async () => {
  respond = () => ({
    json: { _type: "playlist", id: "1", playlist_count: 3, entries: [item("a"), null, null] },
    fail: "ERROR: [soundcloud] 2: Unable to download JSON metadata: HTTP Error 429: Too Many Requests\nERROR: [soundcloud] 3: Unable to download JSON metadata: HTTP Error 429: Too Many Requests",
  });
  await assert.rejects(SoundCloud.find("https://soundcloud.com/x/sets/busy", { what: "set" }), (e: unknown) => errorKind(e) === "rate-limited");
});
