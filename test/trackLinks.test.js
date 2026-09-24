// 트랙의 링크 칸 셋(pageUrl · requestKey · audioUrl)과 링크 장부.
//
// 한 칸(url)이 보여 줄 링크 · 장부 열쇠 · 음원 주소를 다 하던 때 여기서 틀린 답을 고정해 두었고(리팩터링 0단계),
// 3단계가 칸을 가르면서 답을 바꿨다. 남은 것은 그 틀린 답이 다시 나오지 않게 하는 테스트다.

import fs from "node:fs";
import * as links from "../src/rules/links.ts";
import os from "node:os";
import path from "node:path";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { canonicalUrl } from "../src/rules/canonicalUrl.ts";
import { createRequire } from "node:module";

// 함수 안에서 부르는 것과 글자가 아닌 경로는 그대로 require 로
const require = createRequire(import.meta.url);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "track-links-"));
let audioCache, trackLookup;

before(() => {
  audioCache = require("../src/store/audioCache.ts");
  trackLookup = require("../src/store/trackLookup.ts");
  audioCache._cacheDir = path.join(TMP, "audio_cache");
  audioCache.initialize(path.join(TMP, "cache.db"));
});

after(() => {
  audioCache?.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
});

// 받아 둔 곡 하나. 파일과 audio_cache 행을 같이 만든다
function seed(key, track) {
  const file = audioCache.getFilePath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "opus");
  audioCache.recordDownloadStart(key, track);
  audioCache.recordDownloadComplete(key, file, 4, track, { durationSec: 90 });
  return file;
}

const watch = (id) => `https://www.youtube.com/watch?v=${id}`;

// 전에는 음원으로 떨어진 곡의 작품 페이지(webUrl)를 저장할 칸이 없어 복원 뒤 링크가 음원 파일로 바뀌었다
test("세션 복원: 유튜브로 올라간 곡도 음원으로 떨어진 곡도 작품 페이지 링크를 지킨다", () => {
  const { PlayerSessionStore } = require("../src/store/playerSessions.ts");
  const { createTables } = require("../src/store/db.ts");
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createTables(db);
  const store = new PlayerSessionStore(db);
  store.saveSession("g1", { voiceChannelId: "v", textChannelId: "t", volume: 100, loop: "off", autoplay: "x", pausedManual: false, positionMs: 0, startOffsetMs: 0, requesterId: "u" });

  const page = "https://anilist.co/anime/1";
  const toYoutube = { title: "A", artist: "가수", platform: "anisongdb", pageUrl: page, requestKey: "amq:1", audioUrl: watch("v1"), id: "amq:1", addedAt: 1 };
  const toFile = { title: "B", artist: "가수", platform: "anisongdb", pageUrl: page, requestKey: "amq:2", audioUrl: "https://nawdist.animemusicquiz.com/a.mp3", id: "amq:2", addedAt: 2 };
  store.append("g1", [toYoutube, toFile]);

  const [a, b] = store.load("g1").queue;
  assert.deepEqual([a.pageUrl, a.requestKey, a.audioUrl], [page, "amq:1", watch("v1")]);
  assert.deepEqual([b.pageUrl, b.requestKey, b.audioUrl], [page, "amq:2", "https://nawdist.animemusicquiz.com/a.mp3"]);
  db.close();
});

test("음원 곡은 페이지와 음원 주소를 따로 든다. 소리는 음원 주소에서만 온다", async () => {
  const streamUrl = require("../src/sources/streamUrl");
  const track = { title: "곡", platform: "anisongdb", id: "amq:48944", pageUrl: "https://anilist.co/anime/21827", requestKey: "amq:48944", audioUrl: "https://nawdist.animemusicquiz.com/abc.mp3" };
  assert.deepEqual(await streamUrl.getStream(track), { url: track.audioUrl, platform: "direct", httpHeaders: {} });

  // 음원 주소 자리에 페이지가 들어가면 받을 수 없다. 그래서 페이지는 제 칸에만 둔다
  await assert.rejects(streamUrl.getStream({ ...track, audioUrl: track.pageUrl }), /지원되지 않는 음원 주소/);
  assert.equal(links.isDirectAudioLink(track.pageUrl), false);
});

