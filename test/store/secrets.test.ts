// src/store/secrets.ts — 비밀값은 암호화해 두고, 묶인 곳 · 같은 키에서만 풀린다. 화면용 상태에는 값이 없다

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openTempStore } from "../helpers/temp-store.ts";
import * as secrets from "../../src/store/secrets.ts";
import { codeOf } from "../../src/rules/error-kind.ts";
import config from "../../src/config/index.ts";

const KEY = Buffer.alloc(32, 1).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 2).toString("base64");
const VALUE = "sk-test-0123456789abcdef";
const AI = { provider: "custom", endpoint: "https://api.example.com/v1/chat" };

const store = openTempStore("secrets-");
after(() => {
  secrets._useKey();
  store.close();
});
beforeEach(() => {
  secrets._useKey(KEY);
  store.settings().exec("DELETE FROM secrets");
});

test("넣고 꺼낸다. 같은 곳(제공자 · 주소의 origin)이면 풀린다", () => {
  secrets.put("ai", VALUE, AI);
  assert.deepEqual(secrets.read("ai", AI), { state: "ok", value: VALUE });
  assert.deepEqual(secrets.read("ai", { ...AI, endpoint: "https://API.example.com/other/path" }), { state: "ok", value: VALUE }, "같은 origin 의 다른 경로");
  assert.deepEqual(secrets.read("none"), { state: "none" });
});

test("주소 · 제공자가 바뀌면 키를 내주지 않는다", () => {
  secrets.put("ai", VALUE, AI);
  assert.equal(secrets.read("ai", { ...AI, endpoint: "https://evil.example" }).state, "moved");
  assert.equal(secrets.read("ai", { ...AI, provider: "openai" }).state, "moved");
  assert.equal(secrets.read("ai").state, "moved", "묶인 키를 묶지 않은 것으로 꺼내지 못한다");
});

test("DB 의 묶인 주소 열만 바꾸면 풀리지 않는다(인증 데이터)", () => {
  secrets.put("ai", VALUE, AI);
  store.settings().prepare("UPDATE secrets SET endpoint = 'https://evil.example' WHERE name = 'ai'").run();
  assert.equal(secrets.read("ai", { ...AI, endpoint: "https://evil.example" }).state, "broken");
});

test("암호문을 다른 이름의 행으로 옮기면 풀리지 않는다", () => {
  secrets.put("spotify", VALUE);
  secrets.put("lastfm", "another-value-1234");
  store.settings().exec("UPDATE secrets SET (iv, tag, ciphertext) = (SELECT iv, tag, ciphertext FROM secrets WHERE name = 'spotify') WHERE name = 'lastfm'");
  assert.equal(secrets.read("lastfm").state, "broken");
});

test("다른 SECRETS_KEY 로 잠근 행은 풀려고 하지 않는다", () => {
  secrets.put("spotify", VALUE);
  secrets._useKey(OTHER_KEY);
  assert.equal(secrets.read("spotify").state, "other-key");
  assert.equal(secrets.status("spotify").sameKey, false);
});

test("예전 형식으로 잠근 행은 키와 따로 알린다", () => {
  secrets.put("spotify", VALUE);
  store.settings().exec("UPDATE secrets SET format = 0");
  assert.equal(secrets.read("spotify").state, "old-format");
});

test("상태에는 값이 없고 끝 네 글자 · 바꾼 때 · 묶인 곳만. 짧은 값은 끝 네 글자도 적지 않는다", () => {
  secrets.put("ai", VALUE, AI);
  const status = secrets.status("ai");
  assert.deepEqual({ ...status, updatedAt: typeof status.updatedAt }, { saved: true, updatedAt: "number", last4: "cdef", sameKey: true, provider: "custom", endpoint: "https://api.example.com" });
  assert.ok(!JSON.stringify(status).includes(VALUE.slice(0, -4)));
  secrets.put("short", "abc12345");
  assert.equal(secrets.status("short").last4, null);
  assert.deepEqual(secrets.status("none"), { saved: false, updatedAt: null, last4: null, sameKey: true, provider: null, endpoint: null });
});

test("DB 파일에 평문이 남지 않는다", () => {
  secrets.put("ai", VALUE, AI);
  store.settings().pragma("wal_checkpoint(TRUNCATE)");
  const file = path.join(store.dir, "settings.db");
  for (const target of [file, `${file}-wal`]) {
    if (fs.existsSync(target)) assert.ok(!fs.readFileSync(target).includes(VALUE.slice(0, 12)), target);
  }
});

test("삭제 · 빈 값과 너무 큰 값은 받지 않는다 · 키가 없으면 던진다", () => {
  secrets.put("ai", VALUE, AI);
  assert.equal(secrets.remove("ai"), true);
  assert.equal(secrets.remove("ai"), false);
  assert.throws(
    () => secrets.put("ai", "  "),
    (e) => codeOf(e) === "SECRET_INVALID",
  );
  assert.throws(
    () => secrets.put("ai", "x".repeat(1024 * 1024 + 1)),
    (e) => codeOf(e) === "SECRET_INVALID",
  );

  const saved = config.secrets.key;
  secrets._useKey();
  config.secrets.key = null;
  try {
    assert.throws(
      () => secrets.put("ai", VALUE),
      (e) => codeOf(e) === "SECRETS_KEY_MISSING",
    );
  } finally {
    config.secrets.key = saved;
  }
});
