// src/dashboard/uploads.ts: 큰 파일 업로드의 공간 예약, 청크 위치, 받는 중 잠금, 실패 되돌리기, 가져가기, 정리

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as uploads from "../../src/dashboard/uploads.ts";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
after(() => fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 }));
afterEach(() => uploads._reset());

/** 남은 공간을 정해 둔 위치. discarded: 지운 위치들 */
const discarded: string[] = [];
let room = 1000;
const targetOf = (id: string): uploads.Target => {
  const file = path.join(DIR, `${id}.part`);
  return { file, room: () => room, discard: () => (fs.rmSync(file, { force: true }), discarded.push(id)), ref: id };
};
function open(size: number, sid = "s1") {
  const started = uploads.start({ sid, purpose: "archive", size, targetOf });
  assert.ok(started.ok, JSON.stringify(started));
  return started.upload;
}
async function put(one: uploads.Upload, bytes: Buffer, sid = "s1") {
  const begun = uploads.begin(one.id, sid, one.received);
  assert.ok(begun.ok);
  try {
    return await uploads.write(one, bytes);
  } finally {
    uploads.release(one);
  }
}

test("시작: 남은 공간에서 다른 업로드가 앞으로 쓸 몫을 빼고 판단한다. 그 몫 때문이면 busy, 원래 모자라면 no-space 와 남은 크기. 거절하면 위치를 지운다", () => {
  room = 1000;
  const first = open(600);
  assert.deepEqual(uploads.start({ sid: "s2", purpose: "archive", size: 500, targetOf }), { ok: false, why: "busy" });
  assert.deepEqual(uploads.start({ sid: "s2", purpose: "login-background", size: 1500, targetOf }), { ok: false, why: "no-space", room: 400 });
  assert.equal(discarded.length, 2, "거절한 위치를 지운다");
  assert.ok(fs.existsSync(first.target.file), "열면 빈 파일을 만든다");
  uploads.cancel(first.id, "s1");
  assert.equal(uploads.start({ sid: "s2", purpose: "archive", size: 500, targetOf }).ok, true, "끝나면 그 몫을 돌려준다");
});

test("같은 세션, 같은 용도로 다시 시작하면 쥐지 않은 옛 업로드를 지운다(받는 중인 것, 다른 용도는 둔다)", () => {
  room = 1000;
  const old = open(600);
  const other = uploads.start({ sid: "s1", purpose: "login-background", size: 100, targetOf });
  assert.ok(other.ok);
  const again = open(600);
  assert.equal(uploads.find(old.id, "s1"), null);
  assert.ok(uploads.find(other.upload.id, "s1"));
  assert.ok(uploads.begin(again.id, "s1", 0).ok);
  open(10);
  assert.ok(uploads.find(again.id, "s1"), "받는 중인 것은 둔다");
  uploads.release(again);
});

test(`동시에 ${uploads.MAX_ACTIVE}개까지만 연다(봇 전체)`, () => {
  room = 1e9;
  for (let i = 0; i < uploads.MAX_ACTIVE; i++) open(1, `s${i}`);
  assert.deepEqual(uploads.start({ sid: "other", purpose: "archive", size: 1, targetOf }), { ok: false, why: "busy" });
});

test("청크: 받은 위치에서만 받고, 받는 중에 온 청크와 어긋난 위치는 받은 위치를 알려 거절한다. 다른 세션은 없는 것과 같다", async () => {
  room = 1000;
  const one = open(10);
  assert.deepEqual(uploads.begin(one.id, "s1", 4), { ok: false, why: "offset", received: 0 });
  assert.deepEqual(uploads.begin(one.id, "s2", 0), { ok: false, why: "gone" });
  assert.deepEqual(uploads.begin("x".repeat(32), "s1", 0), { ok: false, why: "gone" });
  const begun = uploads.begin(one.id, "s1", 0);
  assert.ok(begun.ok);
  assert.deepEqual(uploads.begin(one.id, "s1", 0), { ok: false, why: "offset", received: 0 }, "같은 위치의 두 번째 청크");
  assert.deepEqual(await uploads.write(one, Buffer.from("abcd")), { ok: true, received: 4 });
  uploads.release(one);
  assert.deepEqual(await put(one, Buffer.from("efghij")), { ok: true, received: 10 });
  assert.equal(fs.readFileSync(one.target.file, "utf8"), "abcdefghij");
});

test("쓰기 전에 남은 공간을 다시 본다: 다른 쓰기가 그사이 공간을 썼으면 쓰지 않고 no-space", async () => {
  room = 1000;
  const one = open(100);
  assert.deepEqual(await put(one, Buffer.alloc(40)), { ok: true, received: 40 });
  room = 50;
  assert.deepEqual(await put(one, Buffer.alloc(40)), { ok: false, why: "no-space", room: 50 });
  assert.equal(one.received, 40);
  assert.equal(fs.statSync(one.target.file).size, 40, "쓰지 않았다");
});

test("쓰다 실패하면 받은 위치는 그대로이고, 파일을 되돌리지 못하면 업로드를 지운다", async () => {
  room = 1000;
  const one = open(10);
  assert.deepEqual(await put(one, Buffer.from("abc")), { ok: true, received: 3 });
  fs.rmSync(one.target.file);
  await assert.rejects(put(one, Buffer.from("def")));
  assert.equal(one.received, 3);
  assert.equal(uploads.find(one.id, "s1"), null, "되돌리지 못해 지웠다");
  assert.ok(discarded.includes(one.id));
});

test("가져가기: 다 받은 것만, 한 번만, 그 쓰임새만. 가져가면 목록에서 빼고 파일은 남긴다", async () => {
  room = 1000;
  const one = open(3);
  assert.deepEqual(uploads.take(one.id, "s1", "archive"), { ok: false, why: "incomplete" });
  await put(one, Buffer.from("abc"));
  assert.deepEqual(uploads.take(one.id, "s1", "login-background"), { ok: false, why: "gone" });
  const taken = uploads.take(one.id, "s1", "archive");
  assert.ok(taken.ok);
  assert.deepEqual(uploads.take(one.id, "s1", "archive"), { ok: false, why: "gone" }, "두 번째");
  uploads.finish(taken.upload);
  assert.equal(uploads.find(one.id, "s1"), null);
  assert.ok(fs.existsSync(one.target.file), "가져간 파일은 지우지 않는다");
  assert.ok(!discarded.includes(one.id));
});

test("쥔 동안 지우면(취소, 세션 끝) 파일은 놓을 때 지운다. 이어 오는 청크는 gone", async () => {
  room = 1000;
  const one = open(10);
  const begun = uploads.begin(one.id, "s1", 0);
  assert.ok(begun.ok);
  uploads.dropSession("s1");
  assert.ok(fs.existsSync(one.target.file), "받는 중에는 지우지 않는다");
  assert.deepEqual(await uploads.write(one, Buffer.from("abc")), { ok: false, why: "gone" });
  uploads.release(one);
  assert.ok(!fs.existsSync(one.target.file));
  assert.deepEqual(uploads.begin(one.id, "s1", 0), { ok: false, why: "gone" });
});

test(`${uploads.IDLE_MS / 60_000}분 동안 요청이 없으면 지운다(받는 중인 것은 둔다)`, () => {
  room = 1000;
  const idle = open(10);
  const busy = open(10, "s2");
  assert.ok(uploads.begin(busy.id, "s2", 0).ok);
  uploads.sweepIdle(Date.now() + uploads.IDLE_MS + 1);
  assert.equal(uploads.find(idle.id, "s1"), null);
  assert.ok(uploads.find(busy.id, "s2"));
  uploads.release(busy);
});
