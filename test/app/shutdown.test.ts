// src/app/shutdown.js — 종료 신호를 받으면 저장하고 정리한 뒤 나간다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installShutdown, type ShutdownBoundary } from "../../src/app/shutdown.ts";
import { fakeWith } from "../helpers/fake.ts";

function setup({ saveFails = false } = {}) {
  const steps: string[] = [];
  // 음성 라이브러리가 들고 있는 연결. 플레이어가 끊으면 빠진다(진짜도 destroy 가 목록에서 뺀다)
  const live = new Map();
  const connection = (id: string, fails = false) => ({
    destroy: () => {
      if (fails) throw new Error("이미 끊김");
      steps.push(`voice:${id}`);
      live.delete(id);
    },
  });
  live.set("g1", connection("g1"));
  live.set("g9", connection("g9"));
  live.set("g8", connection("g8", true));

  const player = (id: string) => ({
    persistState: async (reason: string, immediate: boolean) => {
      steps.push(`save:${id}:${reason}:${immediate}`);
      if (saveFails) throw new Error("저장 실패");
    },
    disconnect: (reason: string) => {
      steps.push(`disconnect:${id}:${reason}`);
      live.get(id)?.destroy();
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
  const proc = fakeWith<ShutdownBoundary["proc"]>()(Object.assign(new EventEmitter(), { platform: "linux", stdin: { isTTY: false } }));
  let exits = 0;
  const exited = new Promise((resolve) => {
    installShutdown(client, {
      potServer: { stop: () => steps.push("pot:stop") },
      logFile: { close: () => steps.push("log:close") },
      proc,
      voiceConnections: () => new Map(live),
      killAll: (reason: string) => steps.push(`kill:${reason}`),
      exit: (code: number) => {
        exits++;
        resolve(code);
      },
    });
  });
  return { steps, proc, exited, exits: () => exits };
}

test("신호를 받으면 세션을 저장하고, 플레이어가 음성을 끊고, 남은 연결 · 봇 · POToken 서버 · 자식 프로세스 · 로그 파일을 정리하고 0 으로 나간다", async () => {
  const { steps, proc, exited } = setup();
  proc.emit("SIGTERM");
  assert.equal(await exited, 0);
  assert.deepEqual(steps, ["save:g1:shutdown:true", "disconnect:g1:프로세스 종료(SIGTERM)", "voice:g1", "voice:g9", "client:destroy", "pot:stop", "kill:SIGTERM", "log:close"]);
});

test("레지스트리에 없는 음성 연결도 끊는다. 저장이나 끊기가 실패해도 끝까지 간다", async () => {
  const { steps, proc, exited } = setup({ saveFails: true });
  proc.emit("SIGHUP");
  assert.equal(await exited, 0);
  assert.ok(steps.includes("voice:g9"), "레지스트리에 없던 연결");
  assert.equal(steps.at(-2), "kill:SIGHUP");
});

test("신호가 두 번 들어와도(Windows 의 Ctrl+C) 한 번만 정리한다", async () => {
  const { steps, proc, exited, exits } = setup();
  proc.emit("SIGINT");
  proc.emit("SIGINT");
  assert.equal(await exited, 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(exits(), 1);
  assert.equal(steps.filter((s) => s.startsWith("save:")).length, 1);
});
