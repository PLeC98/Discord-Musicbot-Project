// src/player/idleLeave.ts · src/ui/nowPlayingPanel.ts — 곡이 없을 때 나갈 시각이 바뀌면 끝난 패널이 따라간다.
//
// 회귀 대상: 대기열을 다 튼 뒤 사람이 나가 봇이 혼자 남아도, 끝난 패널은 대기열 소진 기준의
// "n분 후 쉬러 갈게요"를 그대로 보였다. 실제로 나가는 것은 두 타이머 중 먼저 끝나는 쪽이다.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { IdleLeave } from "../../src/player/idleLeave.ts";
import * as playerEvents from "../../src/player/events.ts";
import { MusicEmbedManager } from "../../src/ui/nowPlayingPanel.ts";
import type { MusicPlayer, PanelMessage } from "../../src/player/Player.ts";
import type { Client } from "discord.js";
import { withConfig } from "../helpers/config.ts";
import { fake, fakePlayer } from "../helpers/fake.ts";

const ALONE_MS = 60_000;
const EMPTY_MS = 300_000;

// 퇴장 타이머가 건드리는 것만 둔 플레이어
function player(currentTrack: object | null = null) {
  return fakePlayer({ currentTrack, guild: { id: "g", name: "G" }, voiceChannel: { id: "v", name: "V" }, pauseReasons: new Set(), pauseFor() {}, resumeFor() {} });
}

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

// 알린 시각을 모은다. 타이머는 시험이 끝나면 거둔다(길게 잡아 터지지 않는다)
function watch(idle: InstanceType<typeof IdleLeave>) {
  const told: Array<number | null> = [];
  const off = playerEvents.on("leaving", (_p, at) => told.push(at));
  cleanups.push(() => {
    off();
    idle.stop();
  });
  return told;
}

const near = (actual: number | null | undefined, expected: number) => actual != null && Math.abs(actual - expected) < 2000;

test("곡이 없을 때 혼자 남으면 먼저 끝나는 쪽 시각을, 사람이 돌아오면 대기열 소진 시각을 알린다", () =>
  withConfig({ bot: { leaveDelayAloneMs: ALONE_MS, leaveDelayQueueEmptyMs: EMPTY_MS } }, () => {
    const idle = new IdleLeave(player());
    const told = watch(idle);
    const start = Date.now();
    idle.scheduleEmpty();
    assert.deepEqual(told, [], "대기열 소진 시각은 끝난 패널이 처음부터 적는다");

    idle.startAlone();
    assert.ok(near(told[0], start + ALONE_MS), "혼자 남음이 먼저 끝난다");

    idle.cancelAlone(true);
    assert.ok(near(told[1], start + EMPTY_MS), "돌아오면 대기열 소진 시각으로");
  }));

test("혼자 남음이 대기열 소진보다 늦으면 대기열 소진 시각 그대로", () =>
  withConfig({ bot: { leaveDelayAloneMs: EMPTY_MS * 2, leaveDelayQueueEmptyMs: EMPTY_MS } }, () => {
    const idle = new IdleLeave(player());
    const told = watch(idle);
    const start = Date.now();
    idle.scheduleEmpty();
    idle.startAlone();
    assert.ok(near(told[0], start + EMPTY_MS));
  }));

test("대기열이 끝나 스스로 거둘 때와 재생 중일 때는 알리지 않는다", () =>
  withConfig({ bot: { leaveDelayAloneMs: ALONE_MS, leaveDelayQueueEmptyMs: EMPTY_MS } }, () => {
    const idle = new IdleLeave(player());
    const told = watch(idle);
    idle.startAlone();
    told.length = 0;
    idle.cancelAlone(false);
    assert.deepEqual(told, [], "끝난 패널을 곧 새로 그린다");

    const playing = new IdleLeave(player({ title: "곡" }));
    const toldPlaying = watch(playing);
    playing.startAlone();
    playing.cancelAlone(true);
    assert.deepEqual(toldPlaying, [], "재생 패널은 나갈 시각을 보이지 않는다");
  }));

// ── 패널 ──

class RecordingPanel extends MusicEmbedManager {
  drawn: Array<{ reason: string; leavesAt?: number | null; dedicated: boolean }> = [];
  async _showIdle(_player: MusicPlayer, _live: PanelMessage | null, look: { reason: string; leavesAt?: number | null; dedicated: boolean }) {
    this.drawn.push(look);
  }
  async _panelIsDedicated() {
    return true;
  }
}

test("음성에 남아 기다리는 끝난 패널만 새 시각으로 다시 그린다", async () => {
  const panels = new RecordingPanel(fake<Client>({ players: new Map() }));
  const idlePlayer = fake<MusicPlayer>(player());

  panels.idleViews.set("g", { reason: "queue-end", leavesAt: 1000 });
  await panels.updateIdleLeave(idlePlayer, 500);
  assert.deepEqual(panels.drawn, [{ reason: "queue-end", leavesAt: 500, dedicated: true }]);
  assert.equal(panels.idleViews.get("g")?.leavesAt, 500, "다시 올릴 때도 같은 모양으로");

  await panels.updateIdleLeave(idlePlayer, 500);
  assert.equal(panels.drawn.length, 1, "시각이 같으면 고치지 않는다");

  panels.idleViews.set("g", { reason: "stop", leavesAt: null });
  await panels.updateIdleLeave(idlePlayer, 700);
  assert.equal(panels.drawn.length, 1, "음성을 떠난 모양은 나갈 시각이 없다");

  panels.idleViews.set("g", { reason: "joined", leavesAt: 1000 });
  await panels.updateIdleLeave(fake<MusicPlayer>(player({ title: "곡" })), 700);
  assert.equal(panels.drawn.length, 1, "재생 중이면 끝난 패널이 아니다");
});
