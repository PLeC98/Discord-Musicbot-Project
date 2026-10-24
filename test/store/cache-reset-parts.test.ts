// src/store/audio-cache.ts 의 resetCache(parts) · src/dashboard/reset.ts 의 resetAudioCache — 오디오 캐시 초기화는 선택한 것의 표만 비운다.
// 캐시 DB 의 모든 표가 선택 하나에 들어(cache-db 의 TABLES_OF_PART) 새 표가 초기화에서 빠지지 않는다. 지운 크기는 실제로 지운 파일만 센다.

import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openTempStore } from "../helpers/temp-store.ts";

const store = openTempStore("cache-reset-parts-");
after(() => store.close());
const audioCache = await import("../../src/store/audio-cache.ts");
const { TABLES_OF_PART } = await import("../../src/store/cache-db.ts");
const { AUDIO_CACHE_PARTS } = await import("../../src/rules/audio-cache-parts.ts");
const { resetAudioCache } = await import("../../src/dashboard/reset.ts");
const sponsorBlock = await import("../../src/sources/sponsor-block.ts");
const spotify = await import("../../src/sources/spotify.ts");
const { default: config } = await import("../../src/config/index.ts");
const { fake } = await import("../helpers/fake.ts");

const count = (table: string) => store.db().prepare(`SELECT COUNT(*) FROM "${table}"`).pluck().get() as number;

function seedFile(key: string, bytes: number) {
  fs.mkdirSync(audioCache.cacheDir(), { recursive: true });
  const file = audioCache.getFilePath(key);
  fs.writeFileSync(file, "x".repeat(bytes));
  store.db().prepare("INSERT INTO audio_cache (audio_key, status, file_path, file_size_bytes, downloaded_at, created_at) VALUES (?, 'cached', ?, ?, 1, 0)").run(key, file, bytes);
  return file;
}

beforeEach(() => {
  for (const table of Object.values(TABLES_OF_PART).flat()) store.db().prepare(`DELETE FROM "${table}"`).run();
  const db = store.db();
  db.prepare("INSERT INTO track_lookup (request_key, page_url, audio_url, platform) VALUES ('https://y/a', 'https://y/a', 'https://www.youtube.com/watch?v=aaaaaaaaaaa', 'youtube')").run();
  db.prepare("INSERT INTO source_checks (audio_key, ok, code, checked_at) VALUES ('yt:aaaaaaaaaaa', 1, NULL, 1)").run();
  db.prepare("INSERT INTO sponsorblock_cache (video_id, data_json, fetched_at) VALUES ('aaaaaaaaaaa', '[]', 1)").run();
  db.prepare("INSERT INTO age_restricted (video_id, marked_at) VALUES ('aaaaaaaaaaa', 1)").run();
  db.prepare("INSERT INTO spotify_anon (id, data_json, fetched_at) VALUES (1, '{}', 1)").run();
  db.prepare("INSERT INTO pinned_sources (request_key, audio_url, pinned_at) VALUES ('https://y/a', 'https://soundcloud.com/a/b', 1)").run();
});

test("캐시 DB 의 표는 모두 선택 하나에 꼭 한 번 든다", () => {
  const tables = (store.db().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all() as string[]).sort();
  const listed = AUDIO_CACHE_PARTS.flatMap((part) => TABLES_OF_PART[part]);
  assert.deepEqual([...listed].sort(), tables);
  assert.equal(new Set(listed).size, listed.length, "겹치지 않는다");
});

test("선택한 것의 표만 비우고, 선택마다 비운 행 수를 돌려준다", async () => {
  const ledger = await audioCache.resetCache(["ledger"]);
  assert.deepEqual(ledger.cleared, { ledger: 2 });
  assert.deepEqual([count("track_lookup"), count("source_checks"), count("sponsorblock_cache"), count("pinned_sources")], [0, 0, 1, 1]);

  const external = await audioCache.resetCache(["external"]);
  assert.deepEqual(external.cleared, { external: 3 });
  assert.deepEqual([count("sponsorblock_cache"), count("age_restricted"), count("spotify_anon"), count("pinned_sources")], [0, 0, 0, 1]);

  const pins = await audioCache.resetCache(["pins"]);
  assert.deepEqual([pins.cleared, count("pinned_sources")], [{ pins: 1 }, 0]);
});

test("캐시 파일을 고르지 않으면 파일을 건드리지 않고, 고르면 실제로 지운 크기만 센다", async () => {
  const kept = seedFile("yt:bbbbbbbbbbb", 700);
  const gone = seedFile("yt:ccccccccccc", 300);
  const none = await audioCache.resetCache(["ledger"]);
  assert.deepEqual([none.removed, none.freedBytes, fs.existsSync(gone), count("audio_cache")], [0, 0, true, 2]);

  audioCache.protect("g-parts", "yt:bbbbbbbbbbb");
  try {
    const files = await audioCache.resetCache(["files"]);
    assert.deepEqual([files.removed, files.kept, files.freedBytes, files.cleared], [1, 1, 300, { files: 1 }], "재생 중인 700바이트는 세지 않는다");
    assert.deepEqual([fs.existsSync(kept), fs.existsSync(gone), count("audio_cache"), count("pinned_sources")], [true, false, 1, 1]);
  } finally {
    audioCache.unprotect("g-parts");
  }
});

test("바깥 서비스 데이터를 고르면 메모리의 기억(SponsorBlock 구간 · 스포티파이 익명 상태)도 버린다", async () => {
  const graphql = spotify._internals.graphql;
  graphql._state = { secrets: [{ version: 1, secret: "s" }], fetchedAt: Date.now() } as unknown as typeof graphql._state;
  let asked = 0;
  sponsorBlock.useFetch(
    fake<typeof fetch>(async () => {
      asked++;
      return fake<Response>({ status: 200, json: async () => [{ videoID: "ddddddddddd", hash: "0".repeat(64), segments: [{ category: "intro", actionType: "skip", segment: [0, 5] }] }] });
    }),
  );
  const enabled = config.sponsorblock.enabled;
  config.sponsorblock.enabled = true;
  const track = { audioUrl: "https://www.youtube.com/watch?v=ddddddddddd" };
  try {
    await sponsorBlock.forTrack(track, "g-parts");
    await sponsorBlock.forTrack(track, "g-parts");
    const once = asked;
    assert.ok(once >= 1);

    await resetAudioCache(["ledger"], "tester");
    await sponsorBlock.forTrack(track, "g-parts");
    assert.deepEqual([asked, graphql._state === null], [once, false], "고르지 않으면 기억한 답을 그대로 쓴다");

    await resetAudioCache(["external"], "tester");
    assert.equal(graphql._state, null);
    await sponsorBlock.forTrack(track, "g-parts");
    assert.ok(asked > once, "기억을 버려 다시 묻는다");
  } finally {
    config.sponsorblock.enabled = enabled;
    sponsorBlock.useFetch(null);
    sponsorBlock.forget();
    graphql._state = null;
  }
});
