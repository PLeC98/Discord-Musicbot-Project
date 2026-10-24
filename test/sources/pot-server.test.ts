// src/sources/youtube/pot-server.ts — bgutil POToken 서버를 실행하고 지키기.
// 프로세스 실행 · 설치 확인 · HTTP 는 가짜를 넘긴다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { withConfig } from "../helpers/config.ts";
import sink from "../../src/infra/log/sink.ts";
import logger from "../../src/infra/log/logger.ts";
import { createPotServer, scrubBgutilLine, PORT } from "../../src/sources/youtube/pot-server.ts";

test("토큰은 로그에 남기지 않는다", () => {
  assert.equal(scrubBgutilLine("Generated IntegrityToken: abc.def-123"), "Generated IntegrityToken: [REDACTED]");
  assert.equal(scrubBgutilLine('{"poToken":"AAAAAAAAAAAAAAAA"}'), '{"poToken":"[REDACTED]"}');
  assert.equal(scrubBgutilLine("integrityToken=Zz9_zz9-zz9"), "integrityToken=[REDACTED]");
  assert.equal(scrubBgutilLine("poToken: short"), "poToken: short", "여덟 글자보다 짧으면 토큰이 아니다");
  assert.equal(scrubBgutilLine("서버 시작"), "서버 시작");
});

// 실행한 프로세스 대신. 무엇으로 실행했고 무엇을 받았는지 남긴다
type FakeProc = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; killed: NodeJS.Signals | null | undefined; kill(sig?: NodeJS.Signals): unknown };

function fakeSpawn() {
  const spawned: Array<{ cmd: string; args: string[]; opts: { cwd: string }; proc: FakeProc }> = [];
  const spawn = (cmd: string, args: string[], opts: { cwd: string }) => {
    const proc: FakeProc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), killed: null, kill: (sig?: NodeJS.Signals) => (proc.killed = sig) });
    spawned.push({ cmd, args, opts, proc });
    return proc;
  };
  return { spawn, spawned };
}

test("꺼져 있으면 설치돼 있어도 실행하지 않고, 준비를 기다리지 않는다", async () => {
  const { spawn, spawned } = fakeSpawn();
  const server = createPotServer({ spawn, exists: () => true });
  await withConfig({ bgutil: { enabled: false } }, async () => {
    server.start();
    assert.equal(await server.waitReady(10), true);
  });
  assert.equal(spawned.length, 0);
  server.stop(); // 실행한 것이 없어도 된다
});

test("켜져 있어도 설치돼 있지 않으면 실행하지 않는다", async () => {
  const { spawn, spawned } = fakeSpawn();
  await withConfig({ bgutil: { enabled: true } }, () => createPotServer({ spawn, exists: () => false }).start());
  assert.equal(spawned.length, 0);
});

test("켜져 있고 설치돼 있으면 서버 폴더에서 실행하고, /ping 이 답하면 준비된 것이다", async () => {
  const { spawn, spawned } = fakeSpawn();
  const pings: string[] = [];
  let up = 0;
  const fetch = async (url: string) => {
    pings.push(url);
    if (++up < 2) throw new Error("ECONNREFUSED");
    return { ok: true };
  };
  const server = createPotServer({ spawn, exists: () => true, fetch });
  await withConfig({ bgutil: { enabled: true } }, async () => {
    server.start();
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0].args, ["build/main.js"]);
    assert.match(spawned[0].opts.cwd, /[\\/]vendor[\\/]bgutil-ytdlp-pot-provider[\\/]server$/);
    assert.equal(await server.waitReady(5000), true);
  });
  assert.equal(pings.length, 2, "답할 때까지 다시 묻는다");
  assert.equal(pings[0], `http://127.0.0.1:${PORT}/ping`);

  server.stop();
  assert.equal(spawned[0].proc.killed, "SIGTERM");
});

test("준비가 시간 안에 안 되면 기다림을 접는다(봇은 POToken 없이 켠다)", async () => {
  const { spawn } = fakeSpawn();
  const server = createPotServer({ spawn, exists: () => true, fetch: async () => ({ ok: false }) });
  await withConfig({ bgutil: { enabled: true } }, async () => {
    server.start();
    assert.equal(await server.waitReady(300), false);
  });
  server.stop();
});

