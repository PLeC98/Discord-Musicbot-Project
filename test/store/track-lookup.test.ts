// src/store/track-lookup.ts — 오디오 링크 데이터의 제목 출처와 음원 주소 갱신. 임시 DB 로 진짜 SQL 을 돈다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/temp-store.ts";

const store = openTempStore("track-lookup-");
after(() => store.close());
const audioCache = await import("../../src/store/audio-cache.ts");
const trackLookup = await import("../../src/store/track-lookup.ts");
const route = await import("../../src/autoplay/route.ts");

// ── 제목 출처 (title_verified) ───────────────────────────────
// 재생목록 페이지가 주는 제목은 같은 영상인데도 다를 수 있다. 그걸로 확인된 제목을 덮으면
// 한 번 고친 것이 도로 낡은 값으로 돌아간다.

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
  assert.equal(trackLookup.getAudioUrl(url), "https://www.youtube.com/watch?v=new", "재검색 결과가 링크 데이터를 갱신해야 한다");
  assert.equal(trackLookup.getVerifiedTitle(url), "제목", "제목은 지켜진다");
});

test("행이 없는 URL은 getVerifiedTitle이 null", () => {
  assert.equal(trackLookup.getVerifiedTitle("https://www.youtube.com/watch?v=nosuch"), null);
});

// ── 두 걸음으로 캐시 찾기 ─────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { cacheDb } from "../../src/store/cache-db.ts";

function cacheFile(key: string) {
  const file = audioCache.getFilePath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "opus");
  audioCache.recordDownloadStart(key, { title: "영상 제목" });
  audioCache.recordDownloadComplete(key, file, 4, { title: "영상 제목" }, { durationSec: 90 });
  return file;
}

test("캐시 찾기: 링크 데이터의 음원 주소에서 키를 계산해 audio_cache 를 본다. 링크 필드 셋이 그대로 돌아온다", () => {
  const file = cacheFile("yt:twostepvid");
  trackLookup.recordTrackLookup({ requestKey: "amq:77", pageUrl: "https://anilist.co/anime/77", audioUrl: "https://www.youtube.com/watch?v=twostepvid", platform: "anisongdb", title: "곡", artist: "가수" });

  const hit = trackLookup.resolveFromCache("amq:77");
  assert.equal(hit.hit, true);
  assert.equal(hit.filePath, file);
  assert.equal(hit.audioKey, "yt:twostepvid");
  assert.deepEqual([hit.track.pageUrl, hit.track.requestKey, hit.track.audioUrl], ["https://anilist.co/anime/77", "amq:77", "https://www.youtube.com/watch?v=twostepvid"]);
  assert.equal(hit.track.title, "곡", "링크 데이터의 표시 이름이 앞선다");
});

test("캐시 찾기: 링크 데이터와 캐시 모두 제목이 없으면 제목을 비워 둔다(null)", () => {
  const file = audioCache.getFilePath("yt:untitled01");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "opus");
  audioCache.recordDownloadStart("yt:untitled01", {});
  audioCache.recordDownloadComplete("yt:untitled01", file, 4, {}, { durationSec: 90 });
  trackLookup.recordTrackLookup({ requestKey: "amq:78", pageUrl: "https://anilist.co/anime/78", audioUrl: "https://www.youtube.com/watch?v=untitled01", platform: "anisongdb", title: null });

  const hit = trackLookup.resolveFromCache("amq:78");
  assert.equal(hit.hit, true);
  assert.equal(hit.track.title, null);
});

test("퇴거로 audio_cache 행이 삭제돼도 링크 데이터는 남는다. 다음에 다운로드하면 같은 음원을 쓴다", () => {
  const file = cacheFile("yt:evictedvid");
  trackLookup.recordTrackLookup({ requestKey: "https://open.spotify.com/track/ev1", pageUrl: "https://open.spotify.com/track/ev1", audioUrl: "https://www.youtube.com/watch?v=evictedvid", platform: "spotify", title: "곡" });

  fs.unlinkSync(file);
  cacheDb.get().prepare("DELETE FROM audio_cache WHERE audio_key = ?").run("yt:evictedvid"); // evict() 가 한 행마다 하는 일

  assert.equal(trackLookup.resolveFromCache("https://open.spotify.com/track/ev1").hit, false, "파일이 없으니 캐시로는 못 튼다");
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/track/ev1?si=x"), "https://www.youtube.com/watch?v=evictedvid", "검색은 건너뛴다");
});

