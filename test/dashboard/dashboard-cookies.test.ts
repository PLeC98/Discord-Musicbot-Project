// src/dashboard/routes/admin.ts — 유튜브 쿠키 통로.
//
// 키와 같은 규칙이다: 운영자만 들어오고, 값은 어느 통로로도 돌아나가지 않는다.
// 로그인된 세션 그 자체라 응답에도 로그에도 내용이 남으면 안 된다.

process.env.OWNER_ID = "owner";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { signedInAs, requestJson } from "../helpers/dashboard.ts";
import { fake } from "../helpers/fake.ts";

/** 쿠키 경로의 답. 값은 없고 유무만 있다 */
type CookieReply = { source?: string; hasFile?: boolean; error?: string; code?: string };

const yamlStore = await import("../../src/config/yaml-store.ts");
const cookieJar = await import("../../src/store/cookie-jar.ts");
const secrets = await import("../../src/store/secrets.ts");
const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("cookie-route-");
secrets._useKey(Buffer.alloc(32, 9).toString("base64"));
const { bodyLimit } = await import("../../src/dashboard/body-limit.ts");
const { adminRouter } = await import("../../src/dashboard/routes/admin.ts");
// 쿠키 출처는 운영 조절값이다(설정 탭). 이 시험은 file 로 둔다
const config = (await import("../../src/config/index.ts")).default;
Object.assign(config.ytdlp, { cookiesSource: "file", useCookieFile: true, cookiesFromBrowser: null });
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "musicbot-cookie-route-"));

const SAMPLE = ["# Netscape HTTP Cookie File", ".youtube.com\tTRUE\t/\tTRUE\t1789974950\tSID\tabc123"].join("\n");

let currentUser: object | null;
let server: Server;
let base: string;

before(async () => {
  yamlStore._setConfigDir(DIR);
  currentUser = { id: "owner", username: "owner" };
  const app = express();
  app.use(bodyLimit());
  app.use(signedInAs(() => currentUser));
  app.use("/api/admin", adminRouter);
  server = await listenForFetch(app);
  base = baseUrl(server);
});

after(() => {
  server.close();
  secrets._useKey();
  store.close();
  yamlStore._setConfigDir(path.join(import.meta.dirname, "..", "..", "config"));
  fs.rmSync(DIR, { recursive: true, force: true, maxRetries: 5 });
});

beforeEach(() => cookieJar.save(""));

const req = (method: string, urlPath: string, body?: unknown) => requestJson<CookieReply>(base, method, urlPath, body);

test("운영자만 들어온다", async () => {
  currentUser = null;
  assert.equal((await req("GET", "/api/admin/cookies")).status, 401);
  assert.equal((await req("PUT", "/api/admin/cookies", { text: SAMPLE })).status, 401);

  currentUser = { id: "u1" };
  assert.equal((await req("GET", "/api/admin/cookies")).status, 403);
  assert.equal((await req("PUT", "/api/admin/cookies", { text: SAMPLE })).status, 403);

  currentUser = { id: "owner", username: "owner" };
  assert.equal(cookieJar.ready(), false, "거절당한 요청이 쿠키를 남기면 안 된다");
});

test("저장하면 있는지 없는지만 돌려준다", async () => {
  const before_ = await req("GET", "/api/admin/cookies");
  assert.deepEqual(Object.keys(before_.json).sort(), ["hasFile", "source"]);
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
  assert.equal(cookieJar.ready(), false);
});

test("글이 아닌 것은 거절한다", async () => {
  await req("PUT", "/api/admin/cookies", { text: SAMPLE });
  for (const body of [{}, { text: null }, { text: 12 }, { text: { a: 1 } }]) {
    assert.equal((await req("PUT", "/api/admin/cookies", body)).status, 400, JSON.stringify(body));
  }
  assert.equal(cookieJar.ready(), true, "거절당한 요청이 있던 쿠키를 지우면 안 된다");
});

test("붙여넣은 그대로 들어간다(실행 때 푼 파일로 본다)", async () => {
  await req("PUT", "/api/admin/cookies", { text: SAMPLE });
  const held = cookieJar.checkout();
  assert.equal(held?.text, `${SAMPLE}\n`);
  if (held) cookieJar.release(held);
});

// 쿠키는 로그인된 세션 그 자체다. 훔친 로그인 쿠키로 갈아 끼우지 못하게 최근 로그인만 받는다
test("넣기 · 지우기는 로그인한 지 10분 안이어야 한다", async () => {
  const app = express();
  app.use(bodyLimit());
  app.use((r, _res, next) => {
    r.session = fake<typeof r.session>({ user: { id: "owner", username: "owner" }, loginAt: Date.now() - 11 * 60_000 });
    next();
  });
  app.use("/api/admin", adminRouter);
  const late = await listenForFetch(app);
  try {
    const res = await requestJson<CookieReply>(baseUrl(late), "PUT", "/api/admin/cookies", { text: SAMPLE });
    assert.deepEqual([res.status, res.json.code], [403, "reauth-required"]);
    assert.equal(cookieJar.ready(), false);
  } finally {
    late.close();
  }
});
