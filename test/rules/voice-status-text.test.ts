// src/rules/voice-status-text.ts: 음성 채널 상태 문구(앞 글의 앱 이모지만 바꾸고 500자로)

import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceStatusText, VOICE_STATUS_MAX } from "../../src/rules/voice-status-text.ts";
import type { EmojiBook } from "../../src/rules/app-emoji-token.ts";

const PLAY = { id: "111111111111111111", name: "play", animated: false };
const book: EmojiBook = { emojis: [PLAY], iconUnicode: (name) => (name === "pause" ? "⏸️" : undefined) };
const TOKEN = `<:play:${PLAY.id}>`;

test("앞 글의 토큰은 지금 이모지로, 없는 것은 대신 쓸 유니코드나 빈 글로. 곡 제목은 그대로", () => {
  assert.equal(voiceStatusText(`<:old_name:${PLAY.id}> `, "곡", book), `${TOKEN} 곡`);
  assert.equal(voiceStatusText("<:pause:999999999999999999> ", "곡", book), "⏸️ 곡");
  assert.equal(voiceStatusText("<:gone:999999999999999999>", " 곡", book), "곡");
  assert.equal(voiceStatusText(`${TOKEN} `, "<:gone:999999999999999999> 제목", book), `${TOKEN} <:gone:999999999999999999> 제목`, "제목 안의 토큰 같은 글은 건드리지 않는다");
  assert.equal(voiceStatusText("💤 대기 중  ", "", book), "💤 대기 중");
});

test("500자를 넘으면 제목 끝부터 자르고, 이모지를 반으로 자르지 않는다", () => {
  const head = `${TOKEN} `;
  const out = voiceStatusText(head, "가".repeat(600), book);
  assert.equal(out.length, VOICE_STATUS_MAX);
  assert.ok(out.startsWith(head));
  const emojiTitle = "a".repeat(VOICE_STATUS_MAX - head.length - 1) + "😀😀";
  const cut = voiceStatusText(head, emojiTitle, book);
  assert.ok(cut.length <= VOICE_STATUS_MAX && !/[\uD800-\uDBFF]$/.test(cut), "서로게이트 반쪽이 남지 않는다");
});

test("앞 글만으로 넘치면 한도에 걸친 토큰은 통째로 뺀다", () => {
  const lead = "가".repeat(VOICE_STATUS_MAX - 10) + TOKEN;
  const out = voiceStatusText(lead, "곡", book);
  assert.equal(out, "가".repeat(VOICE_STATUS_MAX - 10));
});
