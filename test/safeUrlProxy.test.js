"use strict";

// src/SafeUrl.js — 프록시 우회 차단.
//
// 회귀 대상: 이 모듈의 핵심 보장은 "검증한 IP로 직접 접속"(핀 에이전트)인데, axios는 Node에서
// HTTP_PROXY/HTTPS_PROXY 환경변수를 자동으로 사용한다. 프록시를 타면 목적지를 프록시가 다시
// 해석하므로 핀이 무의미해지고 DNS 리바인딩·내부망 차단 보장이 통째로 깨진다.

const path = require("node:path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// ── axios 모킹 (SafeUrl require 전에 — 실 네트워크 미접촉) ──────────────────
const axiosPath = require.resolve("axios");
const captured = [];
const fakeAxios = (cfg) => {
  captured.push(cfg);
  return Promise.resolve({ status: 200, headers: { "content-type": "audio/mpeg" }, data: null });
};
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: fakeAxios };

const { head } = require(path.join(__dirname, "..", "src", "SafeUrl.js"));

const ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
const saved = {};

before(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    process.env[k] = "http://127.0.0.1:9";
  }
});

after(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("프록시 환경변수가 설정돼 있어도 요청은 프록시를 타지 않는다", async () => {
  captured.length = 0;

  // 공인 IP 리터럴 — DNS를 타지 않으므로 오프라인에서 검증 경로 전체를 지난다
  await head("https://1.1.1.1/audio.mp3");

  assert.equal(captured.length, 1);
  assert.equal(captured[0].proxy, false, "proxy:false가 없으면 axios가 환경변수 프록시를 쓴다");
  assert.ok(captured[0].httpsAgent, "핀 에이전트가 실려야 한다");
});
