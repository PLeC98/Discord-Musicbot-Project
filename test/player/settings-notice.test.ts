// 설정 필드(볼륨 · 반복 · 자동재생 · 멈춤 · 채널)을 바꾸는 길은 모두 세션 저장에 알린다. 알림을 받은 저장이 잠깐 모았다가 쓴다(sessionPersistence 테스트)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { GuildTextBasedChannel, VoiceBasedChannel } from "discord.js";
import type { Player } from "../../src/player/player.ts";
import * as h from "../helpers/player-harness.ts";
import { useDefaultDocuments } from "../helpers/config-docs.ts";

useDefaultDocuments();
beforeEach(() => h.reset());

const text = { id: "text2", name: "text2" } as unknown as GuildTextBasedChannel;
const voice = { id: "voice2", name: "voice2" } as unknown as VoiceBasedChannel;

const changes: Array<[string, (p: Player) => unknown]> = [
  ["볼륨", (p) => p.setVolume(40)],
  ["반복", (p) => p.setLoop("queue")],
  ["자동재생", (p) => p.setAutoplay(false)],
  ["멈춤", (p) => p.pauseFor("manual")],
  ["멈춤 풀기", (p) => p.resumeFor("manual")],
  ["채널", (p) => p.bindChannels({ voice, text })],
  ["패널 옮기기", (p) => p.movePanel(text)],
];

for (const [name, change] of changes) {
  test(`설정 알림: ${name}`, () => {
    const p = h.makePlayer();
    try {
      change(p);
      assert.ok(h.calls.settings > 0);
    } finally {
      h.dispose(p);
    }
  });
}
