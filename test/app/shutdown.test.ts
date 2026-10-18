// src/app/shutdown.ts — 종료 신호를 받으면 저장하고 정리한 뒤 나간다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installShutdown, stopFailedStart, type ShutdownBoundary } from "../../src/app/shutdown.ts";
import { fakeWith } from "../helpers/fake.ts";
import { EXIT } from "../../src/app/exit-codes.ts";

// attach: 봇을 붙인 뒤(기본)인가, 기동 중 POToken 서버를 기다리는 때인가
function setup({ saveFails = false, releaseFails = false, status = async () => {}, attach = true }: { saveFails?: boolean; releaseFails?: boolean; status?: () => Promise<unknown>; attach?: boolean } = {}) {
  const steps: string[] = [];
  // 음성 라이브러리가 들고 있는 연결. 정리하면 빠진다(진짜도 destroy 가 목록에서 뺀다).
  // destroy(false) 는 나감 메시지를 보내지 않는다(채널에 남는다)
  const live = new Map();
  const connection = (id: string, fails = false) => ({
    destroy: (adapterAvailable = true) => {
      if (fails) throw new Error("이미 끊김");
      steps.push(`voice:${id}:${adapterAvailable ? "leave" : "stay"}`);
      live.delete(id);
    },
  });
  live.set("g1", connection("g1"));
  live.set("g9", connection("g9"));
  live.set("g8", connection("g8", true));

  const player = (id: string) => ({
    persistence: {
      persistState: async (reason: string) => {
        steps.push(`save:${id}:${reason}`);
        if (saveFails) throw new Error("저장 실패");
      },
    },
    voice: {
      release: (reason: string) => {
        if (releaseFails) throw new Error("연결 정리 실패");
        steps.push(`release:${id}:${reason}`);
        live.get(id)?.destroy(false);
      },
    },
    updateVoiceStatus: async (text: string) => {
      steps.push(`status:${id}:${JSON.stringify(text)}`);
      await status();
    },
  });
  const bot = {
    client: { guilds: { cache: new Map([["g1", { name: "서버1" }]]) }, destroy: () => steps.push("client:destroy") },
    players: new Map([
      ["g1", player("g1")],
      ["g2", null],
    ]),
  };
  const proc = fakeWith<ShutdownBoundary["proc"]>()(Object.assign(new EventEmitter(), { platform: "linux", stdin: { isTTY: false } }));
  let exits = 0;
  let handle: ReturnType<typeof installShutdown> | undefined;
  const exited = new Promise((resolve) => {
    const shutdown = installShutdown({
      potServer: { stop: () => steps.push("pot:stop") },
      logFile: { close: () => steps.push("log:close") },
      proc,
      voiceConnections: () => new Map(live),
      killAll: (reason: string) => steps.push(`kill:${reason}`),
      exit: (code: number) => {
        exits++;
        resolve(code);
      },
      record: { end: (how) => void steps.push(`record:${how}`) },
    });
    if (attach) shutdown.attach(bot);
    handle = shutdown;
  });
  if (!handle) throw new Error("처리기를 걸지 못했다");
  return { steps, proc, exited, exits: () => exits, shutdown: handle };
}

test("신호를 받으면 세션을 저장하고, 음성 채널 상태 문구를 지우고, 채널에는 남긴 채 연결 · 봇 · POToken 서버 · 자식 프로세스 · 로그 파일을 정리하고 0 으로 나간다", async () => {
  const { steps, proc, exited } = setup();
  proc.emit("SIGTERM");
  assert.equal(await exited, 0);
  assert.deepEqual(steps, ["save:g1:shutdown", 'status:g1:""', "release:g1:프로세스 종료(SIGTERM)", "voice:g1:stay", "voice:g9:stay", "record:shutdown", "client:destroy", "pot:stop", "kill:SIGTERM", "log:close"]);
});

test("봇을 붙이기 전(POToken 서버를 기다리는 동안)에 끄면 실행한 것만 내리고 깨끗이 끝났다고 적는다", async () => {
  const { steps, proc, exited } = setup({ attach: false });
  proc.emit("SIGINT");
  assert.equal(await exited, 0);
  assert.deepEqual(
    steps.filter((s) => !s.startsWith("voice:")),
    ["record:shutdown", "pot:stop", "kill:SIGINT", "log:close"],
    "세션 저장 · 봇 내리기는 없다",
  );
});

test("레지스트리에 없는 음성 연결도 채널에는 남긴 채 정리한다. 저장 · 상태 지우기 · 정리가 실패해도 끝까지 간다", async () => {
  const { steps, proc, exited } = setup({ saveFails: true, status: async () => Promise.reject(new Error("권한 없음")) });
  proc.emit("SIGHUP");
  assert.equal(await exited, 0);
  assert.ok(steps.includes("voice:g9:stay"), "레지스트리에 없던 연결");
  assert.equal(steps.at(-2), "kill:SIGHUP");
});

test("종료가 중간에 던져도(연결 정리 실패) 나간다", async () => {
  const { proc, exited } = setup({ releaseFails: true });
  proc.emit("SIGTERM");
  let late: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([exited, new Promise((done) => (late = setTimeout(done, 2000, "나가지 않음")))]);
  clearTimeout(late);
  assert.equal(outcome, 0);
});

test("상태 문구 지우기가 멈춰도 상한만 기다리고 끝낸다", async () => {
  const { steps, proc, exited } = setup({ status: () => new Promise(() => {}) });
  proc.emit("SIGTERM");
  let late: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([exited, new Promise((done) => (late = setTimeout(done, 4000, "상한 없이 기다림")))]);
  clearTimeout(late);
  assert.equal(outcome, 0, "상한(2초) 근처에서 끝난다");
  assert.ok(steps.includes("voice:g1:stay"));
});

// 대시보드의 다시 시작. 끄기와 같은 정리를 하고 다시 시작 코드로 나간다(실행기가 다시 실행한다)
test("다시 시작은 끄기와 같이 정리하고 다시 시작으로 적은 뒤 다시 시작 코드로 나간다. 그사이 신호가 와도 한 번만", async () => {
  const { steps, proc, exited, exits, shutdown } = setup();
  shutdown.restart("운영자");
  proc.emit("SIGINT");
  assert.equal(await exited, EXIT.restart);
  await new Promise((r) => setImmediate(r));
  assert.equal(exits(), 1);
  assert.deepEqual(steps, ["save:g1:shutdown", 'status:g1:""', "release:g1:다시 시작(운영자)", "voice:g1:stay", "voice:g9:stay", "record:restart", "client:destroy", "pot:stop", "kill:운영자", "log:close"]);
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

test("기동이 실패하면 기동 실패로 적고, 봇 · POToken 서버 · 자식 프로세스 · 로그 파일을 내리고, 곧바로가 아니라 잠시 뒤 받은 코드로 나간다", async () => {
  const steps: string[] = [];
  const exited = new Promise((resolve) => {
    stopFailedStart(
      { destroy: () => steps.push("client:destroy") },
      {
        potServer: { stop: () => steps.push("pot:stop") },
        logFile: { close: () => steps.push("log:close") },
        killAll: (reason: string) => steps.push(`kill:${reason}`),
        exit: (code: number) => {
          steps.push(`exit:${code}`);
          resolve(code);
        },
        record: { end: (how) => void steps.push(`record:${how}`) },
      },
      75,
      0,
    );
  });
  assert.deepEqual(steps, ["record:startup-failed", "client:destroy", "pot:stop", "kill:기동 실패", "log:close"], "나가기는 아직");
  assert.equal(await exited, 75);
});
