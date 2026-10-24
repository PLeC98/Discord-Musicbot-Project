// src/dashboard/track-cache.ts — 캐시 DB 화면의 읽기 · 쓰기 · 값 검사. 표 셋은 cache.db 의 표를 음원 키로 이은 것이고,
// 쓰기는 모두 검사한 뒤 조작마다 화면이 본 값(expect)과 대조해 결과를 낸다. 바뀜 번호는 cache-db 의 트리거가 센다.

import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AUDIO_CACHE_PARTS_DEFAULT } from "../../src/rules/audio-cache-parts.ts";
import { openTempStore } from "../helpers/temp-store.ts";

const store = openTempStore("track-cache-");
after(() => store.close());
const trackCache = await import("../../src/dashboard/track-cache.ts");
const { trackCacheSearch } = await import("../../src/dashboard/contract/track-cache.ts");
const { cacheRevision } = await import("../../src/store/cache-db.ts");
const audioCache = await import("../../src/store/audio-cache.ts");
const pinnedSources = await import("../../src/store/pinned-sources.ts");
const sourceChecks = await import("../../src/store/source-checks.ts");
const externalCaches = await import("../../src/store/external-caches.ts");
const { audioKeyOf } = await import("../../src/rules/audio-key-of.ts");
import type { TrackCacheQuery, TrackCacheTable, TrackRequestRow, TrackFileRow } from "../../src/dashboard/contract/track-cache.ts";

const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const MB = 1024 * 1024;
const SPOTIFY = "https://open.spotify.com/track/1111111111111111111111";
const LASTFM = "https://www.last.fm/music/A/_/B";
const SPOTIFY_PIN_ONLY = "https://open.spotify.com/track/2222222222222222222222";
const SC = "https://soundcloud.com/artist/song";
const DIRECT = "https://cdn.example.net/a.mp3";

function ledger(requestKey: string, audioUrl: string, platform: string, title: string) {
  store.db().prepare("INSERT INTO track_lookup (request_key, page_url, audio_url, platform, display_title, display_artist) VALUES (?, ?, ?, ?, ?, ?)").run(requestKey, requestKey, audioUrl, platform, title, "가수");
}
function file(audioKey: string, { status = "cached", size = MB, plays = 1, last = null as number | null, downloaded = 100 as number | null } = {}) {
  store.db().prepare("INSERT INTO audio_cache (audio_key, status, file_size_bytes, play_count, last_played_at, downloaded_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 0)").run(audioKey, status, size, plays, last, downloaded);
}

beforeEach(() => {
  for (const table of ["track_lookup", "pinned_sources", "audio_cache", "age_restricted", "source_checks"]) store.db().prepare(`DELETE FROM ${table}`).run();
  ledger(yt("aaaaaaaaaa1"), yt("aaaaaaaaaa1"), "youtube", "하나");
  file("yt:aaaaaaaaaa1", { size: 5 * MB, plays: 3, last: 3000 });
  // 스포티파이 · Last.fm 이 같은 음원(캐시 파일 하나를 함께 씀)
  ledger(SPOTIFY, yt("aaaaaaaaaa2"), "spotify", "둘");
  ledger(LASTFM, yt("aaaaaaaaaa2"), "lastfm", "둘");
  file("yt:aaaaaaaaaa2", { size: 2 * MB, plays: 9, last: 1000 });
  // 직접 지정한 음원만(링크 데이터 없음)
  pinnedSources.setPin(SPOTIFY_PIN_ONLY, SC, 500);
  sourceChecks.recordCheck(audioKeyOf(SC)!, { ok: true, at: 600 });
  // 지정한 행: 링크 데이터의 자동 결과는 그대로, 쓰는 음원은 지정한 것(연령 제한 · 실패한 재생 테스트)
  ledger(yt("aaaaaaaaaa3"), yt("aaaaaaaaaa3"), "youtube", "셋");
  pinnedSources.setPin(yt("aaaaaaaaaa3"), yt("aaaaaaaaaa4"), 700);
  store.db().prepare("INSERT INTO age_restricted (video_id, marked_at) VALUES ('aaaaaaaaaa4', 800)").run();
  sourceChecks.recordCheck("yt:aaaaaaaaaa4", { ok: false, code: "unavailable-contents", at: 900 });
  // 자동재생 키 · 직접 링크 음원
  ledger("amq:1", DIRECT, "anisongdb", "넷");
  file(audioKeyOf(DIRECT)!, { status: "error", size: null as unknown as number, plays: 0, downloaded: null });
  // 요청이 가리키지 않는 파일 · 되돌릴 수 없는 직접 링크 파일 · 연령 제한만
  file("yt:aaaaaaaaaa5", { plays: 2, last: 2000 });
  file("dl:0123456789abcdef0123456789abcdef");
  store.db().prepare("INSERT INTO age_restricted (video_id, marked_at) VALUES ('aaaaaaaaaa9', 50)").run();
});

