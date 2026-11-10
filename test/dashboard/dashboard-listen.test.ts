// src/dashboard/binding.ts: 열 주소마다 서버를 연다. ::를 못 열면 0.0.0.0으로, ::1을 못 열면 빼고, 포트가 겹치면 아무것도 열지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import express from "express";
import logSink from "../../src/infra/log/sink.ts";
import { createServer, listenAll } from "../../src/dashboard/binding.ts";

const lines: { level: number; msg: string }[] = [];
logSink.addDestination((rec: unknown) => lines.push(rec as { level: number; msg: string }));

const make = () => createServer(express());
const closeAll = (servers: http.Server[]) => Promise.all(servers.map((s) => new Promise((done) => s.close(done))));

/** 쓰이지 않는 포트 하나 */
async function freePort() {
  const probe = http.createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((done) => probe.close(done));
  return port;
}

/** 그 주소를 열면 code 오류로 실패하는 가짜 서버(나머지 주소는 진짜로 연다) */
function failingOn(failHosts: Record<string, string>) {
  return () => {
    const real = make();
    const listen = real.listen.bind(real) as (port: number, host: string, cb: () => void) => http.Server;
    return Object.assign(real, {
      listen: (port: number, host: string, cb: () => void) => {
        const code = failHosts[host];
        if (!code) return listen(port, host, cb);
        queueMicrotask(() => real.emit("error", Object.assign(new Error(code), { code })));
        return real;
      },
    });
  };
}

test("열 주소마다 서버를 열고 실제로 연 주소를 돌려준다", async () => {
  const port = await freePort();
  const opened = await listenAll(make, ["127.0.0.1"], port);
  try {
    assert.deepEqual(opened.hosts, ["127.0.0.1"]);
    assert.equal(opened.servers.length, 1);
    assert.equal((opened.servers[0].address() as net.AddressInfo).port, port);
  } finally {
    await closeAll(opened.servers);
  }
});

test("포트가 쓰이고 있으면 연 것도 닫고 DASHBOARD_PORT를 안내한다", async () => {
  const taken = http.createServer();
  await new Promise<void>((done) => taken.listen(0, "127.0.0.1", done));
  const { port } = taken.address() as net.AddressInfo;
  lines.length = 0;
  // 만든 서버를 모두 모아 두고 끝에 닫는다(닫지 않고 남기면 테스트가 끝나지 않는다)
  const made: http.Server[] = [];
  const failing = failingOn({ "::1": "EADDRINUSE" });
  try {
    const opened = await listenAll(
      () => {
        const server = failing();
        made.push(server);
        return server;
      },
      ["127.0.0.2", "::1"],
      port,
    );
    assert.deepEqual(opened.servers, []);
    assert.deepEqual(opened.hosts, []);
    const failed = lines.find((l) => l.level >= 50);
    assert.match(failed?.msg ?? "", /DASHBOARD_PORT/);
    // 앞에서 연 127.0.0.2도 닫았다
    const again = http.createServer();
    await new Promise<void>((done, fail) => again.once("error", fail).listen(port, "127.0.0.2", done));
    await new Promise((done) => again.close(done));
  } finally {
    taken.close();
    for (const server of made) if (server.listening) server.close();
  }
});

test("::를 열지 못하면(IPv6가 꺼진 기기) 0.0.0.0으로 연다", async () => {
  const port = await freePort();
  lines.length = 0;
  const opened = await listenAll(failingOn({ "::": "EAFNOSUPPORT" }), ["::"], port);
  try {
    assert.deepEqual(opened.hosts, ["0.0.0.0"]);
    assert.ok(lines.some((l) => l.msg.includes("0.0.0.0")));
  } finally {
    await closeAll(opened.servers);
  }
});

