// src/dashboard/body-to-file.ts: 요청 본문을 남은 공간 안에서 파일로 받는다. 함께 받는 것이 있으면 그것이 더 쓸 몫을 빼고 본다

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

/** 본문을 나중에 흘리는 가짜 요청 */
function request(length?: number) {
  const body = new PassThrough();
  return { body, req: Object.assign(body, { headers: length === undefined ? {} : { "content-length": String(length) } }) as unknown as Request };
}

test("남은 공간 안이면 받고, Content-Length 가 넘거나 받는 동안 넘으면 멈추고 .part 를 남기지 않는다", async () => {
  const ok = request(5);
  const saving = saveBody(ok.req, path.join(DIR, "a.bin"), 10);
  ok.body.end(Buffer.alloc(5));
  assert.deepEqual(await saving, { ok: true, bytes: 5 });

  assert.deepEqual(await saveBody(request(11).req, path.join(DIR, "b.bin"), 10), { ok: false, why: "no-space", room: 10 });
  const unknown = request();
  const over = saveBody(unknown.req, path.join(DIR, "c.bin"), 10);
  unknown.body.end(Buffer.alloc(11));
  assert.deepEqual(await over, { ok: false, why: "no-space", room: 10 });
  assert.deepEqual(fs.readdirSync(DIR).sort(), ["a.bin"]);
});

test("함께 받는 것이 알린 크기 가운데 아직 쓰지 않은 몫을 빼고 본다. 끝나면 돌려준다", async () => {
  const first = request(600);
  const saving = saveBody(first.req, path.join(DIR, "first.bin"), 1000);
  first.body.write(Buffer.alloc(100));
  await new Promise((done) => setImmediate(done));

  assert.deepEqual(await saveBody(request(600).req, path.join(DIR, "second.bin"), 1000), { ok: false, why: "no-space", room: 500 }, "앞의 것이 500 을 더 쓴다");
  first.body.end(Buffer.alloc(500));
  assert.deepEqual(await saving, { ok: true, bytes: 600 });

  const third = request(600);
  const later = saveBody(third.req, path.join(DIR, "third.bin"), 1000);
  third.body.end(Buffer.alloc(600));
  assert.deepEqual(await later, { ok: true, bytes: 600 });
});
