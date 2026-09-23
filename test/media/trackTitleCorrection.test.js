"use strict";

// src/TrackDownloader.js `_takeInfoJson` — 다운로드에 곁들여 받은 info.json에서 제목과 오디오 길이를 꺼낸다.
// 읽고 지우는 것까지가 계약이다 — 남기면 캐시 폴더에 영상마다 100KB대 찌꺼기가 쌓인다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const TrackDownloader = require("../../src/media/cacheDownload");

const take = TrackDownloader.prototype._takeInfoJson;
const NONE = { title: null, durationSec: null };

function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "title-"));
  try {
    return fn(path.join(dir, "track_abc.opus"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("info.json에서 제목과 길이를 꺼내고 파일을 지운다", () => {
  withTemp((filepath) => {
    const info = `${filepath}.info.json`;
    fs.writeFileSync(info, JSON.stringify({ title: "【Ado】初夏 (Shoka)", duration: 235 }), "utf8");

    assert.deepEqual(take.call(null, filepath), { title: "【Ado】初夏 (Shoka)", durationSec: 235 });
    assert.equal(fs.existsSync(info), false, "찌꺼기를 남기지 않는다");
  });
});

test("확장자를 바꾼 형태로 쓰인 경우도 찾는다", () => {
  withTemp((filepath) => {
    const info = filepath.replace(/\.opus$/, "") + ".info.json";
    fs.writeFileSync(info, JSON.stringify({ title: "다른 이름 규칙" }), "utf8");

    assert.equal(take.call(null, filepath).title, "다른 이름 규칙");
    assert.equal(fs.existsSync(info), false);
  });
});

test("UTF-8로 읽는다 (일본어·한국어 제목이 목적이다)", () => {
  withTemp((filepath) => {
    fs.writeFileSync(`${filepath}.info.json`, JSON.stringify({ title: "閃光 — 트와이스 テスト" }), "utf8");
    assert.equal(take.call(null, filepath).title, "閃光 — 트와이스 テスト");
  });
});

test("파일이 없으면 둘 다 null (다운로드 자체는 성공한 것이므로 조용히 넘어간다)", () => {
  withTemp((filepath) => {
    assert.deepEqual(take.call(null, filepath), NONE);
  });
});

test("깨진 JSON이어도 던지지 않고 파일을 치운다", () => {
  withTemp((filepath) => {
    const info = `${filepath}.info.json`;
    fs.writeFileSync(info, "{ 이건 JSON이 아니다", "utf8");

    assert.deepEqual(take.call(null, filepath), NONE);
    assert.equal(fs.existsSync(info), false, "읽지 못해도 치운다");
  });
});

test("제목이 비어 있으면 제목만 null (빈 제목으로 덮어쓰지 않는다)", () => {
  withTemp((filepath) => {
    fs.writeFileSync(`${filepath}.info.json`, JSON.stringify({ title: "   ", duration: 312 }), "utf8");
    assert.deepEqual(take.call(null, filepath), { title: null, durationSec: 312 });
  });
});

test("길이가 없거나 0이면 null (모르는 길이로 덮어쓰지 않는다)", () => {
  withTemp((filepath) => {
    fs.writeFileSync(`${filepath}.info.json`, JSON.stringify({ title: "곡", duration: 0 }), "utf8");
    assert.equal(take.call(null, filepath).durationSec, null);
  });
});