test("음원 주소가 없는 곡은 링크 데이터에 적지 않는다(스포티파이가 영상을 찾기 전)", () => {
  trackLookup.recordTrackLookup({ requestKey: "https://open.spotify.com/track/noaudio", pageUrl: "https://open.spotify.com/track/noaudio", platform: "spotify", title: "곡" });
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/track/noaudio"), null);
});

test("모양이 틀린 링크 데이터 행은 없는 것으로 본다", () => {
  cacheDb.get().prepare("INSERT INTO track_lookup (request_key, page_url, audio_url, platform, title_verified) VALUES (?, ?, ?, ?, 0)").run("https://open.spotify.com/track/badrow", "https://open.spotify.com/track/badrow", "", "spotify");
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/track/badrow"), null, "빈 음원 주소");
  assert.equal(trackLookup.resolveFromCache("https://open.spotify.com/track/badrow").hit, false);
});

test("자동재생이 보는 링크 데이터(route.REAL.known): 캐시 파일이 있으면 길이까지, 없으면 음원 주소만", () => {
  const { known } = route.REAL;
  cacheFile("yt:knowncache");
  trackLookup.recordTrackLookup({ requestKey: "amq:801", pageUrl: "https://anilist.co/anime/8", audioUrl: "https://www.youtube.com/watch?v=knowncache", platform: "anisongdb", title: "곡" });
  trackLookup.recordTrackLookup({ requestKey: "amq:802", pageUrl: "https://anilist.co/anime/8", audioUrl: "https://www.youtube.com/watch?v=notcached01", platform: "anisongdb", title: "곡2" });

  assert.deepEqual(known("amq:801"), { audioUrl: "https://www.youtube.com/watch?v=knowncache", durationSec: 90 });
  assert.deepEqual(known("amq:802"), { audioUrl: "https://www.youtube.com/watch?v=notcached01" });
  assert.equal(known("amq:803"), null);
});

// ── 캐시한 음원의 길이 ───────────────────────────────────────

test("캐시한 음원의 길이: 음원 주소로, 주소가 없으면(스포티파이) 링크 데이터가 기억하는 음원으로 찾는다. 다운로드가 끝난 것만", () => {
  const yt = "https://www.youtube.com/watch?v=lenlenlen01";
  const sp = "https://open.spotify.com/track/lensp1";
  audioCache.recordDownloadStart("yt:lenlenlen01", { title: "곡", duration: 180 });
  assert.equal(trackLookup.knownAudioLength({ audioUrl: yt }), null, "다운로드 중이면 모른다(행의 길이는 곡이 준 값이다)");

  audioCache.recordDownloadComplete("yt:lenlenlen01", audioCache.getFilePath("yt:lenlenlen01"), 1, { title: "곡" }, { durationSec: 181.37 });
  assert.equal(trackLookup.knownAudioLength({ audioUrl: yt }), 181.37);

  assert.equal(trackLookup.knownAudioLength({ requestKey: sp }), null, "링크 데이터에 없으면 모른다");
  trackLookup.recordTrackLookup({ requestKey: sp, pageUrl: sp, audioUrl: yt, platform: "spotify", title: "곡" });
  assert.equal(trackLookup.knownAudioLength({ requestKey: sp }), 181.37);
});

// ── 링크 데이터를 쓰는 규칙(음원을 어떻게 알았나로 가른다) ──────────────────────
// 운영자가 지운 자동 결과를 반복 대기열 · 저장 세션의 옛 곡이 되살리지 않고, 직접 지정한 음원은 링크 데이터를 건드리지 않는다

const ROW = (requestKey: string) => ({ requestKey, pageUrl: requestKey, platform: "spotify", title: "곡", artist: "가수" });

test("직접 지정한 음원으로 튼 곡은 링크 데이터를 쓰지 않는다(해제하면 자동 결과로 돌아간다)", () => {
  const sp = "https://open.spotify.com/track/pinnedwrite";
  trackLookup.recordTrackLookup({ ...ROW(sp), audioUrl: "https://www.youtube.com/watch?v=autoresult1" });
  trackLookup.recordTrackLookup({ ...ROW(sp), audioUrl: "https://soundcloud.com/pinned/one", audioFoundBy: "pinned" });
  assert.equal(trackLookup.getAudioUrl(sp), "https://www.youtube.com/watch?v=autoresult1");
});