function query<T extends TrackCacheTable>(table: T, more: Partial<Omit<Extract<TrackCacheQuery, { table: T }>, "table">> = {}): TrackCacheQuery {
  return { table, filters: {}, q: "", sort: [], offset: 0, limit: 200, ...more } as TrackCacheQuery;
}
function page(q: TrackCacheQuery) {
  const result = trackCache.read(q);
  assert.ok(result.ok, JSON.stringify(result));
  return result.page;
}
const requests = (q = query("requests")) => page(q).rows as TrackRequestRow[];
const byKey = (rows: TrackRequestRow[], key: string) => rows.find((row) => row.requestKey === key)!;

test("요청 표: 링크 데이터 ∪ 직접 지정한 음원을 쓰는 음원의 음원 키로 캐시 파일 · 연령 제한 · 재생 테스트에 잇는다", () => {
  const rows = requests();
  assert.equal(rows.length, 6);

  const plain = byKey(rows, yt("aaaaaaaaaa1"));
  assert.deepEqual([plain.audioKey, plain.file, plain.size, plain.plays, plain.lastPlayedAt, plain.downloadedAt, plain.sameAsRequest, plain.pinnedAt, plain.sharedBy], ["yt:aaaaaaaaaa1", "cached", 5 * MB, 3, 3000, 100, true, null, 1]);

  assert.equal(byKey(rows, SPOTIFY).sharedBy, 2, "같은 캐시 파일을 쓰는 요청 수");
  assert.equal(byKey(rows, SPOTIFY).sameAsRequest, false);

  const pinOnly = byKey(rows, SPOTIFY_PIN_ONLY);
  assert.deepEqual([pinOnly.platform, pinOnly.title, pinOnly.audioUrl, pinOnly.ledgerAudioUrl, pinOnly.pinnedAt, pinOnly.file, pinOnly.check], ["spotify", null, SC, null, 500, "none", { ok: true, at: 600 }]);

  const pinned = byKey(rows, yt("aaaaaaaaaa3"));
  assert.deepEqual([pinned.audioUrl, pinned.ledgerAudioUrl, pinned.ageMarkedAt, pinned.check, pinned.sameAsRequest], [yt("aaaaaaaaaa4"), yt("aaaaaaaaaa3"), 800, { ok: false, code: "unavailable-contents", at: 900 }, false]);

  const direct = byKey(rows, "amq:1");
  assert.deepEqual([direct.audioKey?.slice(0, 3), direct.file, direct.size, direct.downloadedAt], ["dl:", "error", null, null]);
});

