"use strict";

// src/media/cacheDownload.js — 캐시 변환 옵션.
//
// 회귀 대상: `postprocessorArgs` 가 코덱을 못 박고 있었다. yt-dlp 의 ExtractAudio 는 소스 코덱을
// 보고 `-acodec copy`(이미 Opus) 또는 `-acodec libopus`(그 밖)를 스스로 고르는데, 우리 값이
// 그 뒤에 붙어 ffmpeg 에서 이겨 버렸다. 그래서 유튜브 251(Opus)까지 매번 다시 인코딩됐다.
// 상류에서 내려온 뒤 아무도 다시 보지 않은 설정이다.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { openTempStore } = require("../helpers/tempStore");
const TrackDownloader = require("../../src/media/cacheDownload");
const YouTube = require("../../src/sources/youtube/index");

/** `_performDownload` 가 yt-dlp 에 넘기는 옵션만 가로챈다 — 실제로 받지는 않는다. 받기 전에 캐시 행을 적으므로 임시 DB 를 연다 */
async function captureOptions() {
  const store = openTempStore("cache-transcode-");
  const real = YouTube.runYtDlp;
  let options = null;
  YouTube.runYtDlp = async (_url, build) => {
    options = build(false);
    throw new Error("여기까지만");
  };
  try {
    const downloader = new TrackDownloader({ guild: { id: "g" } });
    await downloader._performDownload({ audioUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa", platform: "youtube", title: "곡" }, "/tmp/없는경로.opus").catch(() => {});
  } finally {
    YouTube.runYtDlp = real;
    store.close();
  }
  return options;
}

test("캐시 변환은 코덱을 못 박지 않는다 — yt-dlp 가 소스를 보고 고른다", async () => {
  const options = await captureOptions();
  assert.ok(options, "옵션을 가로채지 못했습니다");

  const args = options.postprocessorArgs?.ffmpeg || [];
  assert.ok(!args.includes("-c:a") && !args.includes("-acodec"), `코덱을 못 박으면 251 이 다시 인코딩된다: ${args.join(" ")}`);
  assert.ok(!args.includes("libopus"), `libopus 를 적으면 리먹싱 판단을 덮는다: ${args.join(" ")}`);

  // 비트레이트는 남긴다 — 스트림 카피에는 무시되고, 진짜 변환이 필요한 AAC 소스에만 걸린다.
  // 빼면 그때 libopus 기본값(실측 95k)으로 떨어진다.
  assert.deepEqual(args, ["-b:a", "128k"]);

  assert.equal(options.extractAudio, true);
  assert.equal(options.audioFormat, "opus");
});
