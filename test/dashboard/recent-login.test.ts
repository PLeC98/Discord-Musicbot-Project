// src/dashboard/routes/identity.ts의 /api/me/recent-login: 최근 로그인인지 확인한다(204, 오래됐으면 reauth-required). 로그인 여부만 본다(운영자가 아니어도 됨).
// 화면이 위험한 조작이나 다른 기기 로그아웃의 확인 창을 열기 전에 조회한다. within은 해당 조작의 허용 시간이고 기본(10분)보다 길게는 받지 않는다

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { identityRouter } from "../../src/dashboard/routes/identity.ts";
import { fake } from "../helpers/fake.ts";
import { listenForFetch, baseUrl } from "../helpers/listen.ts";

let loginAt = Date.now();
const app = express();
app.use((req, _res, next) => {
  req.session = fake<typeof req.session>({ user: { id: "someone", username: "someone" }, loginAt });
  next();
});
app.use("/api", identityRouter);
const server = await listenForFetch(app);
const base = baseUrl(server);
after(() => server.close());

const ask = async (query = "") => {
  const res = await fetch(`${base}/api/me/recent-login${query}`);
  return res.status === 204 ? 204 : ((await res.json()) as { code: string }).code;
};

test("운영자가 아니어도 조회할 수 있다. 방금 로그인했으면 204, 10분이 지났으면 reauth-required를 반환한다", async () => {
  loginAt = Date.now();
  assert.equal(await ask(), 204);
  loginAt = Date.now() - 11 * 60_000;
  assert.equal(await ask(), "reauth-required");
});

test("within은 해당 조작의 허용 시간이다(다른 기기 로그아웃은 2분). 기본보다 길게는 받지 않는다", async () => {
  loginAt = Date.now() - 3 * 60_000;
  assert.equal(await ask(), 204, "기본 10분 안");
  assert.equal(await ask("?within=120000"), "reauth-required", "2분은 지났다");
  loginAt = Date.now() - 11 * 60_000;
  assert.equal(await ask("?within=3600000"), "reauth-required", "한 시간을 달라고 해도 10분");
});