test("캐시 파일 표: 음원 주소는 키에서 되돌리고(직접 링크는 그 키를 가리키는 행에서), 요청 수를 센다", () => {
  const rows = page(query("files")).rows as TrackFileRow[];
  const of = (key: string) => rows.find((row) => row.audioKey === key)!;
  assert.equal(rows.length, 5);
  assert.deepEqual([of("yt:aaaaaaaaaa2").audioUrl, of("yt:aaaaaaaaaa2").requests], [yt("aaaaaaaaaa2"), 2]);
  assert.deepEqual([of("yt:aaaaaaaaaa5").requests], [0]);
  assert.equal(of(audioKeyOf(DIRECT)!).audioUrl, DIRECT);
  assert.equal(of("dl:0123456789abcdef0123456789abcdef").audioUrl, null);

  file("sc:artist/other");
  file("sc:on.soundcloud.com/x");
  const more = page(query("files")).rows as TrackFileRow[];
  assert.equal(more.find((row) => row.audioKey === "sc:artist/other")?.audioUrl, "https://soundcloud.com/artist/other");
  assert.equal(more.find((row) => row.audioKey === "sc:on.soundcloud.com/x")?.audioUrl, "https://on.soundcloud.com/x");
});

test("캐시 파일의 원본: 받은 뒤의 확인만, 그때 본 버전이 캐시 파일과 다르면 바뀜 · 견줄 버전이 없으면 재생 가능", () => {
  store.db().prepare("UPDATE audio_cache SET audio_version = 'lmt:1' WHERE audio_key = 'yt:aaaaaaaaaa1'").run();
  const source = () => (page(query("files")).rows as TrackFileRow[]).find((row) => row.audioKey === "yt:aaaaaaaaaa1")!.source;
  assert.equal(source(), null, "확인하지 않았다");
  sourceChecks.recordCheck("yt:aaaaaaaaaa1", { ok: true, at: 99, version: "lmt:2" });
  assert.equal(source(), null, "받기 전의 확인");
  sourceChecks.recordCheck("yt:aaaaaaaaaa1", { ok: true, at: 200, version: "lmt:1" });
  assert.deepEqual(source(), { state: "same", at: 200 });
  sourceChecks.recordCheck("yt:aaaaaaaaaa1", { ok: true, at: 300, version: "lmt:2" });
  assert.deepEqual(source(), { state: "changed", at: 300 });
  sourceChecks.recordCheck("yt:aaaaaaaaaa1", { ok: true, at: 400 });
  assert.deepEqual(source(), { state: "changed", at: 400 }, "버전을 모르는 재생 테스트는 앞서 본 버전을 지킨다");
  sourceChecks.recordCheck("yt:aaaaaaaaaa1", { ok: false, code: "unavailable-contents", at: 500 });
  assert.deepEqual(source(), { state: "gone", code: "unavailable-contents", at: 500 });
  assert.deepEqual(
    (page(query("files", { filters: { source: "=unavailable-contents" } })).rows as TrackFileRow[]).map((row) => row.audioKey),
    ["yt:aaaaaaaaaa1"],
    "필터는 원시 값으로",
  );
  store.db().prepare("DELETE FROM source_checks").run();
  sourceChecks.recordCheck("yt:aaaaaaaaaa1", { ok: true, at: 600 });
  store.db().prepare("UPDATE audio_cache SET audio_version = NULL").run();
  assert.deepEqual(source(), { state: "ok", at: 600 });
});

test("필터 · 아무 열 · 정렬(빈 값은 뒤로, 키가 끝 기준) · 구간", () => {
  assert.deepEqual(
    requests(query("requests", { filters: { size: ">=2MB" } })).map((row) => row.requestKey),
    [LASTFM, SPOTIFY, yt("aaaaaaaaaa1")].sort(),
  );
  assert.deepEqual(
    requests(query("requests", { q: "둘 last" })).map((row) => row.requestKey),
    [LASTFM],
  );
  assert.deepEqual(
    requests(query("requests", { filters: { check: "=ok" } })).map((row) => row.requestKey),
    [SPOTIFY_PIN_ONLY],
  );

  const sorted = requests(query("requests", { sort: [{ column: "lastPlayedAt", dir: "desc" }] })).map((row) => row.requestKey);
  assert.deepEqual(sorted.slice(0, 3), [yt("aaaaaaaaaa1"), SPOTIFY, LASTFM], "같은 값은 키 순서");
  assert.equal(sorted.length, 6);
  assert.deepEqual(sorted.slice(3), [SPOTIFY_PIN_ONLY, "amq:1", yt("aaaaaaaaaa3")].sort(), "빈 값은 내림차순에서도 뒤로");

  const part = page(query("requests", { sort: [{ column: "lastPlayedAt", dir: "desc" }], offset: 1, limit: 2 }));
  assert.deepEqual([part.rows.map((row) => (row as TrackRequestRow).requestKey), part.offset, part.total, part.matched], [sorted.slice(1, 3), 1, 6, 6]);

  const age = page(query("age", { filters: { markedAt: "<1970-01-02" } }));
  assert.equal(age.matched, 2);
});