test("자동으로 찾은 결과는 넣은 뒤 그 곡을 ledger 로 표시한다. 요청 그대로인 곡은 표시하지 않는다", () => {
  const found = { ...ROW("https://open.spotify.com/track/markledger"), audioUrl: "https://www.youtube.com/watch?v=markledger1", audioFoundBy: "search" as const };
  trackLookup.recordTrackLookup(found);
  assert.equal(found.audioFoundBy, "ledger");
  assert.equal(trackLookup.getAudioUrl(found.requestKey), found.audioUrl);

  const given = { requestKey: "https://www.youtube.com/watch?v=givenvideo1", pageUrl: "https://www.youtube.com/watch?v=givenvideo1", audioUrl: "https://www.youtube.com/watch?v=givenvideo1", platform: "youtube", title: "곡", audioFoundBy: "given" as const };
  trackLookup.recordTrackLookup(given);
  assert.equal(given.audioFoundBy, "given");
});

test("링크 데이터에서 온 곡은 행을 새로 만들지 않고, 음원이 같을 때만 표시 열을 고친다", () => {
  const sp = "https://open.spotify.com/track/ledgerupdate";
  const old = { ...ROW(sp), audioUrl: "https://www.youtube.com/watch?v=ledgerold01", audioFoundBy: "ledger" as const };

  trackLookup.recordTrackLookup(old);
  assert.equal(trackLookup.getAudioUrl(sp), null, "운영자가 지웠으면(행 없음) 옛 곡이 되살리지 않는다");

  trackLookup.recordTrackLookup({ ...ROW(sp), audioUrl: "https://www.youtube.com/watch?v=ledgernew01" }); // 그새 새로 찾았다
  trackLookup.recordTrackLookup({ ...old, title: "옛 곡의 제목" }, { verified: true });
  assert.equal(trackLookup.getAudioUrl(sp), "https://www.youtube.com/watch?v=ledgernew01", "새로 찾은 음원을 옛 음원으로 덮지 않는다");
  assert.equal(trackLookup.getVerifiedTitle(sp), null, "다른 음원의 행은 표시 열도 고치지 않는다");

  trackLookup.recordTrackLookup({ ...ROW(sp), audioUrl: "https://www.youtube.com/watch?v=ledgernew01", title: "확인된 제목", audioFoundBy: "ledger" }, { verified: true });
  assert.equal(trackLookup.getVerifiedTitle(sp), "확인된 제목", "음원이 같으면 표시 열을 고친다");
});

test("자동 결과를 지운 뒤 같은 곡 객체를 다시 틀어도 그 결과가 되살아나지 않는다", () => {
  const track = { ...ROW("https://open.spotify.com/track/noresurrect"), audioUrl: "https://www.youtube.com/watch?v=noresurrect", audioFoundBy: "search" as const };
  trackLookup.recordTrackLookup(track); // 처음 틀 때 넣고 ledger 가 된다
  trackLookup.removeResolution(track.requestKey); // 운영자가 자동 검색 결과를 지웠다
  trackLookup.recordTrackLookup(track); // 반복 대기열로 다시 틀었다
  assert.equal(trackLookup.getAudioUrl(track.requestKey), null);
});

test("캐시 찾기로 만든 곡은 음원이 요청 그대로면 given, 다르면 ledger", () => {
  cacheFile("yt:foundbyhit");
  trackLookup.recordTrackLookup({ ...ROW("https://open.spotify.com/track/foundbyhit"), audioUrl: "https://www.youtube.com/watch?v=foundbyhit" });
  const spotify = trackLookup.resolveFromCache("https://open.spotify.com/track/foundbyhit");
  assert.equal(spotify.hit && spotify.track.audioFoundBy, "ledger");

  const yt = "https://www.youtube.com/watch?v=foundbyhit";
  trackLookup.recordTrackLookup({ requestKey: yt, pageUrl: yt, audioUrl: yt, platform: "youtube", title: "곡" });
  const video = trackLookup.resolveFromCache(yt);
  assert.equal(video.hit && video.track.audioFoundBy, "given");
});
