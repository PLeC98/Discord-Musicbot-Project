"use strict";

// src/sources/ytdlpInfo.js — yt-dlp JSON 경계. 쓰는 칸만 뽑고, 모양이 바뀐 칸만 버린다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readInfo } = require("../../src/sources/ytdlpInfo");

test("쓰는 칸만 뽑고 나머지는 흘려보낸다", () => {
  const info = readInfo({ id: "abc", title: "곡", duration: 200, webpage_url: "https://www.youtube.com/watch?v=abc", requested_subtitles: {}, _version: { v: 1 } });
  assert.deepEqual(info, { id: "abc", title: "곡", duration: 200, webpage_url: "https://www.youtube.com/watch?v=abc" });
});

test("모양이 바뀐 칸은 그 칸만 버린다. 곡을 통째로 버리지 않는다", () => {
  const info = readInfo({ id: 123, title: "곡", duration: "200", is_live: "no", thumbnails: [{ url: "https://i/1.jpg", width: 10 }] });
  assert.equal(info.id, 123, "사운드클라우드 id 는 숫자다");
  assert.equal(info.title, "곡");
  assert.equal("duration" in info, false);
  assert.equal("is_live" in info, false);
  assert.deepEqual(info.thumbnails, [{ url: "https://i/1.jpg", width: 10 }]);
});

test("null 은 null 로 남는다(라이브의 길이 등). 객체가 아니면 null", () => {
  assert.equal(readInfo({ duration: null }).duration, null);
  assert.equal(readInfo(null), null);
  assert.equal(readInfo("문자열"), null);
  assert.equal(readInfo([{ id: "a" }]), null);
});