test("필터 식이 틀리면 그 열을 가리켜 거절한다", () => {
  const result = trackCache.read(query("requests", { filters: { size: ">abc", title: "/(a+)+/" } }));
  assert.ok(!result.ok);
  assert.deepEqual(result.errors, [
    { pointer: "/filters/size", code: "bad-filter" },
    { pointer: "/filters/title", code: "unsafe-regex" },
  ]);
  assert.equal(result.code, "bad-filter");
});

test("주소 질의: trackCacheSearch 의 역이고, 모르는 열 · 같은 키 여럿 · 겹친 정렬 · 구간 밖을 거절한다", () => {
  const sent = query("files", { filters: { title: "a", size: ">1MB" }, q: "x", sort: [{ column: "plays", dir: "desc" }], offset: 10, limit: 20 });
  assert.deepEqual(trackCache.queryOf(trackCacheSearch(sent)), { ok: true, query: sent });

  const refused = (search: string) => {
    const result = trackCache.queryOf(new URLSearchParams(search));
    return result.ok ? null : [result.code, result.errors?.[0]?.pointer ?? null];
  };
  assert.deepEqual(refused("table=nope"), ["bad-request", null]);
  assert.deepEqual(refused("table=age&limit=201"), ["bad-page-range", null]);
  assert.deepEqual(refused("table=age&offset=-1"), ["bad-page-range", null]);
  assert.deepEqual(refused("table=age&offset=1&offset=2"), ["bad-page-range", null]);
  assert.deepEqual(refused("table=age&limit=5&limit=6"), ["bad-page-range", null]);
  assert.deepEqual(refused("table=age&table=files"), ["bad-request", null]);
  assert.deepEqual(refused("table=age&f.title=a"), ["bad-request", "/filters/title"]);
  assert.deepEqual(refused("table=age&f.videoId=a&f.videoId=b"), ["bad-request", "/filters/videoId"]);
  assert.deepEqual(refused("table=age&q=a&q=b"), ["bad-request", "/q"]);
  assert.deepEqual(refused("table=age&sort=markedAt:asc,markedAt:desc"), ["bad-request", "/sort"]);
  assert.deepEqual(refused("table=age&sort=markedAt:up"), ["bad-request", "/sort"]);
  assert.deepEqual(refused("table=age&sort=markedAt:asc&sort=videoId:asc"), ["bad-request", "/sort"]);
});

test("바뀜 번호: 화면의 표에 쓰면 오르고, 재생 테스트 결과는 따로, 다른 표 · 맞는 행이 없는 쓰기는 올리지 않는다. 캐시 초기화 뒤에도 남는다", async () => {
  const start = cacheRevision();
  externalCaches.setSponsorSegments("aaaaaaaaaa1", []);
  store.db().prepare("UPDATE track_lookup SET platform = 'x' WHERE request_key = 'none'").run();
  assert.deepEqual(cacheRevision(), start);

  sourceChecks.recordCheck("yt:aaaaaaaaaa1", { ok: true, at: 1 });
  assert.deepEqual(cacheRevision(), { revision: start.revision, checkRevision: start.checkRevision + 1 });

  audioCache.recordPlayback("yt:aaaaaaaaaa1");
  const played = cacheRevision();
  assert.ok(played.revision > start.revision, "재생 수도 행이다");
  externalCaches.markAgeRestricted("bbbbbbbbbbb");
  assert.ok(cacheRevision().revision > played.revision);

  const beforeReset = cacheRevision();
  await audioCache.resetCache(AUDIO_CACHE_PARTS_DEFAULT);
  const afterReset = cacheRevision();
  assert.ok(afterReset.revision > beforeReset.revision && afterReset.checkRevision > beforeReset.checkRevision);
});

