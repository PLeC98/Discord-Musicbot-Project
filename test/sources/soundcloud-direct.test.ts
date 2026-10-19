// 사운드클라우드와 직접 링크를 곡 찾기(바깥 계약)로 본다. 사운드클라우드 출처 자체는 soundcloud.test.ts.
// yt-dlp 는 실행하는 exec 만(useExec), 직접 링크는 SafeUrl 의 getStream 만 가짜로 둔다.

import { Readable } from "node:stream";
import * as links from "../../src/rules/links.ts";
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import * as DirectLink from "../../src/sources/direct.ts";
import { getTrackData } from "../../src/sources/lookup.ts";
import { messageOf, codeOf, errorKind } from "../../src/rules/error-kind.ts";
import { addFailureMessage, errorMessage } from "../../src/ui/error-messages.ts";
import { useExec, type Exec, type YtDlpFlags } from "../../src/sources/ytdlp-spawn.ts";
import { plainText } from "../helpers/notice.ts";

// yt-dlp 가 줄 것. 실패면 fail 에 stderr
type Reply = ({ fail?: string } & Record<string, unknown>) | null;

const calls = { ytdlp: [] as Array<{ url: string; flags: YtDlpFlags }>, info: [] as string[], stream: [] as string[], streamOpts: [] as unknown[] };
let respond: (url: string, flags: YtDlpFlags) => Reply;
let headReply: (url: string) => { headers: object };
// 직접 링크의 네트워크(SafeUrl 의 getStream) 가짜. DirectLink 에 넘긴다. 곡 정보(getInfo)는 응답 헤더를 보고, 재생 · 다운로드는 본문 무응답 한도를 넘긴다
const net = {
  getStream: async (url: string, _deps?: undefined, opts?: { bodyIdleMs?: number; accept?: { timeoutMs: number } }) => {
    if (opts?.bodyIdleMs === undefined) {
      calls.info.push(url);
      return Object.assign(Readable.from([Buffer.from("x")]), { headers: headReply(url).headers as Record<string, unknown>, status: 200 });
    }
    calls.stream.push(url);
    calls.streamOpts.push(opts);
    return Object.assign(Readable.from([Buffer.from("x")]), { headers: { "content-type": "audio/mpeg" }, status: 200 });
  },
};
const info = { net };

before(() => {
  // 가짜는 tinyspawn 약속의 stdout · stderr 만 준다
  useExec(((url: string, flags: YtDlpFlags = {}) => {
    calls.ytdlp.push({ url, flags });
    const out = respond(url, flags);
    if (out && out.fail) return Promise.reject(Object.assign(new Error("exit 1"), { stderr: out.fail }));
    return Promise.resolve({ stdout: JSON.stringify(out), stderr: "" });
  }) as unknown as Exec);
});

after(() => {
  useExec(null);
});

beforeEach(() => {
  for (const list of Object.values(calls)) list.length = 0;
  respond = () => ({});
  headReply = () => ({ headers: {} });
});

const scItem = (slug: string, extra: Record<string, unknown> = {}) => ({ id: 1000 + slug.length, title: `SC ${slug}`, uploader: "올린 사람", webpage_url: `https://soundcloud.com/artist/${slug}`, duration: 180.4, thumbnail: "https://i1.sndcdn.com/a.jpg", ...extra });

// ── 사운드클라우드 ────────────────────────────────────────────────────

test("사운드클라우드 링크 판정: 곡 · 세트 · 사용자 · 앱 짧은 링크", () => {
  for (const url of ["https://soundcloud.com/artist/track-name", "https://m.soundcloud.com/artist/track", "https://soundcloud.com/artist/sets/list", "https://soundcloud.com/artist", "https://on.soundcloud.com/AbC123"]) {
    assert.equal(links.isSoundCloudURL(url), true, url);
  }
  for (const url of ["https://soundcloud.app/x/y", "https://www.youtube.com/watch?v=x", "soundcloud.com/a/b"]) {
    assert.equal(links.isSoundCloudURL(url), false, url);
  }
});

const aac = [{ format_id: "hls_aac_96k" }, { format_id: "hls_aac_160k" }];

