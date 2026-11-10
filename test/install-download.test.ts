// scripts/download.ts: 설치 스크립트의 파일 받기
//
// 지키는 것: 응답 헤더나 다음 조각이 정한 시간 동안 오지 않으면 끊는다(설치가 영영 멈추지 않는다).
// 전체 시간은 묶지 않아 느리지만 꾸준히 오는 큰 파일은 끝까지 받는다. 2xx가 아니면 상태 코드와 주소를 담아 던진다.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { download } from "../scripts/download.ts";

const IDLE_MS = 400;
const sockets = new Set<Socket>();
const server = http.createServer((req, res) => {
  if (req.url === "/silent") return; // 헤더도 보내지 않는다
  if (req.url === "/missing") return void res.writeHead(404).end();
  res.writeHead(200);
  if (req.url === "/stall") return void res.write("앞부분"); // 본문을 보내다 멈춘다
  // 정한 시간보다 짧은 간격으로 조각 여덟 개: 다 받는 데는 정한 시간보다 오래 걸린다
  let n = 0;
  const timer = setInterval(() => {
    res.write(String(n));
    if (++n === 8) {
      clearInterval(timer);
      res.end();
    }
  }, IDLE_MS / 5);
});
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(() => {
  for (const socket of sockets) socket.destroy();
  server.close();
});

test("응답 헤더가 정한 시간 동안 오지 않으면 끊는다", async () => {
  await assert.rejects(download(`${base}/silent`, { idleMs: IDLE_MS }), /받은 것이 없어 끊음/);
});

test("본문을 받는 도중 정한 시간 동안 아무것도 오지 않으면 끊는다", async () => {
  await assert.rejects(download(`${base}/stall`, { idleMs: IDLE_MS }), /받은 것이 없어 끊음/);
});

test("조각이 꾸준히 오면 전체가 정한 시간보다 오래 걸려도 끝까지 받는다", async () => {
  const started = Date.now();
  const body = await download(`${base}/slow`, { idleMs: IDLE_MS });
  assert.equal(body.toString(), "01234567");
  assert.ok(Date.now() - started > IDLE_MS, "정한 시간보다 오래 걸린 받기");
});

test("2xx가 아니면 상태 코드와 주소를 담아 던진다", async () => {
  await assert.rejects(download(`${base}/missing`, { idleMs: IDLE_MS }), (error: Error) => error.message.startsWith("404 Not Found.") && error.message.includes("/missing"));
});