test("쓰기: 하나라도 값이 틀리면 아무것도 쓰지 않고 조작 번호와 필드를 가리킨다", async () => {
  const start = cacheRevision().revision;
  const result = await trackCache.write(
    [
      { op: "unpin", requestKey: SPOTIFY_PIN_ONLY, expect: SC },
      { op: "pin", requestKey: yt("aaaaaaaaaa1"), audioUrl: SPOTIFY, expect: null },
      { op: "pin", requestKey: "https://www.youtube.com/playlist?list=PL1", audioUrl: SC, expect: null },
      { op: "clearResult", requestKey: yt("aaaaaaaaaa1"), expect: yt("aaaaaaaaaa1") },
    ],
    "tester",
  );
  assert.ok(!result.ok);
  assert.deepEqual(result.errors, [
    { pointer: "/ops/1/audioUrl", code: "not-audio-source" },
    { pointer: "/ops/2/requestKey", code: "not-single-track" },
    { pointer: "/ops/3", code: "nothing-to-clear" },
  ]);
  assert.equal(pinnedSources.getPin(SPOTIFY_PIN_ONLY)?.audioUrl, SC, "앞의 맞는 조작도 쓰지 않았다");
  assert.equal(cacheRevision().revision, start);

  const empty = await trackCache.write([], "tester");
  assert.ok(!empty.ok && empty.code === "nothing-to-save");
  const many = await trackCache.write(
    Array.from({ length: 101 }, (_, i) => ({ op: "deleteFile" as const, audioKey: `yt:${i}`, expect: null })),
    "tester",
  );
  assert.ok(!many.ok && many.code === "too-many-file-deletes" && many.params?.max === 100);
});

test("쓰기: 조작마다 본 값과 대조한다(됨 · 바뀜 · 없음), 새 행 · 음원은 다듬어 적는다", async () => {
  const result = await trackCache.write(
    [
      { op: "pin", requestKey: "https://youtu.be/ccccccccccc?si=share", audioUrl: "https://www.youtube.com/watch?v=ddddddddddd&list=PL9", expect: null },
      { op: "pin", requestKey: yt("aaaaaaaaaa3"), audioUrl: SC, expect: yt("aaaaaaaaaa9") },
      { op: "pin", requestKey: SPOTIFY, audioUrl: SC, expect: SC },
      { op: "unpin", requestKey: "amq:1", expect: SC },
      { op: "clearResult", requestKey: SPOTIFY, expect: yt("aaaaaaaaaa2") },
      { op: "clearResult", requestKey: LASTFM, expect: yt("aaaaaaaaaa9") },
      { op: "deleteRequest", requestKey: yt("aaaaaaaaaa3"), expect: { ledgerAudioUrl: yt("aaaaaaaaaa3"), pinned: yt("aaaaaaaaaa4") } },
      { op: "deleteRequest", requestKey: SPOTIFY_PIN_ONLY, expect: { ledgerAudioUrl: null, pinned: yt("aaaaaaaaaa9") } },
      { op: "deleteRequest", requestKey: "amq:404", expect: { ledgerAudioUrl: null, pinned: null } },
      { op: "clearAge", videoId: "aaaaaaaaaa4", expect: 800 },
      { op: "clearAge", videoId: "aaaaaaaaaa9", expect: 51 },
    ],
    "tester",
  );
  assert.ok(result.ok);
  assert.deepEqual(result.written.results, [{ ok: true }, { ok: false, code: "changed", current: yt("aaaaaaaaaa4") }, { ok: false, code: "changed", current: null }, { ok: false, code: "gone" }, { ok: true }, { ok: false, code: "changed", current: yt("aaaaaaaaaa2") }, { ok: true }, { ok: false, code: "changed", current: { ledgerAudioUrl: null, pinned: SC } }, { ok: false, code: "gone" }, { ok: true }, { ok: false, code: "changed", current: 50 }]);
  assert.deepEqual(pinnedSources.getPin(yt("ccccccccccc"))?.audioUrl, yt("ddddddddddd"), "요청 키와 음원 모두 다듬은 것");
  const rows = requests();
  assert.equal(
    rows.some((row) => row.requestKey === SPOTIFY),
    false,
    "자동 검색 결과를 지운 행(지정 없음)은 사라진다",
  );
  assert.equal(
    rows.some((row) => row.requestKey === yt("aaaaaaaaaa3")),
    false,
  );
  assert.equal(byKey(rows, LASTFM).ledgerAudioUrl, yt("aaaaaaaaaa2"));
  assert.equal(result.written.revision, cacheRevision().revision);

  const repin = await trackCache.write([{ op: "pin", requestKey: SPOTIFY_PIN_ONLY, audioUrl: yt("eeeeeeeeeee"), expect: SC }], "tester");
  assert.ok(repin.ok);
  assert.deepEqual(repin.written.results, [{ ok: true }]);
  assert.equal(pinnedSources.getPin(SPOTIFY_PIN_ONLY)?.audioUrl, yt("eeeeeeeeeee"));
});

