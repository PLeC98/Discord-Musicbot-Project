"use strict";

// src/sources/youtube/potServer.js — bgutil POToken 서버를 띄우고 지키기.
// 프로세스 띄우기 · 설치 확인 · HTTP 는 가짜를 넘긴다.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { withConfig } = require("../helpers/config");
const { createPotServer, scrubBgutilLine, PORT } = require("../../src/sources/youtube/potServer");

test("토큰은 로그에 남기지 않는다", () => {
  assert.equal(scrubBgutilLine("Generated IntegrityToken: abc.def-123"), "Generated IntegrityToken: [REDACTED]");
  assert.equal(scrubBgutilLine('{"poToken":"AAAAAAAAAAAAAAAA"}'), '{"poToken":"[REDACTED]"}');
  assert.equal(scrubBgutilLine("integrityToken=Zz9_zz9-zz9"), "integrityToken=[REDACTED]");
  assert.equal(scrubBgutilLine("poToken: short"), "poToken: short", "여덟 글자보다 짧으면 토큰이 아니다");
  assert.equal(scrubBgutilLine("서버 시작"), "서버 시작");
});

// 띄운 프로세스 대신. 무엇으로 띄웠고 무엇을 받았는지 남긴다
function fakeSpawn() {
  const spawned = [];
  const spawn = (cmd, args, opts) => {
    const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), killed: null, kill: (sig) => (proc.killed = sig) });
    spawned.push({ cmd, args, opts, proc });
    return proc;
  };
  return { spawn, spawned };
}

test("꺼져 있으면 설치돼 있어도 띄우지 않고, 준비를 기다리지 않는다", async () => {
  const { spawn, spawned } = fakeSpawn();
  const server = createPotServer({ spawn, exists: () => true });
  await withConfig({ bgutil: { enabled: false } }, async () => {
    server.start();
    assert.equal(await server.waitReady(10), true);
  });
  assert.equal(spawned.length, 0);
  server.stop(); // 띄운 것이 없어도 된다
});

test("켜져 있어도 설치돼 있지 않으면 띄우지 않는다", async () => {
  const { spawn, spawned } = fakeSpawn();
  await withConfig({ bgutil: { enabled: true } }, () => createPotServer({ spawn, exists: () => false }).start());
  assert.equal(spawned.length, 0);
});

test("켜져 있고 설치돼 있으면 서버 폴더에서 띄우고, /ping 이 답하면 준비된 것이다", async () => {
  const { spawn, spawned } = fakeSpawn();
  const pings = [];
  let up = 0;
  const fetch = async (url) => {
    pings.push(url);
    if (++up < 2) throw new Error("ECONNREFUSED");
    return { ok: true };
  };
  const server = createPotServer({ spawn, exists: () => true, fetch });
  await withConfig({ bgutil: { enabled: true } }, async () => {
    server.start();
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0].args, ["build/main.js"]);
    assert.match(spawned[0].opts.cwd, /bgutil-ytdlp-pot-provider[\\/]server$/);
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

test("비정상 종료면 5초 뒤 다시 띄우고, 내린 뒤의 종료는 다시 띄우지 않는다", async (t) => {
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
  proc.stdout.emit("data", Buffer.from("Generated IntegrityToken: secret\n\nnext\n"));
  proc.stderr.emit("data", Buffer.from("Error: could not listen on port\n"));
  proc.stderr.emit("data", Buffer.from("warn line\n"));
  server.stop();
});
