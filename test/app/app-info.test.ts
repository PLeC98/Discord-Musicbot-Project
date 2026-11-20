// src/app/app-info.ts: 기동이 앱 설정을 한 번 읽고, CLIENT_ID가 봇 토큰의 앱인지 대조한다. 못 읽으면 대조를 건너뛴다

import { test } from "node:test";
import assert from "node:assert/strict";
import sink from "../../src/infra/log/sink.ts";
import { clientIdMismatch, readAppOnce } from "../../src/app/app-info.ts";

const linesFrom = (from: number) => sink.buffer.slice(from).map((e) => `${e.level} ${e.text}`);

test("앱 설정을 읽으면 그대로, 못 읽으면 경고하고 null(대조를 건너뛰고 특권 인텐트를 모두 요청한다)", async () => {
  assert.deepEqual(await readAppOnce(async () => ({ id: "123456789012345678", flags: 0 })), { id: "123456789012345678", flags: 0 });
  const from = sink.buffer.length;
  assert.equal(await readAppOnce(async () => Promise.reject(new Error("timeout"))), null);
  assert.deepEqual(linesFrom(from), ["warn 앱 설정을 읽지 못해 앱 ID 대조를 건너뛰고 특권 인텐트를 모두 요청함: timeout"]);
});

test("CLIENT_ID 대조: 다르면 토큰의 앱 ID를 실은 안내, 같거나 모르면(못 읽음, id 없음) null", () => {
  assert.equal(clientIdMismatch({ id: "123456789012345678" }, "123456789012345678"), null);
  assert.equal(clientIdMismatch({ id: "999999999999999999" }, "123456789012345678"), "CLIENT_ID(123456789012345678)가 봇 토큰의 앱(999999999999999999)이 아님. 개발자 포털의 Application ID와 .env의 CLIENT_ID가 같은지 확인하세요");
  assert.equal(clientIdMismatch(null, "123456789012345678"), null);
  assert.equal(clientIdMismatch({ flags: 0 }, "123456789012345678"), null);
});
