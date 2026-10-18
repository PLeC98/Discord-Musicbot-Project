// src/store/pinned-sources.ts — 직접 지정한 음원. 요청 키를 링크 데이터와 같은 모양으로 다듬어 두고, 캐시 초기화가 건너뛴다.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { cacheDb } from "../../src/store/cache-db.ts";
import * as stores from "../../src/store/stores.ts";
import * as audioCache from "../../src/store/audio-cache.ts";
import * as pins from "../../src/store/pinned-sources.ts";

const DB_DIR = path.join(os.tmpdir(), `musicbot-pins-test-${process.pid}`);
const CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-pins-"));

before(() => {
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  audioCache._setCacheDir(CACHE_DIR); // 실 캐시 폴더를 건드리지 않는다
  stores.open(DB_DIR);
  audioCache.initialize();
});

after(() => {
  audioCache.close();
  stores.close();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 5 });
  fs.rmSync(CACHE_DIR, { recursive: true, force: true, maxRetries: 5 });
});

test("요청 키는 다듬어서 적고 찾는다(공유 링크 여럿이 한 지정으로 모인다). 자동재생 키는 그대로", () => {
  pins.setPin("https://youtu.be/aaaaaaaaaaa?si=share", "https://soundcloud.com/a/b", 100);
  assert.deepEqual(pins.getPin("https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PL1"), { requestKey: "https://www.youtube.com/watch?v=aaaaaaaaaaa", audioUrl: "https://soundcloud.com/a/b", pinnedAt: 100 });

  pins.setPin("amq:41043", "https://www.youtube.com/watch?v=bbbbbbbbbbb", 200);
  assert.equal(pins.getPin("amq:41043")?.audioUrl, "https://www.youtube.com/watch?v=bbbbbbbbbbb");
  assert.equal(pins.pinCount(), 2);

  pins.setPin("amq:41043", "https://www.youtube.com/watch?v=ccccccccccc", 300);
  assert.deepEqual(pins.getPin("amq:41043"), { requestKey: "amq:41043", audioUrl: "https://www.youtube.com/watch?v=ccccccccccc", pinnedAt: 300 }, "다시 지정하면 바꾼다");

  assert.deepEqual(pins.unpin("amq:41043", "https://www.youtube.com/watch?v=ccccccccccc"), { ok: true });
  assert.deepEqual(pins.unpin("amq:41043", "https://www.youtube.com/watch?v=ccccccccccc"), { ok: false, code: "gone" }, "없는 것을 해제하면 gone");
  assert.equal(pins.getPin("amq:41043"), null);
  assert.equal(pins.getPin(null), null);
  pins.unpin("https://www.youtube.com/watch?v=aaaaaaaaaaa", "https://soundcloud.com/a/b");
});

test("캐시 초기화는 직접 지정한 음원을 남기고 재생 테스트 결과는 비운다", async () => {
  pins.setPin("https://www.youtube.com/watch?v=ddddddddddd", "https://soundcloud.com/c/d");
  cacheDb.get().prepare("INSERT INTO source_checks (audio_key, ok, code, checked_at) VALUES ('sc:/c/d', 0, 'sc-unavailable', 1)").run();

  await audioCache.resetCache();

  assert.equal(pins.getPin("https://www.youtube.com/watch?v=ddddddddddd")?.audioUrl, "https://soundcloud.com/c/d");
  assert.equal(cacheDb.get().prepare("SELECT COUNT(*) FROM source_checks").pluck().get(), 0);
  pins.unpin("https://www.youtube.com/watch?v=ddddddddddd", "https://soundcloud.com/c/d");
});

test("캐시 DB 를 삭제하라는 멈춤 안내는 직접 지정한 음원도 사라진다고 말한다", () => {
  const mismatch = cacheDb.spec.onMismatch;
  assert.ok("lost" in mismatch && mismatch.lost.includes("직접 지정한 음원"));
});
