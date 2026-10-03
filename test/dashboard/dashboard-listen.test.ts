// src/dashboard/binding.ts — 대시보드를 열고 그 결과를 남긴다. 포트를 못 열면 열었다고 적지 않는다

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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
