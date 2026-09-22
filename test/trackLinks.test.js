"use strict";

// 트랙의 링크 칸과 캐시 장부의 지금 동작을 고정한다(구조 리팩터링 0단계).
//
// 여기 적힌 것은 대부분 고칠 동작이다. 3단계(트랙 모델)가 요청 열쇠 · 페이지 링크 칸을 세우면서 답을 바꾼다.
// 그때 이 테스트를 새 답으로 고치고, 어느 답이 왜 바뀌었는지는 그 커밋이 적는다.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "track-links-"));
let CacheManager;

before(() => {
  CacheManager = require("../src/CacheManager");
  CacheManager._cacheDir = path.join(TMP, "audio_cache");
  CacheManager.initialize(path.join(TMP, "cache.db"));
});

after(() => {
  CacheManager?.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// 받아 둔 곡 하나. 파일과 audio_cache 행을 같이 만든다
function seed(key, track) {
  const file = CacheManager.getFilePath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "opus");
  CacheManager.recordDownloadStart(key, track);
  CacheManager.recordDownloadComplete(key, file, 4, track, { durationSec: 90 });
  return file;
}

test("세션 복원: 유튜브로 올라간 음원 곡은 페이지 링크가 남고, 음원으로 떨어진 곡은 잃는다", () => {
  const { PlayerSessionStore, createTables } = require("../src/playerSessionStore");
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  createTables(db);
  const store = new PlayerSessionStore(db);
  store.saveSession("g1", { voiceChannelId: "v", textChannelId: "t", volume: 100, loop: "off", autoplay: "x", pausedManual: false, positionMs: 0, startOffsetMs: 0, requesterId: "u" });

  const page = "https://anilist.co/anime/1";
  const toYoutube = { title: "A", artist: "가수", platform: "anisongdb", url: page, youtubeUrl: "https://www.youtube.com/watch?v=v1", audioSourceKey: "yt:v1", id: "amq:1", addedAt: 1 };
  const toFile = { title: "B", artist: "가수", platform: "anisongdb", url: "https://nawdist.animemusicquiz.com/a.mp3", webUrl: page, audioSourceKey: "dl:abc", id: "amq:2", addedAt: 2 };
  store.append("g1", [toYoutube, toFile]);

  const [a, b] = store.load("g1").queue;
  const shown = (t) => t.webUrl || t.url; // 임베드가 쓰는 규칙
  assert.equal(shown(a), page, "url 칸에 페이지가 있어 살아남는다");
  assert.equal(b.webUrl, undefined, "webUrl 은 저장하는 칸이 없다");
  assert.equal(shown(b), "https://nawdist.animemusicquiz.com/a.mp3");
  db.close();
});

test("음원 곡의 url 에 페이지를 넣으면 재생도 받기도 못 한다", async () => {
  const TrackResolver = require("../src/TrackResolver");
  const DirectLink = require("../src/DirectLink");
  const base = { title: "곡", platform: "anisongdb", audioSourceKey: "dl:abc", id: "amq:48944" };

  const audio = { ...base, url: "https://nawdist.animemusicquiz.com/abc.mp3" };
  assert.deepEqual(await TrackResolver.getStream(audio), { url: audio.url, platform: "direct", httpHeaders: {} });
  assert.equal(DirectLink.isDirectAudioLink(audio.url), true);

  const page = { ...base, url: "https://anilist.co/anime/21827" };
  await assert.rejects(TrackResolver.getStream(page), /지원되지 않는 플랫폼: anisongdb/);
  assert.equal(DirectLink.isDirectAudioLink(page.url), false, "다운로드의 직접 링크 갈래가 첫 관문에서 막힌다");
});

test("장부 열쇠에 작품 페이지가 들어가면 같은 작품의 두 곡이 한 칸을 덮어쓴다", () => {
  const page = "https://anilist.co/anime/150672";
  const fatal = { title: "Fatal", artist: "GEMN", url: page, platform: "anisongdb", audioSourceKey: "yt:fatalfatal1" };
  const burning = { title: "Burning", artist: "Hitsujibungaku", url: page, platform: "anisongdb", audioSourceKey: "yt:burningburn" };
  seed(fatal.audioSourceKey, fatal);
  seed(burning.audioSourceKey, burning);

  CacheManager.recordTrackLookup(page, "anisongdb", fatal.audioSourceKey, fatal.title, fatal.artist, null);
  CacheManager.recordTrackLookup(page, "anisongdb", burning.audioSourceKey, burning.title, burning.artist, null);

  const hit = CacheManager.resolveFromCache(page);
  assert.equal(hit.hit, true);
  assert.equal(hit.audioSourceKey, "yt:burningburn", "Fatal 의 링크를 넣어도 Burning 이 나온다");
  assert.equal(hit.track.title, "Burning");
  const pointing = CacheManager.db.prepare("SELECT COUNT(*) c FROM track_lookup WHERE audio_source_key = ?").get(fatal.audioSourceKey).c;
  assert.equal(pointing, 0, "Fatal 파일은 가리키는 행이 없는 채로 남는다");
  assert.equal(CacheManager.db.prepare("SELECT status FROM audio_cache WHERE audio_source_key = ?").get(fatal.audioSourceKey).status, "cached");
});

test("장부 조회 앞의 링크 다듬기는 유튜브만 한다", () => {
  const cases = [
    ["https://youtu.be/Lsv4wg9YU8Y?si=AbCdEf", "https://www.youtube.com/watch?v=Lsv4wg9YU8Y"],
    ["https://www.youtube.com/watch?v=Lsv4wg9YU8Y&list=PLxyz&index=3", "https://www.youtube.com/watch?v=Lsv4wg9YU8Y"],
    ["https://music.youtube.com/watch?v=Lsv4wg9YU8Y&si=AbCdEf", "https://www.youtube.com/watch?v=Lsv4wg9YU8Y"],
    // 아래는 그대로 둔다. 장부에는 깨끗한 주소로 적히므로 공유 링크로는 첫 지름길을 늘 놓친다
    ["https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj?si=0a1b2c", "https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj?si=0a1b2c"],
    ["https://open.spotify.com/intl-ko/track/2joT0CjcGqc1fr8Fvk7itj", "https://open.spotify.com/intl-ko/track/2joT0CjcGqc1fr8Fvk7itj"],
    ["https://soundcloud.com/artist/track-name?si=abc&utm_source=clipboard", "https://soundcloud.com/artist/track-name?si=abc&utm_source=clipboard"],
  ];
  for (const [input, expected] of cases) assert.equal(CacheManager._normalizeSourceUrl(input), expected, input);

  const clean = "https://open.spotify.com/track/2joT0CjcGqc1fr8Fvk7itj";
  seed("yt:spotifyshar", { title: "곡" });
  CacheManager.recordTrackLookup(clean, "spotify", "yt:spotifyshar", "곡", "가수", null);
  assert.equal(CacheManager.getResolvedKey(`${clean}?si=0a1b2c`), null, "공유 링크는 장부와 안 맞는다");
  assert.equal(CacheManager.getResolvedKey(clean), "yt:spotifyshar");
});

test("퇴거가 audio_cache 행을 지우면 외래 키 연쇄로 링크 장부 행도 지워진다", () => {
  const spotify = "https://open.spotify.com/track/evictcascade";
  const key = "yt:evictcasca";
  const file = seed(key, { title: "곡", url: spotify, platform: "spotify" });
  CacheManager.recordTrackLookup(spotify, "spotify", key, "곡", "가수", null);
  assert.equal(CacheManager.getResolvedKey(spotify), key);

  // evict() 가 한 줄마다 하는 일 그대로
  fs.unlinkSync(file);
  CacheManager.db.prepare("DELETE FROM audio_cache WHERE audio_source_key = ?").run(key);

  assert.equal(CacheManager.getResolvedKey(spotify), null, "파일이 퇴거돼도 매핑은 알려준다는 주석과 반대");
  assert.equal(CacheManager.resolveFromCache(spotify).hit, false);
});
