// src/store/trackLookup.ts — 링크 장부의 제목 출처와 음원 주소 갱신. 임시 DB 로 진짜 SQL 을 돈다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import tempStore from "../helpers/tempStore.js";
import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const { openTempStore } = tempStore;

const store = openTempStore("track-lookup-");
after(() => store.close());
const audioCache = await import("../../src/store/audioCache.ts");
const trackLookup = await import("../../src/store/trackLookup.ts");

// ── 제목 출처 (title_verified) ───────────────────────────────
// 재생목록 페이지가 주는 제목은 같은 영상인데도 다를 수 있다. 그걸로 확인된 제목을 덮으면
// 한 번 고친 것이 도로 낡은 값으로 돌아간다 — 이 왕복이 실제 증상이었다.

const TL_URL = "https://www.youtube.com/watch?v=titletest";

test("확인되지 않은 제목은 확인된 제목을 덮지 못한다", () => {
  trackLookup.recordTrackLookup({ requestKey: TL_URL, pageUrl: TL_URL, audioUrl: "https://www.youtube.com/watch?v=titletest", platform: "youtube", title: "정식 제목", artist: "채널" }, { verified: true });
  assert.equal(trackLookup.getVerifiedTitle(TL_URL), "정식 제목");

  trackLookup.recordTrackLookup({ requestKey: TL_URL, pageUrl: TL_URL, audioUrl: "https://www.youtube.com/watch?v=titletest", platform: "youtube", title: "낡은 재생목록 제목", artist: "채널" });
  assert.equal(trackLookup.getVerifiedTitle(TL_URL), "정식 제목", "재생목록 제목이 덮으면 안 된다");
});

test("확인된 제목은 확인된 제목으로 갱신된다 (영상 제목이 실제로 바뀐 경우)", () => {
  trackLookup.recordTrackLookup({ requestKey: TL_URL, pageUrl: TL_URL, audioUrl: "https://www.youtube.com/watch?v=titletest", platform: "youtube", title: "새 정식 제목", artist: "채널" }, { verified: true });
  assert.equal(trackLookup.getVerifiedTitle(TL_URL), "새 정식 제목");
});

test("확인된 적 없는 URL은 getVerifiedTitle이 null", () => {
  const url = "https://www.youtube.com/watch?v=unverif";
  trackLookup.recordTrackLookup({ requestKey: url, pageUrl: url, audioUrl: "https://www.youtube.com/watch?v=unverif", platform: "youtube", title: "첫 제목" });
  trackLookup.recordTrackLookup({ requestKey: url, pageUrl: url, audioUrl: "https://www.youtube.com/watch?v=unverif", platform: "youtube", title: "둘째 제목" });
  assert.equal(trackLookup.getVerifiedTitle(url), null, "미확인 제목은 여기 안 걸린다");
});

test("음원 주소는 출처와 무관하게 항상 갱신된다", () => {
  const url = "https://www.youtube.com/watch?v=remap";
  trackLookup.recordTrackLookup({ requestKey: url, pageUrl: url, audioUrl: "https://www.youtube.com/watch?v=old", platform: "youtube", title: "제목" }, { verified: true });
  trackLookup.recordTrackLookup({ requestKey: url, pageUrl: url, audioUrl: "https://www.youtube.com/watch?v=new", platform: "youtube", title: "낡은 제목" });
  assert.equal(trackLookup.getAudioUrl(url), "https://www.youtube.com/watch?v=new", "재검색 결과가 장부를 갱신해야 한다");
  assert.equal(trackLookup.getVerifiedTitle(url), "제목", "제목은 지켜진다");
});

test("행이 없는 URL은 getVerifiedTitle이 null", () => {
  assert.equal(trackLookup.getVerifiedTitle("https://www.youtube.com/watch?v=nosuch"), null);
});

// ── 두 걸음으로 캐시 찾기 ─────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import * as storeDb from "../../src/store/db.ts";