test("내리면 꺼질 때까지 기다린다: 실행한 것이 없으면 none, 꺼지면 stopped, 1초 안에 안 꺼지면 timeout", async (t) => {
  assert.equal(await createPotServer({ spawn: fakeSpawn().spawn, exists: () => true }).stop(), "none");

  const { spawn, spawned } = fakeSpawn();
  const server = createPotServer({ spawn, exists: () => true });
  await withConfig({ bgutil: { enabled: true } }, () => server.start());
  const stopped = server.stop();
  assert.equal(spawned[0].proc.killed, "SIGTERM");
  spawned[0].proc.emit("exit", null);
  assert.equal(await stopped, "stopped");

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stuck = fakeSpawn();
  const slow = createPotServer({ spawn: stuck.spawn, exists: () => true });
  await withConfig({ bgutil: { enabled: true } }, () => slow.start());
  const waiting = slow.stop();
  t.mock.timers.tick(1000);
  assert.equal(await waiting, "timeout");
});

test("비정상 종료면 5초 뒤 다시 실행하고, 내린 뒤의 종료는 다시 실행하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { spawn, spawned } = fakeSpawn();
  const server = createPotServer({ spawn, exists: () => true });
  await withConfig({ bgutil: { enabled: true } }, async () => {
    server.start();
    spawned[0].proc.emit("exit", 1);
    t.mock.timers.tick(4999);
    assert.equal(spawned.length, 1);
    t.mock.timers.tick(1);
    assert.equal(spawned.length, 2);

    server.stop();
    spawned[1].proc.emit("exit", null);
    t.mock.timers.tick(10_000);
    assert.equal(spawned.length, 2);
  });
});

test("서버 출력은 토큰을 가려 흘린다(오류 줄도 멈추지 않는다)", async () => {
  const { spawn, spawned } = fakeSpawn();
  const server = createPotServer({ spawn, exists: () => true });
  await withConfig({ bgutil: { enabled: true } }, () => server.start());
  const { proc } = spawned[0];
  // 표준 출력은 debug 로 흘리므로 그동안만 debug 를 남긴다
  const level = logger.level;
  logger.level = "debug";
  const from = sink.buffer.length;
  try {
    proc.stdout.emit("data", Buffer.from("Generated IntegrityToken: secret\n\nnext\n"));
    proc.stderr.emit("data", Buffer.from("Error: could not listen on port\n"));
    proc.stderr.emit("data", Buffer.from("warn line\n"));
  } finally {
    logger.level = level;
    server.stop();
  }

  const lines = sink.buffer
    .slice(from)
    .filter((e) => e.sub === "bgutil")
    .map((e) => ({ level: e.level, text: e.text }));
  assert.ok(
    lines.every(({ text }) => !text.includes("secret")),
    "토큰 값이 로그에 남지 않는다",
  );
  assert.deepEqual(
    lines.map(({ level }) => level),
    ["debug", "debug", "error", "warn"],
    "표준 출력은 debug, 오류 줄은 error, 나머지 표준 오류는 warn. 빈 줄은 버린다",
  );
  assert.match(lines[0].text, /Generated IntegrityToken: \[REDACTED\]/);
});

// 치명적 종료는 stop() 을 부르지 않는다. 레지스트리가 프로세스가 끝날 때 함께 내리게 등록해 둔다
test("실행한 서버를 프로세스 레지스트리에 올리고, 끝나면 내린다", async () => {
  const procRegistry = await import("../../src/infra/process-registry.ts");
  const { spawn: base, spawned } = fakeSpawn();
  // 레지스트리는 pid 가 있는 것만 받는다. 실제로 없는 번호를 쓰고, 테스트 안에서 반드시 끝낸다
  const spawn = (cmd: string, args: string[], opts: { cwd: string }) => Object.assign(base(cmd, args, opts), { pid: 2_000_000_001, exitCode: null, signalCode: null });
  const server = createPotServer({ spawn, exists: () => true });
  await withConfig({ bgutil: { enabled: true } }, () => server.start());
  try {
    assert.ok(procRegistry.list().some((e) => e.label === "bgutil"));
  } finally {
    server.stop();
    spawned[0].proc.emit("exit", 0);
  }
  assert.ok(!procRegistry.list().some((e) => e.label === "bgutil"));
});
