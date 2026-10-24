// src/sources/direct-tags.ts · direct.ts 의 getInfo 태그 읽기 — 직접 링크 곡 정보를 파일 태그로 고친다.
// 담을 때 GET 하나: 1.5초 안에 읽으면 그 곡으로, 아니면 파일 이름으로 담고 마저 읽어 고친다. 고친 것은 링크 데이터에 확인된 제목으로 적는다

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as DirectLink from "../../src/sources/direct.ts";
import { applyTags } from "../../src/sources/direct-tags.ts";
import * as trackLookup from "../../src/store/track-lookup.ts";
import * as pinnedSources from "../../src/store/pinned-sources.ts";
import * as lookup from "../../src/sources/lookup.ts";
import { HEAD_TIMEOUT_MS } from "../../src/infra/safe-url.ts";
import { codeOf, codedError } from "../../src/rules/error-kind.ts";
import { openTempStore } from "../helpers/temp-store.ts";
import type { Tags } from "../../src/sources/file-tags.ts";
import { spawnFfmpeg } from "../../src/media/ffmpeg/process.ts";

const store = openTempStore("direct-tags-");
after(() => store.close());
beforeEach(() => store.db().exec("DELETE FROM track_lookup;"));
const row = (key: string) => store.db().prepare<[string], { display_title: string | null; display_artist: string | null; title_verified: number }>("SELECT display_title, display_artist, title_verified FROM track_lookup WHERE request_key = ?").get(key);

const FILE = "https://files.test/my_song.mp3";
const TAGS = { title: "태그 제목", artist: "태그 가수", album: "태그 앨범", picture: null };

/** ffmpeg 로 만든 태그 단 MP3(시료가 없으면 null) */
const samples = new Map<string, Buffer | null>();
function ffmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFfmpeg(["-hide_banner", "-loglevel", "error", ...args], "probe", { killOnStdoutClose: false });
    } catch {
      return resolve(false);
    }
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * ffmpeg 로 만든 태그 단 MP3(시료가 없으면 null).
 * art: 그림이 든 태그(1200px, 앞 8KB 를 크게 넘는다). 담을 때 앞부분 판정 뒤 태그의 나머지가 느리게 오는 것을 흉내 낸다
 */