test("::1을 열지 못하면 그 주소만 빼고 연다. 다른 오류는 아무것도 열지 않는다", async () => {
  const port = await freePort();
  const opened = await listenAll(failingOn({ "::1": "EADDRNOTAVAIL" }), ["127.0.0.1", "::1"], port);
  try {
    assert.deepEqual(opened.hosts, ["127.0.0.1"]);
  } finally {
    await closeAll(opened.servers);
  }
  lines.length = 0;
  const denied = await listenAll(failingOn({ "::1": "EACCES" }), ["127.0.0.1", "::1"], await freePort());
  assert.deepEqual(denied.servers, []);
  assert.match(lines.find((l) => l.level >= 50)?.msg ?? "", /EACCES/);
});

// 요청을 읽지 못한 연결이 받는 답. 핸들러를 달아도 Node 의 기본 답과 같아야 한다
function rawReply(port: number, request: string) {
  return new Promise<string>((done) => {
    const socket = net.connect(port, "127.0.0.1");
    let got = "";
    socket.on("data", (chunk) => (got += String(chunk)));
    socket.on("error", () => {
      // 서버가 답을 쓰고 끊는다(덜 읽은 요청이 남으면 RST)
    });
    socket.on("close", () => done(got));
    socket.write(request);
  });
}

test("읽지 못한 요청에는 Node 의 기본 처리와 같은 답을 준다", async () => {
  const { servers } = await listenAll(make, ["127.0.0.1"], 0);
  const [server] = servers;
  const plain = http.createServer();
  await new Promise<void>((done) => plain.listen(0, "127.0.0.1", done));
  const portOf = (one: http.Server) => (one.address() as { port: number }).port;
  // 헤더 상한(16KB)을 넘기되, 서버가 끊을 때 덜 읽은 요청이 남지 않을 크기(남으면 RST 로 답이 사라진다)
  const requests = { 망가진: "이건 요청이 아니다\r\n\r\n", "헤더 큼": `GET / HTTP/1.1\r\nHost: x\r\nX-Big: ${"a".repeat(20 * 1024)}\r\n\r\n` };
  try {
    for (const [what, request] of Object.entries(requests)) {
      const expected = await rawReply(portOf(plain), request);
      assert.match(expected, /^HTTP\/1\.1 4\d\d /, `${what}: 기본 처리가 답을 준다`);
      assert.equal(await rawReply(portOf(server), request), expected, what);
    }
  } finally {
    server.close();
    plain.close();
  }
});

test("연 뒤의 서버 오류는 로그로 남기고 프로세스를 죽이지 않는다", async () => {
  const opened = await listenAll(make, ["127.0.0.1"], await freePort());
  try {
    lines.length = 0;
    opened.servers[0].emit("error", Object.assign(new Error("boom"), { code: "EMFILE" }));
    assert.match(lines.find((l) => l.level >= 50)?.msg ?? "", /boom/);
  } finally {
    await closeAll(opened.servers);
  }
});

test("서버를 만들다 예외를 던지면 앞에서 연 것도 닫는다(0.0.0.0으로 바꿔 열 때도)", async () => {
  // [열 주소, 몇 번째로 만들 때 던지나]. 둘째는 ::가 EAFNOSUPPORT로 실패한 뒤 0.0.0.0 서버를 만들 때 던진다
  const cases: Array<[string[], number]> = [
    [["127.0.0.1", "127.0.0.2"], 2],
    [["127.0.0.1", "::"], 3],
  ];
  for (const [hosts, throwAt] of cases) {
    const port = await freePort();
    const failing = failingOn({ "::": "EAFNOSUPPORT" });
    let count = 0;
    const made: http.Server[] = [];
    try {
      const opened = await listenAll(
        () => {
          count += 1;
          if (count === throwAt) throw new Error("만들기 실패");
          const server = failing();
          made.push(server);
          return server;
        },
        hosts,
        port,
      );
      assert.deepEqual(opened.servers, [], hosts.join());
      assert.equal(made[0].listening, false, hosts.join());
    } finally {
      for (const server of made) if (server.listening) server.close();
    }
  }
});
