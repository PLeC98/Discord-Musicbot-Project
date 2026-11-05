// 봇 상태 탭의 업로드: 봇이 보낸 누계(src/infra/upload-meter.ts), 시스템 송신 누계(src/infra/system-upload.ts), 구간 속도(src/dashboard/status/upload.ts).
// 시스템 누계는 프로그램을 띄우지 않는 부분(답 읽기, 차이, sysfs 폴더)만 본다

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Socket } from "node:net";
import { addVoicePacket, countServer, uploadTotals, VOICE_PACKET_OVERHEAD } from "../../src/infra/upload-meter.ts";
import { fromSysfs, parseAnswer, sentBetween, type Sent } from "../../src/infra/system-upload.ts";
import { _reset, closeUploadWindow, startUpload, uploadView } from "../../src/dashboard/status/upload.ts";

beforeEach(_reset);

const fakeSocket = (remoteAddress: string) => Object.assign(new EventEmitter(), { remoteAddress, bytesWritten: 0 });

test("음성: 내준 패킷마다 크기에 헤더(RTP, 암호화, UDP/IP)를 더한다", () => {
  const before = uploadTotals().voice;
  addVoicePacket(200);
  addVoicePacket(100);
  assert.equal(uploadTotals().voice - before, 300 + 2 * VOICE_PACKET_OVERHEAD);
});

test("대시보드: 열린 연결은 지금까지 쓴 만큼, 닫힌 연결은 닫힐 때의 양. 루프백 연결은 세지 않는다", () => {
  const server = new EventEmitter();
  countServer(server as unknown as { on(event: "connection", listener: (socket: Socket) => void): unknown });
  const before = uploadTotals().dashboard;
  const outside = fakeSocket("203.0.113.5");
  const mapped = fakeSocket("::ffff:198.51.100.7");
  const local = [fakeSocket("127.0.0.1"), fakeSocket("::1"), fakeSocket("::ffff:127.0.0.1")];
  for (const socket of [outside, mapped, ...local]) server.emit("connection", socket);

  outside.bytesWritten = 1000;
  mapped.bytesWritten = 50;
  for (const socket of local) socket.bytesWritten = 9999;
  assert.equal(uploadTotals().dashboard - before, 1050);

  outside.emit("close");
  outside.bytesWritten = 5000; // 닫힌 뒤의 값은 다시 읽지 않는다
  mapped.bytesWritten = 80;
  assert.equal(uploadTotals().dashboard - before, 1080);
});

test("시스템 차이: 두 번 다 있는 인터페이스만, 줄어든 인터페이스(다시 만들어짐)는 뺀다", () => {
  const from: Sent = new Map([
    ["eth0", 1000],
    ["wlan0", 500],
    ["gone", 300],
  ]);
  const to: Sent = new Map([
    ["eth0", 4000],
    ["wlan0", 100],
    ["new", 7000],
  ]);
  assert.equal(sentBetween(from, to), 3000);
  assert.equal(sentBetween(new Map(), to), 0);
});

test("PowerShell 답: Id<탭>바이트 줄만, 그 밖의 줄은 버린다", () => {
  const sent = parseAnswer(["{A1}\t123", "{B2}\t0", "{C3}\t", "잡음", "{D4}\t12x"]);
  assert.deepEqual(
    [...sent],
    [
      ["{A1}", 123],
      ["{B2}", 0],
    ],
  );
});

test("Linux: 장치가 있는 인터페이스만, 하나도 없으면(컨테이너) 루프백만 뺀다", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sysnet-"));
  try {
    const iface = (dir: string, name: string, bytes: number, device: boolean) => {
      fs.mkdirSync(path.join(dir, name, "statistics"), { recursive: true });
      fs.writeFileSync(path.join(dir, name, "statistics", "tx_bytes"), `${bytes}\n`);
      if (device) fs.mkdirSync(path.join(dir, name, "device"));
    };
    const host = path.join(root, "host");
    iface(host, "lo", 1, false);
    iface(host, "eth0", 100, true);
    iface(host, "docker0", 200, false);
    iface(host, "veth1", 300, false);
    assert.deepEqual([...(await fromSysfs(host))], [["eth0", 100]]);

    const container = path.join(root, "container");
    iface(container, "lo", 1, false);
    iface(container, "eth0", 400, false);
    assert.deepEqual([...(await fromSysfs(container))], [["eth0", 400]]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("구간 속도: 봇은 음성 + 대시보드, 시스템은 인터페이스 차이. 오늘 보낸 양은 자정부터", async () => {
  let system = 10_000;
  const readSystem = async (): Promise<Sent> => new Map([["eth0", system]]);
  const start = new Date(2026, 9, 10, 23, 59, 30).getTime();
  await startUpload(readSystem, start);

  addVoicePacket(15_000 - VOICE_PACKET_OVERHEAD);
  system += 45_000;
  const first = await closeUploadWindow(start + 15_000);
  assert.deepEqual(first, { bot: 1000, voice: 1000, dashboard: 0, system: 3000, todayBytes: 15_000 });

  addVoicePacket(30_000 - VOICE_PACKET_OVERHEAD);
  await closeUploadWindow(start + 30_000);
  assert.equal(uploadView().bot, 2000);
  assert.equal(uploadView().todayBytes, 30_000, "자정을 넘긴 구간은 새 날로");
});

test("구간 속도: 시스템을 못 읽은 쪽이 있으면 시스템만 null", async () => {
  let readable = true;
  await startUpload(async () => (readable ? new Map([["eth0", 0]]) : null), 0);
  readable = false;
  assert.equal((await closeUploadWindow(15_000)).system, null);
  readable = true;
  assert.equal((await closeUploadWindow(30_000)).system, null, "앞 누계가 없으면 이번 구간도 비운다");
  assert.equal((await closeUploadWindow(45_000)).system, 0);
});
