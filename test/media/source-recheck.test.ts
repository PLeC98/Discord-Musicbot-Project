// src/media/source-recheck.ts — 캐시한 음원의 원본이 지금 어떤가(같음 · 바뀜 · 사라짐 · 모름). 잰 값으로(2026-10-22, 비공개 시험 영상)

import { test } from "node:test";
import assert from "node:assert/strict";
import { recheck, type RecheckDeps } from "../../src/media/source-recheck.ts";
import { codedError } from "../../src/rules/error-kind.ts";

const fmt = (itag: number, lmt: string, dur: string, audio = true) => ({ format_id: String(itag), url: `https://rr1.googlevideo.com/videoplayback?itag=${itag}&lmt=${lmt}&dur=${dur}`, acodec: audio ? "opus" : "none", vcodec: audio ? "none" : "avc1" });
// 편집 전 · 30초 자른 뒤 · 이어서 오디오만 넣은 뒤(길이 그대로)
const BEFORE = [fmt(251, "1788794896364049", "300.441"), fmt(140, "1788794897550774", "300.466"), fmt(160, "1788794908847489", "300.399", false)];
const TRIMMED = [fmt(251, "1792606059000000", "270.341"), fmt(140, "1792606058000000", "270.373"), fmt(160, "1792606061000000", "270.333", false)];
const RESOUNDED = [fmt(251, "1792606387000000", "270.341"), fmt(140, "1792606386000000", "270.373"), fmt(160, "1792606377000000", "270.333", false)];

const never = () => Promise.reject(new Error("부르면 안 된다"));
const deps = (over: Partial<RecheckDeps>): RecheckDeps => ({ youtubeInfo: never, soundcloudStream: never, directHead: never, ...over });
const YT = "https://www.youtube.com/watch?v=ppIDyKeeRxs";

test("유튜브: 적어 둔 lmt 가 지금 포맷 중 하나와 같으면 같음(받은 itag 와 지금 고른 itag 가 달라도)", async () => {
  const got = await recheck(YT, { version: "lmt:1788794897550774", durationSec: 300.4 }, deps({ youtubeInfo: async () => ({ formats: BEFORE }) }));
  assert.deepEqual(got, { kind: "same", version: "lmt:1788794897550774" });
});

test("유튜브: 자르면 바뀜 + 길이도 다르다, 오디오만 바꾸면 바뀜 + 길이는 같다", async () => {
  const trimmed = await recheck(YT, { version: "lmt:1788794896364049", durationSec: 300.44 }, deps({ youtubeInfo: async () => ({ formats: TRIMMED }) }));
  assert.equal(trimmed.kind, "changed");
  assert.equal(trimmed.kind === "changed" && trimmed.durationChanged, true);
  const resounded = await recheck(YT, { version: "lmt:1792606059000000", durationSec: 270.34 }, deps({ youtubeInfo: async () => ({ formats: RESOUNDED }) }));
  assert.equal(resounded.kind === "changed" && resounded.durationChanged, false);
  assert.ok(resounded.kind === "changed" && resounded.version.startsWith("lmt:179260"));
});

test("유튜브: 내려간 영상은 사라짐, 일시 오류는 모름, 적어 둔 버전이 없으면 모름", async () => {
  const removed = new Error("ERROR: [youtube] ppIDyKeeRxs: Video unavailable. This video has been removed by the uploader");
  const gone = await recheck(YT, { version: "lmt:1", durationSec: 1 }, deps({ youtubeInfo: async () => Promise.reject(removed) }));
  assert.deepEqual(gone, { kind: "gone", code: "unavailable-contents" });
  const flaky = await recheck(YT, { version: "lmt:1", durationSec: 1 }, deps({ youtubeInfo: async () => Promise.reject(new Error("ERROR: unable to download webpage: timed out")) }));
  assert.equal(flaky.kind, "unknown");
  const blank = await recheck(YT, { version: null, durationSec: null }, deps({ youtubeInfo: async () => ({ formats: BEFORE }) }));
  assert.equal(blank.kind, "unknown");
});

test("사운드클라우드: 음원 파일 id 로 견주고, 미리듣기만 남았으면 사라짐", async () => {
  const SC = "https://soundcloud.com/forss/flickermood";
  const stream = (file: string) => async () => ({ url: `https://playback.media-streaming.soundcloud.cloud/${file}/aac_160k/u/playlist.m3u8?x=1` });
  assert.deepEqual(await recheck(SC, { version: "file:cWHNerOLlkUq", durationSec: 1 }, deps({ soundcloudStream: stream("cWHNerOLlkUq") })), { kind: "same", version: "file:cWHNerOLlkUq" });
  assert.deepEqual(await recheck(SC, { version: "file:cWHNerOLlkUq", durationSec: 1 }, deps({ soundcloudStream: stream("NEWfile12345") })), { kind: "changed", version: "file:NEWfile12345", durationChanged: null });
  const preview = await recheck(SC, { version: "file:cWHNerOLlkUq", durationSec: 1 }, deps({ soundcloudStream: async () => Promise.reject(codedError("sc-preview-only", "미리듣기")) }));
  assert.deepEqual(preview, { kind: "gone", code: "sc-preview-only" });
});

test("직접 링크: 머리로 견주고(ETag 우선), 404 · 410 · 웹 페이지는 사라짐, 403 · 5xx 는 모름", async () => {
  const URL = "https://a.animethemes.moe/AttackNo1-ED1.ogg";
  const stored = { version: 'etag="472613ec";modified=Sun, 25 Jun 2023 04:33:06 GMT;length=2321206', durationSec: 1 };
  const head = (headers: Record<string, unknown>) => async () => ({ headers });
  assert.equal((await recheck(URL, stored, deps({ directHead: head({ etag: '"472613ec"', "content-range": "bytes 0-0/2321206" }) }))).kind, "same");
  const changed = await recheck(URL, stored, deps({ directHead: head({ etag: '"ffff"', "last-modified": "Sun, 25 Jun 2023 04:33:06 GMT", "content-range": "bytes 0-0/2321206" }) }));
  assert.equal(changed.kind, "changed", "날짜 · 크기가 같아도 ETag 가 다르면 바뀜");
  assert.deepEqual(await recheck(URL, stored, deps({ directHead: head({ "content-type": "text/html; charset=utf-8" }) })), { kind: "gone", code: "unsupported-link" });
  const status = (n: number) => async () => Promise.reject(Object.assign(new Error(`요청 실패: HTTP ${n}`), { status: n }));
  assert.deepEqual(await recheck(URL, stored, deps({ directHead: status(410) })), { kind: "gone", code: "direct-unavailable" });
  assert.equal((await recheck(URL, stored, deps({ directHead: status(403) }))).kind, "unknown", "만료된 서명 주소 · 막힘");
  assert.equal((await recheck(URL, stored, deps({ directHead: status(503) }))).kind, "unknown");
});