// 전에는 장부 열쇠가 작품 페이지라, 같은 작품의 OP 와 ED 가 한 줄을 두고 서로 덮었다(「Fatal」 링크를 넣으면 「Burning」)
test("장부: 같은 작품의 두 곡은 요청 열쇠가 달라 따로 산다. 작품 페이지는 열쇠가 아니다", () => {
  const page = "https://anilist.co/anime/150672";
  const fatal = { title: "Fatal", artist: "GEMN", platform: "anisongdb", pageUrl: page, requestKey: "amq:9001", audioUrl: watch("fatalfatal1") };
  const burning = { title: "Burning", artist: "Hitsujibungaku", platform: "anisongdb", pageUrl: page, requestKey: "amq:9002", audioUrl: watch("burningburn") };
  seed("yt:fatalfatal1", fatal);
  seed("yt:burningburn", burning);

  trackLookup.recordTrackLookup(fatal);
  trackLookup.recordTrackLookup(burning);

  assert.equal(trackLookup.resolveFromCache("amq:9001").track.title, "Fatal");
  assert.equal(trackLookup.resolveFromCache("amq:9002").track.title, "Burning");
  assert.equal(trackLookup.resolveFromCache(page).hit, false);
});

test("장부 조회 앞의 링크 다듬기: 공유 링크가 장부의 깨끗한 주소와 맞는다", () => {
  const cases = [
    ["https://youtu.be/Lsv4wg9YU8Y?si=AbCdEf", "https://www.youtube.com/watch?v=Lsv4wg9YU8Y"],
    ["https://www.youtube.com/watch?v=Lsv4wg9YU8Y&list=PLxyz&index=3", "https://www.youtube.com/watch?v=Lsv4wg9YU8Y"],
    ["https://music.youtube.com/watch?v=Lsv4wg9YU8Y&si=AbCdEf", "https://www.youtube.com/watch?v=Lsv4wg9YU8Y"],
    ["https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj?si=0a1b2c", "https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj"],
    ["https://open.spotify.com/intl-ko/track/2joT0CjcGqc1fr8Fvk7itj", "https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj"],
    ["https://soundcloud.com/artist/track-name?si=abc&utm_source=clipboard", "https://soundcloud.com/artist/track-name"],
  ];
  for (const [input, expected] of cases) assert.equal(canonicalUrl(input), expected, input);

  const clean = "https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj";
  seed("yt:spotifyshar", { title: "곡" });
  trackLookup.recordTrackLookup({ requestKey: clean, pageUrl: clean, audioUrl: watch("spotifyshar"), platform: "spotify", title: "곡", artist: "가수" });
  assert.equal(trackLookup.getAudioUrl(`${clean}?si=0a1b2c`), watch("spotifyshar"), "공유 링크도 장부와 맞는다");
  assert.equal(trackLookup.getAudioUrl("https://open.spotify.com/intl-ko/track/2joT0CjcGqc1fr8Fvk7itj?si=x"), watch("spotifyshar"), "지역 경로가 붙어도");
  assert.equal(trackLookup.resolveFromCache(`${clean}?si=0a1b2c`).hit, true, "받아 둔 파일로 바로 튼다");
});

// 전에는 외래 키 연쇄 삭제 때문에 퇴거가 장부까지 지웠다. "퇴거돼도 알려준다"는 주석과 반대였다
test("퇴거가 audio_cache 행을 지워도 링크 장부는 남는다", () => {
  const spotify = "https://open.spotify.com/track/evictcascade";
  const file = seed("yt:evictcasca", { title: "곡" });
  trackLookup.recordTrackLookup({ requestKey: spotify, pageUrl: spotify, audioUrl: watch("evictcasca"), platform: "spotify", title: "곡", artist: "가수" });

  // evict() 가 한 줄마다 하는 일 그대로
  fs.unlinkSync(file);
  audioCache.db.prepare("DELETE FROM audio_cache WHERE audio_key = ?").run("yt:evictcasca");

  assert.equal(trackLookup.getAudioUrl(spotify), watch("evictcasca"));
  assert.equal(trackLookup.resolveFromCache(spotify).hit, false);
});
