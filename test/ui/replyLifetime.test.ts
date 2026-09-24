// src/ui/replyLifetime.ts — 본인에게만 보이는 응답의 수명 표와 지우기 예약

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { scheduleReplyCleanup, keepReply, expireReply, lifetimeOf, DEFAULT_MS } from "../../src/ui/replyLifetime.ts";

function command(name: string, over: object = {}) {
  const calls: string[] = [];
  return { calls, isChatInputCommand: () => true, commandName: name, ephemeral: true, replied: true, deferred: false, deleteReply: async () => calls.push("deleted"), ...over };
}

function component(customId: string, over: object = {}) {
  const calls: string[] = [];
  return { calls, isChatInputCommand: () => false, customId, ephemeral: true, replied: true, deferred: false, deleteReply: async () => calls.push("deleted"), ...over };
}

test("수명 표: 기본값, 명령 예외, 버튼 예외", () => {
  assert.equal(lifetimeOf(command("pause")), DEFAULT_MS);
  assert.equal(lifetimeOf(command("leave")), 30_000);
  assert.equal(lifetimeOf(command("queue")), null);
  assert.equal(lifetimeOf(component("music_pause:u1:s1")), DEFAULT_MS);
  assert.equal(lifetimeOf(component("music_queue:u1:s1")), null);
  assert.equal(lifetimeOf(component("help_refresh")), null);
  assert.equal(lifetimeOf(component("volume_modal")), DEFAULT_MS);
});

// 자동재생 버튼은 끄기(결과)와 켜기(선택 메뉴) 두 가지를 한다. 표에 null을 걸면 선택 메뉴는 남지만
// 끄기 결과까지 남는다(실제로 그랬다) — 그래서 표가 아니라 핸들러가 선언한다.
test("한 버튼의 두 분기: 표는 기본값을 주고, 남길 쪽만 핸들러가 선언한다", () => {
  assert.equal(lifetimeOf(component("music_autoplay:u1:s1")), DEFAULT_MS, "끄기 결과는 지워진다");

  const menu = component("music_autoplay:u1:s1");
  keepReply(menu);
  assert.equal(lifetimeOf(menu), null, "선택 메뉴는 남는다");
});

// update()는 ephemeral을 기록하지 않아 기본 규칙이 거른다. 선택 메뉴를 결과로 덮은 자리는 지워야 한다.
test("expireReply: update로 답한 응답도 선언하면 지운다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const interaction = component("autoplay_genre:u1:s1", { ephemeral: null });
  expireReply(interaction);
  scheduleReplyCleanup(interaction);

  t.mock.timers.tick(DEFAULT_MS);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(interaction.calls, ["deleted"]);
});

test("본인에게만 보이는 응답은 수명이 지나면 지운다 — 한 번만 예약한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const interaction = command("skip");

  scheduleReplyCleanup(interaction);
  scheduleReplyCleanup(interaction); // 여러 핸들러가 끝날 때마다 불러도

  t.mock.timers.tick(DEFAULT_MS - 1);
  await Promise.resolve();
  assert.deepEqual(interaction.calls, []);

  t.mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(interaction.calls, ["deleted"]);
});

test("지우지 않는 경우: 공개 응답, 아직 응답 안 함, 버튼으로 메시지를 고친 응답, 표에서 null", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const cases = [
    command("pause", { ephemeral: false }),
    command("pause", { replied: false }),
    component("sb:toggle", { ephemeral: null }), // update는 ephemeral을 기록하지 않는다
    command("nowplaying"),
  ];
  for (const interaction of cases) scheduleReplyCleanup(interaction);

  t.mock.timers.tick(60 * 60_000);
  await new Promise((resolve) => setImmediate(resolve));
  for (const interaction of cases) assert.deepEqual(interaction.calls, []);
});

test("지우기가 실패해도(이미 닫음) 던지지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const interaction = command("stop", { deleteReply: async () => Promise.reject(Object.assign(new Error("Unknown Message"), { code: 10008 })) });
  scheduleReplyCleanup(interaction);
  t.mock.timers.tick(DEFAULT_MS);
  await new Promise((resolve) => setImmediate(resolve));
});

mock.reset();
