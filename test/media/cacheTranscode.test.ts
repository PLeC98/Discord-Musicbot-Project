// src/media/cacheDownload.ts — 캐시 변환 옵션.
//
// 회귀 대상: `postprocessorArgs` 가 코덱을 못 박고 있었다. yt-dlp 의 ExtractAudio 는 소스 코덱을
// 보고 `-acodec copy`(이미 Opus) 또는 `-acodec libopus`(그 밖)를 스스로 고르는데, 우리 값이
// 그 뒤에 붙어 ffmpeg 에서 이겨 버렸다. 그래서 유튜브 251(Opus)까지 매번 다시 인코딩됐다.
// 상류에서 내려온 뒤 아무도 다시 보지 않은 설정이다.
//
// 옵션 객체가 아니라 yt-dlp 가 받는 인자로 본다. youtube-dl-exec 는 객체 값을 조용히 버린다.

import { test } from "node:test";
import assert from "node:assert/strict";

import tempStore from "../helpers/tempStore.js";
const { openTempStore } = tempStore;
import { TrackDownloader } from "../../src/media/cacheDownload.ts";
import * as YouTube from "../../src/sources/youtube/index.ts";
import youtubedl from "youtube-dl-exec";
import type { YtDlpFlags } from "../../src/sources/ytdlpSpawn.ts";
import type { Sources } from "../../src/media/cacheDownload.ts";

// exec 가 쓰는 인자 변환. 모듈에 있지만 타입 선언에는 빠져 있다
const { args: toArgv } = youtubedl as typeof youtubedl & { args(flags: YtDlpFlags): string[] };

/** `_performDownload` 가 yt-dlp 에 넘기는 옵션만 가로챈다 — 실제로 받지는 않는다. 받기 전에 캐시 행을 적으므로 임시 DB 를 연다 */
async function captureOptions(): Promise<YtDlpFlags | undefined> {
  const store = openTempStore("cache-transcode-");
  const seen: { options?: YtDlpFlags } = {};
  const youtube: Sources["youtube"] = {
    ...YouTube,
    runYtDlp: async (_url, build) => {
      seen.options = build(false);
      throw new Error("여기까지만");
    },
  };
  try {
    const downloader = new TrackDownloader({ guild: { id: "g" } }, { youtube });
    await downloader._performDownload({ audioUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa", platform: "youtube", title: "곡", requestKey: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }, "/tmp/없는경로.opus").catch(() => {});
  } finally {
    store.close();
  }
  return seen.options;
}

test("캐시 변환은 코덱을 못 박지 않는다 — yt-dlp 가 소스를 보고 고른다", async () => {
  const options = await captureOptions();
  assert.ok(options, "옵션을 가로채지 못했습니다");

  const argv = toArgv(options);
  const at = argv.indexOf("--postprocessor-args");
  assert.ok(at >= 0, `후처리 인자가 yt-dlp 에 가지 않는다: ${argv.join(" ")}`);
  const ppa = argv[at + 1];
  assert.ok(!/-c:a|-acodec/.test(ppa), `코덱을 못 박으면 251 이 다시 인코딩된다: ${ppa}`);
  assert.ok(!ppa.includes("libopus"), `libopus 를 적으면 리먹싱 판단을 덮는다: ${ppa}`);

  // 비트레이트는 남긴다 — 스트림 카피에는 무시되고, 진짜 변환이 필요한 AAC 소스에만 걸린다.
  // 빼면 그때 libopus 기본값(실측 95k)으로 떨어진다.
  assert.equal(ppa, "ffmpeg:-b:a 128k");

  assert.ok(argv.includes("--extract-audio"));
  assert.equal(argv[argv.indexOf("--audio-format") + 1], "opus");
});
