"use strict";

// src/replyLifetime.js — 본인에게만 보이는 응답의 수명 표와 지우기 예약

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const { scheduleReplyCleanup, lifetimeOf, DEFAULT_MS } = require("../src/replyLifetime");

function command(name, over = {}) {
  const calls = [];
  return { calls, isChatInputCommand: () => true, commandName: name, ephemeral: true, replied: true, deferred: false, deleteReply: async () => calls.push("deleted"), ...over };
}

function component(customId, over = {}) {
  const calls = [];
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
