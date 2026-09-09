"use strict";

// 재생목록으로 담은 곡의 제목 교정 (B-38)
//
// 재생목록 페이지가 주는 제목은 같은 영상인데도 영상 자체의 제목과 다를 수 있다.
// 정확한 제목은 이미 두 지점에 도착해 있는데 둘 다 버리고 있었다:
//   - 다운로드: yt-dlp가 곁들여 남기는 info.json (추가 왕복 없음)
//   - 스트림 재생: getStream 응답의 title
//
// 여기서는 그 둘 중 다운로드 쪽 추출을 고정한다. info.json을 **읽고 지우는** 것까지가 계약이다 —
// 남기면 캐시 폴더에 영상마다 100KB대 찌꺼기가 쌓인다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const TrackDownloader = require("../src/TrackDownloader");

const take = TrackDownloader.prototype._takeInfoJsonTitle;

function withTemp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "title-"));
  try {
    return fn(path.join(dir, "track_abc.opus"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("info.json에서 제목을 꺼내고 파일을 지운다", () => {
  withTemp((filepath) => {
    const info = `${filepath}.info.json`;
    fs.writeFileSync(info, JSON.stringify({ title: "【Ado】初夏 (Shoka)", duration: 235 }), "utf8");

    assert.equal(take.call(null, filepath), "【Ado】初夏 (Shoka)");
    assert.equal(fs.existsSync(info), false, "찌꺼기를 남기지 않는다");
  });
});

test("확장자를 바꾼 형태로 쓰인 경우도 찾는다", () => {
  withTemp((filepath) => {
    const info = filepath.replace(/\.opus$/, "") + ".info.json";
    fs.writeFileSync(info, JSON.stringify({ title: "다른 이름 규칙" }), "utf8");

    assert.equal(take.call(null, filepath), "다른 이름 규칙");
    assert.equal(fs.existsSync(info), false);
  });
});

test("UTF-8로 읽는다 (일본어·한국어 제목이 목적이다)", () => {
  withTemp((filepath) => {
    fs.writeFileSync(`${filepath}.info.json`, JSON.stringify({ title: "閃光 — 트와이스 テスト" }), "utf8");
    assert.equal(take.call(null, filepath), "閃光 — 트와이스 テスト");
  });
});

test("파일이 없으면 null (다운로드 자체는 성공한 것이므로 조용히 넘어간다)", () => {
  withTemp((filepath) => {
    assert.equal(take.call(null, filepath), null);
  });
});

test("깨진 JSON이어도 던지지 않고 파일을 치운다", () => {
  withTemp((filepath) => {
    const info = `${filepath}.info.json`;
    fs.writeFileSync(info, "{ 이건 JSON이 아니다", "utf8");

    assert.equal(take.call(null, filepath), null);
    assert.equal(fs.existsSync(info), false, "읽지 못해도 치운다");
  });
});

test("제목이 비어 있으면 null (빈 제목으로 덮어쓰지 않는다)", () => {
  withTemp((filepath) => {
    fs.writeFileSync(`${filepath}.info.json`, JSON.stringify({ title: "   " }), "utf8");
    assert.equal(take.call(null, filepath), null);
  });
});