test("곡 찾기: 사운드클라우드 세트 링크는 재생목록으로 들어간다(한 구간, 곡마다 곡 페이지 주소)", async () => {
  respond = () => ({ _type: "playlist", id: "123", title: "세트 이름", uploader: "올린 사람", webpage_url: "https://soundcloud.com/artist/sets/list", playlist_count: 2, entries: [scItem("a", { formats: aac }), scItem("b", { formats: aac })] });
  const r = await getTrackData("https://soundcloud.com/artist/sets/list");
  assert.equal(r.success, true);
  assert.deepEqual([r.isPlaylist, r.collection, r.total, r.collectionId], [true, "playlist", 2, "123"]);
  assert.deepEqual(
    r.tracks?.map((t) => [t.title, t.requestKey]),
    [
      ["SC a", "https://soundcloud.com/artist/a"],
      ["SC b", "https://soundcloud.com/artist/b"],
    ],
  );
});

test("곡 찾기: 미리듣기만 열린 곡은 틀지 않고 까닭을 알린다", async () => {
  respond = () => scItem("preview", { duration: 30, formats: [{ format_id: "http_mp3_1_0_preview" }] });
  const r = await getTrackData("https://soundcloud.com/artist/preview");
  assert.equal(r.success, false);
  assert.equal(errorKind(r.error), "sc-preview-only");
  assert.equal(r.success ? "" : plainText(addFailureMessage({ code: r.code, kind: errorKind(r.error) })), "미리듣기만 가능한 곡이라 틀 수 없어요.\n다른 곡을 재생하거나, 다른 플랫폼으로 시도해 주세요.");
});

test("곡 찾기: 지역 제한은 그 까닭으로 알린다(결과 없음이 아니다)", async () => {
  respond = () => ({ fail: "ERROR: [soundcloud] 123: This video is not available from your location due to geo restriction" });
  const r = await getTrackData("https://soundcloud.com/artist/blocked");
  assert.equal(r.success, false);
  assert.equal(errorKind(r.error), "geo-blocked");
});

// ── 직접 링크 ─────────────────────────────────────────────────────────

test("직접 링크 판정: http(s) 이고 지원하는 확장자로 끝나야 한다(쿼리는 상관없다)", () => {
  for (const url of ["https://files.test/a.mp3", "http://x.test/b/c.FLAC", "https://cdn.test/v.webm?sig=1", "https://x.test/y.opus"]) {
    assert.equal(links.isDirectAudioLink(url), true, url);
  }
  for (const url of ["https://files.test/a.txt", "ftp://x.test/a.mp3", "https://x.test/mp3", "not a url"]) {
    assert.equal(links.isDirectAudioLink(url), false, url);
  }
});

test("직접 링크 정보: SafeUrl GET 의 응답 헤더로 크기와 종류를 본다. 길이는 다운로드 전에는 모른다(크기로 어림하지 않는다)", async () => {
  headReply = () => ({ headers: { "content-type": "audio/mpeg", "content-length": "1600000" } });

  const [t] = await DirectLink.getInfo("https://files.test/my_song-name.mp3?x=1", info);

  assert.deepEqual(calls.info, ["https://files.test/my_song-name.mp3?x=1"]);
  assert.deepEqual({ title: t.title, duration: t.duration, durationSource: t.durationSource, platform: t.platform, fileSize: t.fileSize, extension: t.extension, filename: t.filename, thumbnail: t.thumbnail }, { title: "my song name", duration: 0, durationSource: "unknown", platform: "direct", fileSize: 1600000, extension: ".mp3", filename: "my_song-name.mp3", thumbnail: null });
  assert.equal(t.id, DirectLink.generateId("https://files.test/my_song-name.mp3?x=1"));
});

test("직접 링크 정보: 서버가 알려 준 파일 이름(Content-Disposition)이 주소보다 먼저다", async () => {
  headReply = () => ({ headers: { "content-type": "audio/mpeg", "content-disposition": "attachment; filename=\"x.mp3\"; filename*=UTF-8''%EB%85%B8%EB%9E%98%20%EC%A0%9C%EB%AA%A9.mp3" } });
  const [t] = await DirectLink.getInfo("https://files.test/get/7.mp3", info);
  assert.equal(t.title, "노래 제목");
  headReply = () => ({ headers: { "content-type": "audio/mpeg", "content-disposition": 'attachment; filename="Artist - Song.mp3"' } });
  const [u] = await DirectLink.getInfo("https://files.test/get/8.mp3", info);
  assert.equal(u.title, "Artist - Song");
});

