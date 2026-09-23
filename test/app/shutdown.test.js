"use strict";

// src/app/shutdown.js — 종료 신호를 받으면 저장하고 정리한 뒤 나간다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { installShutdown } = require("../../src/app/shutdown");

function setup({ saveFails = false } = {}) {
  const steps = [];
  const player = (id) => ({
    persistState: async (reason, immediate) => {
      steps.push(`save:${id}:${reason}:${immediate}`);
      if (saveFails) throw new Error("저장 실패");
    },
  });
  const client = {
    players: new Map([
      ["g1", player("g1")],
      ["g2", null],
    ]),
    guilds: { cache: new Map([["g1", { name: "서버1" }]]) },
    destroy: () => steps.push("client:destroy"),
  };
  const connection = (id, fails = false) => ({
    destroy: () => {
      if (fails) throw new Error("이미 끊김");
      steps.push(`voice:${id}`);
    },
  });
  const proc = Object.assign(new EventEmitter(), { platform: "linux", stdin: { isTTY: false } });
  const exited = new Promise((resolve) => {
    installShutdown(client, {
      potServer: { stop: () => steps.push("pot:stop") },
      logFile: { close: () => steps.push("log:close") },
      proc,
      voiceConnections: () =>
        new Map([
          ["g1", connection("g1")],
          ["g9", connection("g9")],
          ["g8", connection("g8", true)],
        ]),
      killAll: (reason) => steps.push(`kill:${reason}`),
      exit: (code) => resolve(code),
    });
  });
  return { steps, proc, exited };
}

test("신호를 받으면 세션을 저장하고, 음성 연결 · 봇 · POToken 서버 · 자식 프로세스 · 로그 파일을 정리하고 0 으로 나간다", async () => {
  const { steps, proc, exited } = setup();
  proc.emit("SIGTERM");
  assert.equal(await exited, 0);
  assert.deepEqual(steps, ["save:g1:shutdown:true", "voice:g1", "voice:g9", "client:destroy", "pot:stop", "kill:SIGTERM", "log:close"]);
});

test("레지스트리에 없는 음성 연결도 끊는다. 저장이나 끊기가 실패해도 끝까지 간다", async () => {
  const { steps, proc, exited } = setup({ saveFails: true });
  proc.emit("SIGHUP");
  assert.equal(await exited, 0);
  assert.ok(steps.includes("voice:g9"), "레지스트리에 없던 연결");
  assert.equal(steps.at(-2), "kill:SIGHUP");
});

test("SIGINT 도 받는다", async () => {
  const { proc, exited } = setup();
  proc.emit("SIGINT");
  assert.equal(await exited, 0);
});
