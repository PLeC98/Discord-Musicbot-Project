// 흐름 앞의 판정 셋(candidateKind · liveBlockReason · transportOf). 입력과 답만 적는다.
// convertPlan 과 errorKind 는 media/audioConvert.test.js · ui/errorClassification.test.js 가 표로 고정한다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateKind } from "../../src/rules/candidateKind.ts";
import { liveBlockReason } from "../../src/rules/liveBlockReason.ts";
import { transportOf, isHlsStream } from "../../src/rules/transportOf.ts";
import { isDeadInteraction } from "../../src/rules/deadInteraction.ts";
test("candidateKind: 유튜브 주소 > 가수 · 제목 > 음원, 아무것도 없으면 null", () => {
  assert.equal(candidateKind({ youtubeUrl: "u", artist: "a", title: "t", audioUrl: "x" }), "youtube");
  assert.equal(candidateKind({ artist: "a", title: "t", audioUrl: "x" }), "search");
  assert.equal(candidateKind({ title: "t", audioUrl: "x" }), "audio", "가수가 없으면 찾지 않는다");
  assert.equal(candidateKind({ title: "t" }), null);
});

test("liveBlockReason: 라이브가 아니면 null, 예정이면 upcoming, ffmpeg 능력은 필요할 때만 묻는다", () => {
  let asked = 0;
  const ready = (ok) => ({
    ffmpegReady: () => {
      asked++;
      return ok;
    },
  });
  assert.equal(liveBlockReason({ isLive: false }, ready(false)), null);
  assert.equal(liveBlockReason(null, ready(false)), null);
  assert.equal(liveBlockReason({ isLive: true, liveStatus: "is_upcoming" }, ready(true)), "live-upcoming");
  assert.equal(asked, 0, "라이브로 트는 곡이 아니면 ffmpeg 를 띄워 보지 않는다");
  assert.equal(liveBlockReason({ isLive: true, liveStatus: "is_live" }, ready(false)), "live-no-ffmpeg");
  assert.equal(liveBlockReason({ isLive: true, liveStatus: "is_live" }, ready(true)), null);
  assert.equal(asked, 2);
});

test("transportOf: 받아서 흘릴 수 없는 것만 url, 캐시 파일이 있으면 file, 나머지는 pipe. 라이브는 캐시하지 않는다", () => {
  const hls = { protocol: "m3u8_native" };
  assert.deepEqual(transportOf({ file: null, streamUrl: "https://x/a.m3u8", streamInfo: { ...hls, liveStatus: "is_live" } }), { via: "url", live: true, cacheable: false, list: "hls" });
  assert.deepEqual(transportOf({ file: null, streamUrl: "https://x/a.m3u8", streamInfo: hls }), { via: "url", live: false, cacheable: true, list: "hls" });
  assert.deepEqual(transportOf({ file: "/c/a.opus", streamUrl: "https://x/a.m3u8", streamInfo: hls }), { via: "file", live: false, cacheable: true });
  assert.deepEqual(transportOf({ file: null, streamUrl: "https://x/a.webm", streamInfo: { protocol: "https" } }), { via: "pipe", live: false, cacheable: true });
  assert.deepEqual(transportOf({ file: null, streamUrl: null, streamInfo: { stream: {}, ...hls } }), { via: "pipe", live: false, cacheable: true }, "주소가 없으면 url 이 아니다");
  // DASH 도 파이프에 안 담긴다. 조각 목록이다
  assert.deepEqual(transportOf({ file: null, streamUrl: "https://x/a.mpd", streamInfo: { protocol: "http_dash_segments" } }), { via: "url", live: false, cacheable: true, list: "dash" });
  assert.equal(transportOf({ file: null, streamUrl: "https://x/a", streamInfo: { protocol: "ism" } }).list, "other", "모르는 방식도 받아서 흘릴 수는 없다");
  assert.equal(transportOf({ file: null, streamUrl: "https://x/a.mp3", streamInfo: { protocol: "http" } }).via, "pipe");
  assert.equal(transportOf({ file: null, streamUrl: "https://x/a.mp3", streamInfo: { platform: "direct" } }).via, "pipe", "방식을 모르는 직접 링크");
  assert.equal(isHlsStream({ protocol: "http_dash_segments" }), false);
  assert.equal(isHlsStream("m3u8"), false, "서술자가 객체가 아니면 아니다");
});

test("죽은 상호작용: 토큰 만료·중복 응답만 참", () => {
  assert.equal(isDeadInteraction({ code: 10062 }), true);
  assert.equal(isDeadInteraction({ code: 40060 }), true);
  assert.equal(isDeadInteraction({ code: 50013 }), false);
  assert.equal(isDeadInteraction(new Error("boom")), false);
  assert.equal(isDeadInteraction(null), false);
});
