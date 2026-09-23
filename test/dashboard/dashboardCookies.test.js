"use strict";

// dashboard/server/routes/admin.js — 유튜브 쿠키 통로.
//
// 키와 같은 규칙이다: 운영자만 들어오고, 값은 어느 통로로도 돌아나가지 않는다.
// 로그인된 세션 그 자체라 응답에도 로그에도 내용이 남으면 안 된다.

process.env.OWNER_ID = "owner";
process.env.COOKIES_SOURCE = "file";

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const loader = require("../../src/config/loader");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-cookie-route-"));

const SAMPLE = ["# Netscape HTTP Cookie File", ".youtube.com\tTRUE\t/\tTRUE\t1789974950\tSID\tabc123"].join("\n");

let currentUser;
let server;
let base;

before(() => {
  loader._setConfigDir(DIR);
  currentUser = { id: "owner", username: "owner" };
  const app = express();
  app.use(require("../../dashboard/server/bodyLimit").bodyLimit());
  app.use((req, res, next) => {
    req.session = { user: currentUser };
    next();
  });
  app.use("/api/admin", require("../../dashboard/server/routes/admin.js"));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  loader._setConfigDir(path.join(__dirname, "..", "..", "config"));
  fs.rmSync(DIR, { recursive: true, force: true });
});

beforeEach(() => loader.clearCookies());

async function req(method, urlPath, body) {
  const res = await fetch(base + urlPath, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

test("운영자만 들어온다", async () => {
  currentUser = null;
  assert.equal((await req("GET", "/api/admin/cookies")).status, 401);
  assert.equal((await req("PUT", "/api/admin/cookies", { text: SAMPLE })).status, 401);

  currentUser = { id: "u1" };
  assert.equal((await req("GET", "/api/admin/cookies")).status, 403);
  assert.equal((await req("PUT", "/api/admin/cookies", { text: SAMPLE })).status, 403);

  currentUser = { id: "owner", username: "owner" };
  assert.equal(fs.existsSync(loader.cookiesPath()), false, "거절당한 요청이 파일을 남기면 안 된다");
});

test("저장하면 있는지 없는지만 돌려준다", async () => {
  const before_ = await req("GET", "/api/admin/cookies");
  assert.deepEqual(Object.keys(before_.json).sort(), ["hasFile", "inFlight", "source"]);
  assert.equal(before_.json.hasFile, false);

  const saved = await req("PUT", "/api/admin/cookies", { text: SAMPLE });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.hasFile, true);
  assert.equal(saved.json.source, "file");
});

test("저장된 쿠키는 어느 응답으로도 돌아나가지 않는다", async () => {
  const saved = await req("PUT", "/api/admin/cookies", { text: SAMPLE });
  const fetched = await req("GET", "/api/admin/cookies");
  // 저장 응답과 조회 응답 양쪽을 본다. 저장한 직후가 제일 새기 쉽다
  for (const body of [saved.json, fetched.json]) {
    const raw = JSON.stringify(body);
    for (const line of SAMPLE.split("\n")) assert.ok(!raw.includes(line), "응답에 쿠키 내용이 실렸다");
  }
});

test("빈 글을 보내면 지운다", async () => {
  await req("PUT", "/api/admin/cookies", { text: SAMPLE });
  const cleared = await req("PUT", "/api/admin/cookies", { text: "" });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.hasFile, false);
  assert.equal(fs.existsSync(loader.cookiesPath()), false);
});

test("글이 아닌 것은 거절한다", async () => {
  await req("PUT", "/api/admin/cookies", { text: SAMPLE });
  for (const body of [{}, { text: null }, { text: 12 }, { text: { a: 1 } }]) {
    assert.equal((await req("PUT", "/api/admin/cookies", body)).status, 400, JSON.stringify(body));
  }
  assert.equal(loader.cookiesReady(), true, "거절당한 요청이 있던 쿠키를 지우면 안 된다");
});

test("붙여넣은 그대로 파일에 들어간다", async () => {
  await req("PUT", "/api/admin/cookies", { text: SAMPLE });
  const saved = fs.readFileSync(loader.cookiesPath(), "utf8");
  assert.equal(saved, `${SAMPLE}\n`);
});
