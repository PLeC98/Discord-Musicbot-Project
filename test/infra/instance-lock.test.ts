// src/infra/instance-lock.ts: 같은 폴더에서는 실행 하나만 잠금을 쥔다

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { acquireInstanceLock, lockNameFor } from "../../src/infra/instance-lock.ts";

const dir = () => path.join(os.tmpdir(), `instance-lock-${process.pid}-${Math.random().toString(36).slice(2)}`);

test("둘째는 쥐지 못하고 쥔 실행의 pid 를 받는다. 놓으면 다시 쥔다", async () => {
  const where = dir();
  const first = await acquireInstanceLock(where);
  assert.equal(first.ok, true);
  const second = await acquireInstanceLock(where);
  assert.deepEqual(second, { ok: false, holder: process.pid });
  if (first.ok) await first.release();
  const third = await acquireInstanceLock(where);
  assert.equal(third.ok, true);
  if (third.ok) await third.release();
});

test("폴더가 다르면 따로 쥔다", async () => {
  const a = await acquireInstanceLock(dir());
  const b = await acquireInstanceLock(dir());
  assert.equal(a.ok && b.ok, true);
  if (a.ok) await a.release();
  if (b.ok) await b.release();
});

test("이름: Windows 는 대소문자를 가리지 않는 파이프, Linux 는 추상 소켓, 그 밖은 임시 폴더의 소켓 파일", () => {
  assert.equal(lockNameFor("C:\\Bot\\database", "win32"), lockNameFor("c:\\bot\\DATABASE", "win32"));
  assert.match(lockNameFor("C:\\Bot\\database", "win32"), /^\\\\\.\\pipe\\musicbot-[0-9a-f]{16}$/);
  assert.match(lockNameFor("/srv/bot/database", "linux"), /^\0musicbot-[0-9a-f]{16}$/);
  assert.equal(path.dirname(lockNameFor("/srv/bot/database", "darwin")), os.tmpdir());
});

// 쥔 실행이 끝나 파일만 남은 소켓(유닉스 소켓을 쓰는 OS)은 지우고 쥔다. 파일 소켓을 만들 수 있는 OS 에서만 본다
test("남은 소켓 파일은 치우고 쥔다", { skip: process.platform === "win32" || process.platform === "linux" }, async () => {
  const where = dir();
  const name = lockNameFor(where);
  const stale = net.createServer();
  await new Promise<void>((done) => stale.listen(name, () => done()));
  // 닫히지 않은 채 프로세스가 죽은 것처럼: 파일을 두고 서버만 멈춘다
  stale.close();
  fs.writeFileSync(name, "");
  const held = await acquireInstanceLock(where);
  assert.equal(held.ok, true);
  if (held.ok) await held.release();
});