test("쓰기: 캐시 파일 삭제는 DB 몫 뒤에 하고, 쓰는 중 · 바뀜 · 없음을 알린다(지운 바이트는 싣지 않는다)", async () => {
  const target = audioCache.getFilePath("yt:fffffffffff");
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
  fs.writeFileSync(target, "x");
  store.db().prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, downloaded_at, created_at) VALUES ('yt:fffffffffff', 'cached', ?, 1, 77, 0)").run(target);
  audioCache.protect("g-tc", "yt:aaaaaaaaaa1");
  try {
    const result = await trackCache.write(
      [
        { op: "deleteFile", audioKey: "yt:fffffffffff", expect: 77 },
        { op: "deleteFile", audioKey: "yt:aaaaaaaaaa1", expect: 100 },
        { op: "deleteFile", audioKey: "yt:aaaaaaaaaa5", expect: 1 },
        { op: "deleteFile", audioKey: "yt:nnnnnnnnnnn", expect: null },
        { op: "deleteFile", audioKey: audioKeyOf(DIRECT)!, expect: null },
      ],
      "tester",
    );
    assert.ok(result.ok);
    assert.deepEqual(result.written.results, [{ ok: true }, { ok: false, code: "in-use", where: "playing" }, { ok: false, code: "changed", current: 100 }, { ok: false, code: "gone" }, { ok: true }]);
    assert.equal(fs.existsSync(target), false);
    assert.equal(audioCache.lookupByAudioKey("yt:fffffffffff"), null);
  } finally {
    audioCache.unprotect("g-tc");
  }
});

test("값 검사 미리 보기: 저장될 형식 · 종류 · 음원 키, 아니면 막힌 까닭", () => {
  assert.deepEqual(trackCache.inspect({ requestKey: "https://youtu.be/ccccccccccc?si=x", audioUrl: "https://www.youtube.com/watch?v=ddddddddddd&list=PL" }), {
    request: { ok: true, canonical: yt("ccccccccccc"), platform: "youtube" },
    audio: { ok: true, canonical: yt("ddddddddddd"), kind: "youtube", audioKey: "yt:ddddddddddd" },
  });
  assert.deepEqual(trackCache.inspect({ audioUrl: SPOTIFY }), { audio: { ok: false, code: "not-audio-source" } });
  assert.deepEqual(trackCache.inspect({}), {});
});
