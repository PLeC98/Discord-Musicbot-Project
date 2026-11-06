// src/player/player.ts: 설정 필드(볼륨, 반복, 자동재생, 멈춤, 채널)를 바꾸는 길은 모두 세션 저장에 알린다. 알림을 받은 저장이 잠깐 모았다가 쓰는 것은 session-persistence 테스트가 본다

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
  ["멈춤", (p) => p.pause.setUser(true)],
  [
    "멈춤 풀기",
    (p) => {
      p.pause.setUser(true);
      h.calls.settings = 0;
      p.pause.setUser(false);
    },
  ],
  ["억제 사유", (p) => p.pause.setHolds(["alone"])],
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

// 주기 저장은 멈춘 플레이어를 건너뛰고, 세션 행에는 사람의 멈춤만 있다. 멈춘 위치는 그때 곧바로 쓴다
for (const [name, pause] of [
  ["사람의 멈춤", (p: Player) => p.pause.setUser(true)],
  ["억제 사유", (p: Player) => p.pause.setHolds(["alone"])],
] as const) {
  test(`멈추면 그 위치를 곧바로 쓴다: ${name}`, () => {
    const p = h.makePlayer();
    try {
      pause(p);
      assert.equal(h.calls.positions, 1);
    } finally {
      h.dispose(p);
    }
  });
}

test("멈춤을 풀 때는 위치를 쓰지 않는다(재생 중에는 주기 저장이 쓴다)", () => {
  const p = h.makePlayer();
  try {
    p.pause.setUser(true);
    h.calls.positions = 0;
    p.pause.setUser(false);
    assert.equal(h.calls.positions, 0);
  } finally {
    h.dispose(p);
  }
});
