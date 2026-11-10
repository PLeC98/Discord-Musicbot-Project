// src/ui/channels.ts: 글을 보낼 수 있는 채널, 재생 패널을 올릴 수 있는 채널

import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits, type GuildTextBasedChannel } from "discord.js";
import { canPostPanel } from "../../src/ui/channels.ts";
import { fake } from "../helpers/fake.ts";

// 채널 가짜. perms 는 봇에게 있는 권한
function channel({ thread = false, viewable = true, sendable = true, timedOut = false, perms = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] } = {}) {
  return fake<GuildTextBasedChannel>({
    send: async () => ({}),
    isThread: () => thread,
    viewable,
    sendable,
    guild: { members: { me: { isCommunicationDisabled: () => timedOut } } },
    permissionsFor: () => ({ has: (bit: bigint) => perms.includes(bit) }),
  });
}

test("canPostPanel: 보기(viewable), 보내기, 첨부 권한이 있고 타임아웃이 아니어야 한다. 스레드는 sendable 과 첨부", () => {
  assert.equal(canPostPanel(channel()), true);
  assert.equal(canPostPanel(channel({ viewable: false })), false, "보기 권한이 없으면 보내기 권한이 있어도 403");
  assert.equal(canPostPanel(channel({ perms: [PermissionFlagsBits.AttachFiles] })), false, "보내기");
  assert.equal(canPostPanel(channel({ perms: [PermissionFlagsBits.SendMessages] })), false, "패널은 첨부가 붙는다");
  assert.equal(canPostPanel(channel({ timedOut: true })), false, "타임아웃");
  assert.equal(canPostPanel(channel({ thread: true, viewable: false })), true, "스레드는 sendable 로 본다");
  assert.equal(canPostPanel(channel({ thread: true, sendable: false })), false);
  assert.equal(canPostPanel(channel({ thread: true, perms: [PermissionFlagsBits.SendMessagesInThreads] })), false, "스레드도 첨부");
});
