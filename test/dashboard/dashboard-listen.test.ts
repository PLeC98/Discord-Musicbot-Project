// src/dashboard/binding.ts — 대시보드를 열고 그 결과를 남긴다. 포트를 못 열면 열었다고 적지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import express from "express";
import logSink from "../../src/infra/log/sink.ts";
import { listen } from "../../src/dashboard/binding.ts";

const lines: { level: number; msg: string }[] = [];
logSink.addDestination((rec: unknown) => lines.push(rec as { level: number; msg: string }));

const opened = (server: http.Server) => new Promise<void>((done, fail) => server.once("listening", done).once("error", fail));
const settle = () => new Promise((done) => setTimeout(done, 50));

test("포트를 열면 연 주소를 남기고, 열고 난 일을 부른다", async () => {
  lines.length = 0;
  let after = 0;
  const server = listen(express(), { host: "127.0.0.1", port: 0, url: "http://localhost" }, () => after++);
  await opened(server);
  await settle();
  server.close();
  assert.ok(lines.some((l) => l.msg.includes("Dashboard: http://127.0.0.1:0")));
  assert.equal(after, 1);
});

test("포트가 쓰이고 있으면 못 열었다고 남기고 열었다고 적지 않는다", async () => {
  const taken = http.createServer();
  await new Promise<void>((done) => taken.listen(0, "127.0.0.1", done));
  const { port } = taken.address() as { port: number };
  lines.length = 0;
  let after = 0;
  listen(express(), { host: "127.0.0.1", port, url: "http://localhost" }, () => after++);
  await settle();
  taken.close();
  assert.equal(after, 0);
  assert.ok(!lines.some((l) => l.msg.includes("Dashboard:")), JSON.stringify(lines));
  const failed = lines.find((l) => l.level >= 50);
  assert.ok(failed?.msg.includes("EADDRINUSE"), JSON.stringify(lines));
});

// 요청을 읽지 못한 연결이 받는 답. 처리기를 달아도 Node 의 기본 답과 같아야 한다
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
  const server = listen(express(), { host: "127.0.0.1", port: 0, url: "http://localhost" });
  const plain = http.createServer();
  await opened(server);
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