function cacheFile(key: string) {
  const file = audioCache.getFilePath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "opus");
  audioCache.recordDownloadStart(key, { title: "영상 제목" });
  audioCache.recordDownloadComplete(key, file, 4, { title: "영상 제목" }, { durationSec: 90 });
  return file;
}

test("캐시 찾기: 장부의 음원 주소에서 열쇠를 계산해 audio_cache 를 본다. 링크 칸 셋이 그대로 돌아온다", () => {
  const file = cacheFile("yt:twostepvid");
  trackLookup.recordTrackLookup({ requestKey: "amq:77", pageUrl: "https://anilist.co/anime/77", audioUrl: "https://www.youtube.com/watch?v=twostepvid", platform: "anisongdb", title: "곡", artist: "가수" });

  const hit = trackLookup.resolveFromCache("amq:77");
  assert.equal(hit.hit, true);
  assert.equal(hit.filePath, file);
  assert.equal(hit.audioKey, "yt:twostepvid");
  assert.deepEqual([hit.track.pageUrl, hit.track.requestKey, hit.track.audioUrl], ["https://anilist.co/anime/77", "amq:77", "https://www.youtube.com/watch?v=twostepvid"]);
  assert.equal(hit.track.title, "곡", "장부의 표시 이름이 앞선다");
});

test("퇴거로 audio_cache 행이 지워져도 장부는 남는다. 다음에 받으면 같은 음원을 쓴다", () => {
  const file = cacheFile("yt:evictedvid");
  trackLookup.recordTrackLookup({ requestKey: "https://open.spotify.com/track/ev1", pageUrl: "https://open.spotify.com/track/ev1", audioUrl: "https://www.youtube.com/watch?v=evictedvid", platform: "spotify", title: "곡" });

  fs.unlinkSync(file);
  storeDb.get().prepare("DELETE FROM audio_cache WHERE audio_key = ?").run("yt:evictedvid"); // evict() 가 한 줄마다 하는 일

  assert.equal(trackLookup.resolveFromCache("https://open.spotify.com/track/ev1").hit, false, "파일이 없으니 캐시로는 못 튼다");
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/track/ev1?si=x"), "https://www.youtube.com/watch?v=evictedvid", "검색은 건너뛴다");
});

test("음원 주소가 없는 곡은 장부에 적지 않는다(스포티파이가 영상을 찾기 전)", () => {
  trackLookup.recordTrackLookup({ requestKey: "https://open.spotify.com/track/noaudio", pageUrl: "https://open.spotify.com/track/noaudio", platform: "spotify", title: "곡" });
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/track/noaudio"), null);
});

test("모양이 틀린 장부 줄은 없는 것으로 본다", () => {
  storeDb.get().prepare("INSERT INTO track_lookup (request_key, page_url, audio_url, platform, title_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, 1)").run("https://open.spotify.com/track/badrow", "https://open.spotify.com/track/badrow", "", "spotify");
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/track/badrow"), null, "빈 음원 주소");
  assert.equal(trackLookup.resolveFromCache("https://open.spotify.com/track/badrow").hit, false);
});

test("자동재생이 보는 장부(route.REAL.known): 받아 둔 파일이 있으면 길이까지, 없으면 음원 주소만", () => {
  const { known } = require("../../src/autoplay/route").REAL;
  cacheFile("yt:knowncache");
  trackLookup.recordTrackLookup({ requestKey: "amq:801", pageUrl: "https://anilist.co/anime/8", audioUrl: "https://www.youtube.com/watch?v=knowncache", platform: "anisongdb", title: "곡" });
  trackLookup.recordTrackLookup({ requestKey: "amq:802", pageUrl: "https://anilist.co/anime/8", audioUrl: "https://www.youtube.com/watch?v=notcached01", platform: "anisongdb", title: "곡2" });

  assert.deepEqual(known("amq:801"), { audioUrl: "https://www.youtube.com/watch?v=knowncache", durationSec: 90 });
  assert.deepEqual(known("amq:802"), { audioUrl: "https://www.youtube.com/watch?v=notcached01" });
  assert.equal(known("amq:803"), null);
});