test("직접 링크 정보: 지원하지 않는 링크는 빈 배열, 열지 못하면 사유를 숨긴 일반 문장으로 던진다", async () => {
  assert.deepEqual(await DirectLink.getInfo("https://files.test/a.txt", info), []);
  assert.equal(calls.info.length, 0);
  headReply = () => {
    throw new Error("SSRF 차단: 10.0.0.5");
  };
  const thrown = await DirectLink.getInfo("https://files.test/a.mp3", info).then(
    () => assert.fail("던져야 한다"),
    (e: unknown) => e,
  );
  assert.equal(codeOf(thrown), "direct-unavailable");
  assert.match(messageOf((thrown as Error).cause), /10\.0\.0\.5/, "사유는 원인에(서버 로그용)");
  // 사용자에게 가는 문장에는 막힌 주소가 없다(내부망 탐지 도구가 되지 않게)
  const told = errorMessage(thrown);
  assert.equal(plainText(told), "재생할 수 없는 링크예요!\n해당 링크가 오디오나 영상이 맞는지, 용량이 너무 크지는 않은지, 접속이 정상적으로 가능한지 확인해주세요.");
});

test("직접 링크: icy-* 헤더가 있으면 인터넷 라디오라 라이브로 담는다(길이를 추정하지 않는다)", async () => {
  // 끝없는 방송인데도 큰 가짜 크기를 붙이는 서버가 있다
  headReply = () => ({ headers: { "content-type": "audio/mpeg", "content-length": "54000000", "icy-name": "라디오", "icy-br": "128" } });
  const [t] = await DirectLink.getInfo("https://radio.test/live.mp3", info);
  assert.deepEqual({ isLive: t.isLive, liveStatus: t.liveStatus, duration: t.duration, durationSource: t.durationSource }, { isLive: true, liveStatus: "is_live", duration: 0, durationSource: "unknown" });

  headReply = () => ({ headers: { "content-type": "audio/mpeg", "content-length": "1600000" } });
  const [f] = await DirectLink.getInfo("https://files.test/b.mp3", info);
  assert.equal(f.isLive, undefined, "보통 파일은 라이브가 아니다");
});

test("직접 링크 스트림: SafeUrl 로 열고, 실패 사유는 숨기고 일반 문장으로 던진다", async () => {
  const s = await DirectLink.getStream("https://files.test/a.mp3", net, { bodyIdleMs: 6000 });
  assert.ok(s instanceof Readable);
  assert.deepEqual(calls.stream, ["https://files.test/a.mp3"]);
  assert.deepEqual(
    calls.streamOpts.map((opts) => (opts as { bodyIdleMs?: number }).bodyIdleMs),
    [6000],
    "본문 무응답 한도를 그대로 넘긴다",
  );

  await assert.rejects(DirectLink.getStream("https://files.test/a.txt", net), (e: unknown) => messageOf(e) === "재생할 수 없는 링크입니다" && /지원되지 않는 직접 오디오 파일 링크/.test(messageOf((e as Error).cause)));
  const blocked = {
    getStream: async () => {
      throw new Error("SSRF 차단: 127.0.0.1");
    },
  };
  await assert.rejects(DirectLink.getStream("https://files.test/b.mp3", blocked), (e: unknown) => messageOf(e) === "재생할 수 없는 링크입니다" && /127\.0\.0\.1/.test(messageOf((e as Error).cause)));
});

test("파일 이름에서 제목: 인코딩을 풀고, 띄어쓰기 없는 이름만 구분자를 공백으로, 대소문자는 그대로", () => {
  assert.equal(DirectLink.extractTitle("hello_world-2.mp3"), "hello world 2");
  assert.equal(DirectLink.extractTitle(".mp3"), "mp3", "점으로 시작하는 이름은 확장자가 아니라 이름으로 읽힌다");
  assert.equal(DirectLink.extractTitle("%EB%85%B8%EB%9E%98%20live.mp3"), "노래 live");
  assert.equal(DirectLink.extractTitle("iPhone_demo.mp3"), "iPhone demo");
  assert.equal(DirectLink.extractTitle("Artist - Song_Title.mp3"), "Artist - Song Title", "띄어 쓴 이름의 - 는 그대로");
  assert.equal(DirectLink.extractTitle("broken%E0%A4.mp3"), "broken%E0%A4", "깨진 인코딩은 그대로");
  assert.equal(DirectLink.extractTitle("___.mp3"), null, "이름이 남지 않으면 표시 문구로 채우지 않고 비워 둔다");
});

// 회귀 대상: 주소 앞 12글자로 만들어 같은 호스트의 곡이 모두 같은 ID 였다
test("직접 링크 곡 ID 는 주소 전체에서 나온다", () => {
  assert.notEqual(DirectLink.generateId("https://example.com/a.mp3"), DirectLink.generateId("https://example.com/b.mp3"));
  assert.equal(DirectLink.generateId("https://example.com/a.mp3"), DirectLink.generateId("https://example.com/a.mp3"));
  assert.equal(DirectLink.generateId("https://example.com/a.mp3").length, 16);
});