async function mp3(title: string, artist: string, album: string, { art = false } = {}): Promise<Buffer | null> {
  const key = `${title}|${artist}|${album}|${art}`;
  if (samples.has(key)) return samples.get(key) ?? null;
  const file = path.join(store.dir, `${samples.size}.mp3`);
  const cover = path.join(store.dir, "cover.jpg");
  const picture = art ? ["-i", cover, "-map", "0:a", "-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic"] : [];
  const ok = (!art || (await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=1200x1200:d=1", "-frames:v", "1", "-y", cover]))) && (await ffmpeg(["-f", "lavfi", "-i", "sine=duration=5", ...picture, "-c:a", "libmp3lame", "-metadata", `title=${title}`, "-metadata", `artist=${artist}`, "-metadata", `album=${album}`, "-y", file]));
  const bytes = ok ? fs.readFileSync(file) : null;
  samples.set(key, bytes);
  return bytes;
}

/** 가짜 SafeUrl: 응답 헤더와 본문. 앞 8KB 뒤의 조각은 laterDelayMs 마다, 다 보내면 닫지 않는다(끝이 없는 응답 흉내) */
function netOf(body: Buffer, { headers = { "content-type": "audio/mpeg" } as Record<string, unknown>, laterDelayMs = 0, chunk = 512 } = {}) {
  const seen = { accept: [] as Array<number | undefined>, destroyed: false };
  const net = {
    getStream: async (_url: string, _deps?: undefined, opts?: { accept?: { timeoutMs: number } }) => {
      seen.accept.push(opts?.accept?.timeoutMs);
      let at = 0;
      const stream = new Readable({
        read() {
          setTimeout(
            () => {
              if (at >= body.length) return;
              const piece = body.subarray(at, at + chunk);
              at += piece.length;
              this.push(piece);
            },
            at < 8192 ? 0 : laterDelayMs,
          );
        },
        destroy(error, callback) {
          seen.destroyed = true;
          callback(error);
        },
      });
      return Object.assign(stream, { headers, status: 200 });
    },
  };
  return { net, seen };
}

test("반영: 쓰는 곡이면 고치고 링크 데이터에 확인된 제목으로 적어, 나중의 확인 안 된 기록(재생 시작)이 덮지 못한다", () => {
  const track = { title: "my song", requestKey: FILE, audioUrl: FILE, platform: "direct", pageUrl: FILE, duration: 0 };
  assert.deepEqual(applyTags(track, TAGS).sort(), ["album", "artist", "title"]);
  assert.deepEqual(row(FILE), { display_title: "태그 제목", display_artist: "태그 가수", title_verified: 1 });

  trackLookup.recordTrackLookup({ ...track, title: "my song", artist: undefined }, { verified: false });
  assert.deepEqual(row(FILE), { display_title: "태그 제목", display_artist: "태그 가수", title_verified: 1 }, "파일 이름 제목이 덮지 못한다");

  const pinned = { title: "요청 곡", requestKey: "https://www.youtube.com/watch?v=aaaaaaaaaaa", audioUrl: FILE, audioFoundBy: "pinned" as const, platform: "youtube", pageUrl: "x", duration: 0 };
  assert.deepEqual(applyTags(pinned, TAGS), []);
  assert.equal(pinned.title, "요청 곡");
});

test("getInfo: 1.5초 안에 태그를 읽으면 그 곡으로 담는다. 홉 대기는 HEAD 와 같다", async (t) => {
  const body = await mp3("태그 제목", "태그 가수", "태그 앨범");
  if (!body) return t.skip("ffmpeg로 시료를 만들 수 없음");
  const { net, seen } = netOf(body);
  const got: Tags[] = [];
  const [track] = await DirectLink.getInfo(FILE, { net, tags: (t, tags) => (got.push(tags), applyTags(t, tags)) });
  assert.deepEqual([track.title, track.artist, track.album], ["태그 제목", "태그 가수", "태그 앨범"]);
  assert.equal(got.length, 1);
  assert.deepEqual(seen.accept, [HEAD_TIMEOUT_MS]);
  assert.ok(seen.destroyed, "다 읽으면 끊는다");
});

test("getInfo: 1.5초를 넘기면 파일 이름으로 담고, 마저 읽어 같은 곡을 고친다", { timeout: 20_000 }, async (t) => {
  const body = await mp3("늦은 제목", "늦은 가수", "늦은 앨범", { art: true });
  if (!body) return t.skip("ffmpeg로 시료를 만들 수 없음");
  // 앞부분(판정)은 바로 오고, 그림이 든 태그의 나머지가 느리게 온다
  const { net } = netOf(body, { laterDelayMs: 400, chunk: 8192 });
  let late: () => void = () => {};
  const applied = new Promise<void>((resolve) => (late = resolve));
  const started = Date.now();
  const [track] = await DirectLink.getInfo(FILE, { net, tags: (t, tags) => (applyTags(t, tags), late()) });
  assert.ok(Date.now() - started < 2500, `담기는 기다리지 않는다(${Date.now() - started}ms)`);
  assert.equal(track.title, "my song", "파일 이름");
  await applied;
  assert.equal(track.title, "늦은 제목");
  assert.equal(row(FILE)?.display_title, "늦은 제목");
});

test("getInfo: 라디오 · 태그를 읽지 않는 부름(라디오 확인 · 직접 지정한 음원)은 헤더만 보고 끊는다", async () => {
  const body = Buffer.from("ID3 아무 바이트");
  const radio = netOf(body, { headers: { "content-type": "audio/mpeg", "icy-name": "라디오" } });
  let called = false;
  const [live] = await DirectLink.getInfo("https://radio.test/live.mp3", { net: radio.net, tags: () => (called = true) });
  assert.equal(live.isLive, true);
  assert.ok(radio.seen.destroyed && !called, "라디오는 본문을 읽지 않는다");

  const plain = netOf(body);
  const [track] = await DirectLink.getInfo(FILE, { net: plain.net });
  assert.equal(track.title, "my song");
  assert.ok(plain.seen.destroyed);
});

test("곡 찾기: 직접 링크는 태그를 읽고, 직접 지정한 음원을 읽는 둘째 찾기는 읽지 않는다(곡 정보는 요청의 것)", async () => {
  const asked: Array<{ url: string; tags: boolean }> = [];
  const direct = {
    getInfo: async (url: string, opts?: { tags?: unknown }) => {
      asked.push({ url, tags: Boolean(opts?.tags) });
      return url === FILE ? [] : [{ title: "음원", pageUrl: url, requestKey: url, audioUrl: url, platform: "direct", duration: 0 }];
    },
  };
  await lookup.getTrackData("https://files.test/b.mp3", undefined, undefined, { direct });
  assert.deepEqual(asked, [{ url: "https://files.test/b.mp3", tags: true }]);

  // 원래 링크(직접 링크)를 읽지 못해 지정한 음원을 읽는다
  asked.length = 0;
  pinnedSources.setPin(FILE, "https://files.test/pinned.mp3");
  await lookup.resolveQuery(FILE, undefined, {}, { direct });
  assert.deepEqual(asked, [
    { url: FILE, tags: true },
    { url: "https://files.test/pinned.mp3", tags: false },
  ]);
});

test("음원이 아닌 직접 링크(웹 페이지 · 그림): getInfo 는 unsupported-link 로 던지고, 곡 찾기는 실패가 아니라 '알 수 없는 링크'로 답한다", async () => {
  const page = netOf(Buffer.from("<!doctype html><p>로그인</p>"), { headers: { "content-type": "text/html" } });
  await assert.rejects(DirectLink.getInfo("https://files.test/page.mp3", { net: page.net }), (e: unknown) => codeOf(e) === "unsupported-link");
  const direct = {
    getInfo: async () => {
      throw codedError("unsupported-link", "음원이 아닌 링크입니다(page)");
    },
  };
  assert.deepEqual(await lookup.getTrackData("https://files.test/page.mp3", undefined, undefined, { direct }), { success: false, code: "unsupported-link" });
});
