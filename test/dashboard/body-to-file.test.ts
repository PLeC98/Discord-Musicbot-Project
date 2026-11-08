// src/dashboard/body-to-file.ts: 요청 본문을 남은 공간 안에서 파일로 저장한다. 동시에 받는 요청이 있으면 그 요청이 앞으로 쓸 크기를 빼고 계산한다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { Request } from "express";
import { saveBody } from "../../src/dashboard/body-to-file.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "body-to-file-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));

/** 본문을 나중에 보내는 가짜 요청 */
function request(length?: number) {
  const body = new PassThrough();
  return { body, req: Object.assign(body, { headers: length === undefined ? {} : { "content-length": String(length) } }) as unknown as Request };
}

test("남은 공간 안이면 받고, Content-Length가 넘거나 받는 동안 넘으면 멈추고 .part를 남기지 않는다", async () => {
  const ok = request(5);
  const saving = saveBody(ok.req, path.join(DIR, "a.bin"), 10);
  ok.body.end(Buffer.alloc(5));
  assert.deepEqual(await saving, { ok: true, bytes: 5 });

  assert.deepEqual(await saveBody(request(11).req, path.join(DIR, "b.bin"), 10), { ok: false, why: "no-space", room: 10, busy: false });
  const unknown = request();
  const over = saveBody(unknown.req, path.join(DIR, "c.bin"), 10);
  unknown.body.end(Buffer.alloc(11));
  assert.deepEqual(await over, { ok: false, why: "no-space", room: 10, busy: false });
  assert.deepEqual(fs.readdirSync(DIR).sort(), ["a.bin"]);
});

test("동시에 받는 요청이 알린 크기에서 아직 쓰지 않은 만큼을 남은 공간에서 뺀다. 끝나면 돌려준다", async () => {
  const first = request(600);
  const saving = saveBody(first.req, path.join(DIR, "first.bin"), 1000);
  first.body.write(Buffer.alloc(100));
  await new Promise((done) => setImmediate(done));

  assert.deepEqual(await saveBody(request(600).req, path.join(DIR, "second.bin"), 1000), { ok: false, why: "no-space", room: 500, busy: true }, "앞 요청이 500을 더 쓴다(디스크에는 공간이 있다)");
  first.body.end(Buffer.alloc(500));
  assert.deepEqual(await saving, { ok: true, bytes: 600 });

  const third = request(600);
  const later = saveBody(third.req, path.join(DIR, "third.bin"), 1000);
  third.body.end(Buffer.alloc(600));
  assert.deepEqual(await later, { ok: true, bytes: 600 });
});

test("크기를 알리지 않은 요청은 남은 공간 전부를 선점한다. 그동안 다른 요청은 그 요청이 아직 쓰지 않은 만큼을 빼고 받는다", async () => {
  const first = request();
  const saving = saveBody(first.req, path.join(DIR, "unsized.bin"), 1000);
  first.body.write(Buffer.alloc(300));
  await new Promise((done) => setImmediate(done));

  assert.deepEqual(await saveBody(request(400).req, path.join(DIR, "sized.bin"), 1000), { ok: false, why: "no-space", room: 300, busy: true }, "앞 요청이 700을 더 쓸 수 있다");
  first.body.end();
  assert.deepEqual(await saving, { ok: true, bytes: 300 });
});
