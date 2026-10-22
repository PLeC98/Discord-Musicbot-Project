// 연령 제한 폴백: externalCaches 레지스트리 라운드트립 + YouTube.isAgeRestrictedError 판별.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import * as audioCache from "../../src/store/audio-cache.ts";
import * as stores from "../../src/store/stores.ts";
import * as externalCaches from "../../src/store/external-caches.ts";
import * as YouTube from "../../src/sources/youtube/index.ts";
import * as documents from "../../src/config/documents.ts";
import config from "../../src/config/index.ts";
import { runYtDlp } from "../../src/sources/youtube/ytdlp-run.ts";
import { _ageCheck } from "../../src/player/start-playback.ts";
import { codeOf, errorKind } from "../../src/rules/error-kind.ts";
import type { RunYtDlp, YtDlpFlags } from "../../src/sources/ytdlp-spawn.ts";

const DB_DIR = path.join(os.tmpdir(), `musicbot-agerestrict-test-${process.pid}`);

before(() => {
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  stores.open(DB_DIR);
  audioCache.initialize();
});

after(() => {
  documents._use("age-content");
  if (audioCache) audioCache.close();
  stores.close();
  fs.rmSync(DB_DIR, { recursive: true, force: true, maxRetries: 5 });
});

test("externalCaches: 연령 제한 videoId 기록/조회 라운드트립", () => {
  assert.equal(externalCaches.isAgeRestricted("vidAge1"), false);
  externalCaches.markAgeRestricted("vidAge1");
  assert.equal(externalCaches.isAgeRestricted("vidAge1"), true);
  // 멱등 (중복 기록 무해)
  externalCaches.markAgeRestricted("vidAge1");
  assert.equal(externalCaches.isAgeRestricted("vidAge1"), true);
  assert.equal(externalCaches.isAgeRestricted("other"), false);
});

test("externalCaches: 빈/누락 videoId는 무시", () => {
  externalCaches.markAgeRestricted("");
  externalCaches.markAgeRestricted(null);
  assert.equal(externalCaches.isAgeRestricted(""), false);
  assert.equal(externalCaches.isAgeRestricted(null), false);
});

test("YouTube.isAgeRestrictedError: 연령 게이트 메시지 감지", () => {
  assert.equal(YouTube.isAgeRestrictedError({ stderr: "ERROR: [youtube] X: Sign in to confirm your age." }), true);
  assert.equal(YouTube.isAgeRestrictedError({ message: "This video may be inappropriate for some users." }), true);
  assert.equal(YouTube.isAgeRestrictedError(new Error("Sign in to confirm your age")), true);
});

test("YouTube.isAgeRestrictedError: 무관한 오류는 false", () => {
  assert.equal(YouTube.isAgeRestrictedError(new Error("Requested format is not available")), false);
  assert.equal(YouTube.isAgeRestrictedError({ stderr: "HTTP Error 403" }), false);
  assert.equal(YouTube.isAgeRestrictedError(null), false);
});

// ── 연령 제한 콘텐츠(운영자 단위) ──────────────────────────────────────────

const AGE_ERROR = () => Object.assign(new Error("ERROR: [youtube] X: Sign in to confirm your age."), { stderr: "ERROR: [youtube] X: Sign in to confirm your age." });
const options = (forceCookies: boolean) => YouTube.getYtDlpOptions({ dumpSingleJson: true }, { forceCookies });
// 부른 옵션을 적고, 쿠키 없이 부르면 연령 제한으로 실패한다
function fakeExec(calls: YtDlpFlags[]): RunYtDlp {
  return (async (_url: string, flags: YtDlpFlags) => {
    calls.push(flags);
    if (!flags.cookiesFromBrowser) throw AGE_ERROR();
    return { id: "ok" };
  }) as RunYtDlp;
}

test("연령 제한 콘텐츠가 꺼져 있으면 쿠키가 있어도 다시 시도하지 않고 age-content-off 로 거절한다", async () => {
  const saved = { ...config.ytdlp };
  Object.assign(config.ytdlp, { cookiesSource: "firefox", cookiesFromBrowser: "firefox", useCookieFile: false, playerClients: [] });
  try {
    documents._use("age-content", { enabled: false, changedAt: 1 });
    const calls: YtDlpFlags[] = [];
    await assert.rejects(runYtDlp("https://www.youtube.com/watch?v=ageoff00001", options, fakeExec(calls)), (e) => errorKind(e) === "age-content-off");
    assert.equal(calls.length, 1, "쿠키로 다시 묻지 않는다");

    // 이미 연령 제한으로 적힌 영상은 yt-dlp 를 부르지도 않는다
    externalCaches.markAgeRestricted("ageoff00002");
    const none: YtDlpFlags[] = [];
    await assert.rejects(runYtDlp("https://www.youtube.com/watch?v=ageoff00002", options, fakeExec(none)), (e) => codeOf(e) === "age-content-off");
    assert.equal(none.length, 0);

    // 켜면 적어 두고 쿠키로 한 번 더 묻는다
    documents._use("age-content", { enabled: true, changedAt: 2 });
    const on: YtDlpFlags[] = [];
    assert.deepEqual(await runYtDlp("https://www.youtube.com/watch?v=ageon000001", options, fakeExec(on)), { id: "ok" });
    assert.deepEqual(
      on.map((flags) => flags.cookiesFromBrowser ?? null),
      [null, "firefox"],
    );
    assert.equal(externalCaches.isAgeRestricted("ageon000001"), true);
  } finally {
    Object.assign(config.ytdlp, saved);
  }
});

test("캐시로 틀 때: 연령 제한으로 적힌 영상은 연령 제한 콘텐츠가 꺼져 있으면 거절한다(캐시는 쿠키 없이 튼다)", () => {
  externalCaches.markAgeRestricted("agecache001");
  documents._use("age-content", { enabled: false, changedAt: 1 });
  assert.throws(
    () => _ageCheck("https://www.youtube.com/watch?v=agecache001"),
    (e) => codeOf(e) === "age-content-off",
  );
  assert.doesNotThrow(() => _ageCheck("https://www.youtube.com/watch?v=notmarked01"), "적히지 않은 영상");
  assert.doesNotThrow(() => _ageCheck("https://example.com/a.mp3"), "유튜브가 아닌 음원");
  assert.doesNotThrow(() => _ageCheck(null), "아직 영상을 찾지 않은 스포티파이 곡");
  documents._use("age-content", { enabled: true, changedAt: 2 });
  assert.doesNotThrow(() => _ageCheck("https://www.youtube.com/watch?v=agecache001"));
});
