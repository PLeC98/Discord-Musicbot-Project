"use strict";

// 음성 채널 상태를 덮어써도 되는가 — 봇이 적은 것만 건드린다.
//
// 회귀: prefix 기본값이 빈 문자열인데 `"아무 상태".startsWith("")`는 언제나 참이라,
// 사람이 적어 둔 채널 상태까지 봇 것으로 판정해 덮어썼다.

process.env.DISCORD_TOKEN ||= "test-token";
process.env.CLIENT_ID ||= "test-client";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const config = require("../config");
const MusicPlayer = require("../src/MusicPlayer");

const { isBotOwnedStatus } = MusicPlayer._internals;

function withVoiceStatus(values, fn) {
  const saved = { ...config.voiceStatus };
  Object.assign(config.voiceStatus, values);
  try {
    fn();
  } finally {
    Object.assign(config.voiceStatus, saved);
  }
}

test("prefix가 비어 있으면 사람이 적은 상태를 건드리지 않는다", () => {
  withVoiceStatus({ playingPrefix: "", pausedPrefix: "", idleText: "" }, () => {
    assert.equal(isBotOwnedStatus("점심 먹고 옴"), false, "빈 prefix는 아무것도 가리키지 않는다");
    assert.equal(isBotOwnedStatus(""), true, "비어 있으면 아무도 안 쓴 것 — 우리가 써도 된다");
    assert.equal(isBotOwnedStatus(null), true);
  });
});

test("prefix를 설정했으면 그것으로 가른다", () => {
  withVoiceStatus({ playingPrefix: "▶️ ", pausedPrefix: "⏸️ ", idleText: "대기 중" }, () => {
    assert.equal(isBotOwnedStatus("▶️ 노래 제목"), true);
    assert.equal(isBotOwnedStatus("⏸️ 노래 제목"), true);
    assert.equal(isBotOwnedStatus("대기 중"), true, "유휴 문구도 우리 것");
    assert.equal(isBotOwnedStatus("점심 먹고 옴"), false);
  });
});

test("한쪽 prefix만 설정한 경우 — 빈 쪽이 전부를 삼키지 않는다", () => {
  withVoiceStatus({ playingPrefix: "▶️ ", pausedPrefix: "", idleText: "" }, () => {
    assert.equal(isBotOwnedStatus("▶️ 노래"), true);
    assert.equal(isBotOwnedStatus("회의 중"), false);
  });
});
