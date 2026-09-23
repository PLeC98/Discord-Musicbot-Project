"use strict";

// src/media/cacheDownload.js — 같은 곡을 두 서버가 동시에 받는 경쟁 (백로그 B-23)
//
// 회귀 대상: 진행 중 다운로드 맵이 MusicPlayer마다 따로였다. 서버가 다르면 같은 전역 캐시 경로에
// yt-dlp/ffmpeg가 둘 다 쓰고, 한쪽의 실패 정리가 다른 쪽 작업 파일을 지웠다.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const TrackDownloader = require("../../src/media/cacheDownload");
const audioCache = require("../../src/store/audioCache");

const { inFlight, tempPathFor, cleanTemp, publish } = TrackDownloader._internals;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-download-race-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const KEY = "a".repeat(32);
const finalPath = path.join(dir, `track_${KEY}.opus`);
const track = { url: "https://example.org/a", audioSourceKey: "yt:a", title: "곡", platform: "youtube" };

function makeDownloader({ onDownload }) {
  const downloader = new TrackDownloader({ guild: { id: "g" } });
  downloader.trackFilePath = () => finalPath;
  downloader._performDownload = async (t, file) => {
    await onDownload(t, file);
    return file;
  };
  return downloader;
}

test("같은 곡을 서버 둘이 동시에 받으면 실제 다운로드는 한 번뿐", async () => {
  let started = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const onDownload = async () => {
    started++;
    await gate;
  };

  // 서버가 다르면 플레이어도 다르다 — 그래도 같은 파일이면 한 번만 받아야 한다
  const first = makeDownloader({ onDownload }).downloadTrack(track);
  const second = makeDownloader({ onDownload }).downloadTrack(track);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(started, 1, "뒤에 온 쪽은 앞선 다운로드를 기다린다");
  assert.equal(TrackDownloader.isDownloading(finalPath), true);
  assert.ok(TrackDownloader.waitFor(finalPath));

  release();
  assert.deepEqual(await Promise.all([first, second]), [finalPath, finalPath]);
  assert.equal(TrackDownloader.isDownloading(finalPath), false, "끝나면 레지스트리를 비운다");
  assert.equal(inFlight.size, 0);
});

test("다운로드가 실패해도 기다리던 쪽까지 같은 오류를 받고 레지스트리는 비워진다", async () => {
  const boom = new Error("다운로드 실패");
  const onDownload = async () => {
    throw boom;
  };
  const first = makeDownloader({ onDownload }).downloadTrack(track);
  const second = makeDownloader({ onDownload }).downloadTrack(track);

  await assert.rejects(first, /다운로드 실패/);
  await assert.rejects(second, /다운로드 실패/);
  assert.equal(inFlight.size, 0);
});

test("임시 경로: 같은 폴더·.opus·부를 때마다 다르다", () => {
  const a = tempPathFor(finalPath);
  const b = tempPathFor(finalPath);
  assert.notEqual(a, b);
  for (const p of [a, b]) {
    assert.equal(path.dirname(p), dir);
    assert.ok(path.basename(p).startsWith(`track_${KEY}.tmp-`), p);
    assert.ok(p.endsWith(".opus"), p);
  }
});

test("실패 정리는 내 임시 파일과 그 부스러기만 — 남이 받는 중인 파일은 두고 간다", () => {
  const mine = tempPathFor(finalPath);
  const theirs = tempPathFor(finalPath);
  const stem = path.basename(mine, ".opus");
  const files = {
    mine,
    myPart: path.join(dir, `${stem}.opus.part`),
    myFragment: path.join(dir, `${stem}.f251.webm`),
    myInfo: path.join(dir, `${stem}.info.json`),
    theirs,
    theirPart: path.join(dir, `${path.basename(theirs, ".opus")}.opus.part`),
    done: finalPath,
  };
  for (const p of Object.values(files)) fs.writeFileSync(p, "x");

  const removed = cleanTemp(mine);

  assert.equal(removed, 4);
  for (const key of ["mine", "myPart", "myFragment", "myInfo"]) assert.equal(fs.existsSync(files[key]), false, key);
  for (const key of ["theirs", "theirPart", "done"]) assert.equal(fs.existsSync(files[key]), true, key);
  fs.rmSync(files.theirs);
  fs.rmSync(files.theirPart);
  fs.rmSync(files.done);
});

test("게시: 최종 경로로 옮긴다 — 먼저 끝난 쪽이 있으면 내 것을 버린다", async () => {
  const mine = tempPathFor(finalPath);
  fs.writeFileSync(mine, "내 파일");

  assert.equal(await publish(mine, finalPath), true);
  assert.equal(fs.existsSync(mine), false);
  assert.equal(fs.readFileSync(finalPath, "utf8"), "내 파일");
  // 옮긴 직후에는 DB에 아직 없다 — 그 사이 기동 스윕이 돌아도 지우지 않게 보호가 걸려 있어야 한다
  assert.equal(audioCache._protectedFiles.has(path.resolve(finalPath)), true);
  audioCache.unprotectFile(finalPath);

  const later = tempPathFor(finalPath);
  fs.writeFileSync(later, "늦게 받은 파일");
  assert.equal(await publish(later, finalPath), false, "이미 있으면 덮어쓰지 않는다");
  assert.equal(fs.existsSync(later), false, "내 임시 파일은 치운다");
  assert.equal(fs.readFileSync(finalPath, "utf8"), "내 파일");

  fs.rmSync(finalPath);
});

test("빈 최종 파일은 먼저 끝난 것으로 치지 않는다", async () => {
  fs.writeFileSync(finalPath, "");
  const mine = tempPathFor(finalPath);
  fs.writeFileSync(mine, "받은 파일");

  assert.equal(await publish(mine, finalPath), true);
  assert.equal(fs.readFileSync(finalPath, "utf8"), "받은 파일");

  fs.rmSync(finalPath);
});
