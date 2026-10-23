// src/ui/channels.ts — 봇이 그 채널에 글 · 패널을 올릴 수 있는가(채널 권한 덮어쓰기 · 타임아웃 · 스레드)

import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import { canPost, canPostPanel, canReply } from "../../src/ui/channels.ts";

const send = async () => ({});
const { ViewChannel, SendMessages, AttachFiles } = PermissionFlagsBits;
const ALL = [ViewChannel, SendMessages, AttachFiles];
const text = ({ perms = ALL, timedOutUntil = null as number | null } = {}) => ({
  send,
  isThread: () => false,
  guild: { members: { me: { communicationDisabledUntilTimestamp: timedOutUntil } } },
  permissionsFor: () => ({ has: (bit: bigint) => perms.includes(bit) }),
});

test("글: 채널 보기와 메시지 보내기가 둘 다 있어야. 타임아웃이면 못 올린다", () => {
  assert.equal(canPost(text()), true);
  assert.equal(canPost(text({ perms: [SendMessages] })), false, "보기 거부");
  assert.equal(canPost(text({ perms: [ViewChannel] })), false, "보내기 거부");
  assert.equal(canPost(text({ timedOutUntil: Date.now() + 60_000 })), false);
  assert.equal(canPost(text({ timedOutUntil: Date.now() - 60_000 })), true, "끝난 타임아웃");
});

test("글: 보낼 수 없는 채널(음성 · 분류)은 아니고, 서버 채널이 아닌 것(DM)은 권한을 보지 않는다", () => {
  assert.equal(canPost({ isThread: () => false }), false);
  assert.equal(canPost(null), false);
  assert.equal(canPost({ send }), true);
});

test("음성 · 스테이지 채널의 채팅은 연결 권한도 있어야 한다", () => {
  assert.equal(canPost({ ...text(), isVoiceBased: () => true }), false);
  assert.equal(canPost({ ...text({ perms: [...ALL, PermissionFlagsBits.Connect] }), isVoiceBased: () => true }), true);
});

test("답장: 메시지 기록 보기가 있어야", () => {
  assert.equal(canReply(text()), false);
  assert.equal(canReply(text({ perms: [PermissionFlagsBits.ReadMessageHistory] })), true);
});

test("스레드: discord.js 의 판정(sendable)을 따른다. 비공개 스레드는 봇이 들어가 있어야 한다", () => {
  assert.equal(canPost({ ...text(), isThread: () => true, sendable: false }), false);
  assert.equal(canPost({ ...text(), isThread: () => true, sendable: true }), true);
});

test("패널: 썸네일 파일을 붙이니 파일 첨부까지 있어야 한다", () => {
  assert.equal(canPostPanel(text()), true);
  assert.equal(canPostPanel(text({ perms: [ViewChannel, SendMessages] })), false);
  assert.equal(canPostPanel({ ...text({ perms: [ViewChannel, SendMessages] }), isThread: () => true, sendable: true }), false, "스레드도 같다");
});
