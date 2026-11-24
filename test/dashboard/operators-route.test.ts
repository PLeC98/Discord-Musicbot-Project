// src/dashboard/routes/operators.ts: 봇 운영자 카드(지금 운영자, 정한 곳, 팀 앱에서 넓히는 범위). 범위는 팀 소유자만 바꾼다.
// 실 라우터에 임시 설정 DB, 앱 정보는 테스트가 넣는다

import { test, after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express, { type NextFunction, type Request, type Response } from "express";
import { fake } from "../helpers/fake.ts";
import { personalApp, teamApp } from "../helpers/app-owners.ts";
import type { OperatorsView, ScopeSaved } from "../../src/dashboard/contract/operators.ts";

const { listenForFetch, baseUrl } = await import("../helpers/listen.ts");
const { requestJson } = await import("../helpers/dashboard.ts");
type ProblemReply = import("../helpers/dashboard.ts").ProblemReply;
const { openTempStore } = await import("../helpers/temp-store.ts");
const config = (await import("../../src/config/index.ts")).default;
const tunables = await import("../../src/store/tunables.ts");
const { operatorsRouter } = await import("../../src/dashboard/routes/operators.ts");
const { _setAppOwners, operators } = await import("../../src/usecases/app-owners.ts");
const { RECENT_LOGIN_MS } = await import("../../src/dashboard/contract/identity.ts");

const store = openTempStore("operators-");
let who = "t1";
let loginAt = () => Date.now();
const app = express();
app.use(express.json());
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.session = fake<Request["session"]>({ user: { id: who, username: who }, loginAt: loginAt() });
  next();
});
app.use("/api/admin/operators", operatorsRouter);
const server = await listenForFetch(app);
const base = baseUrl(server);
const savedOwnerId = config.dashboard.ownerId;

beforeEach(() => {
  who = "t1";
  loginAt = () => Date.now();
  config.dashboard.ownerId = null;
  store.settings().exec("DELETE FROM documents");
  tunables.load();
  _setAppOwners(
    teamApp("t1", [
      { id: "t1", role: "admin" },
      { id: "t2", role: "admin" },
      { id: "t3", role: "developer" },
    ]),
  );
});
afterEach(() => _setAppOwners(null));
after(() => {
  config.dashboard.ownerId = savedOwnerId;
  server.close();
  store.close();
});

const get = () => requestJson<OperatorsView>(base, "GET", "/api/admin/operators");
const put = (scope: unknown, expect?: string) => requestJson<ScopeSaved & ProblemReply>(base, "PUT", "/api/admin/operators/scope", { scope, ...(expect === undefined ? {} : { expect }) });

test("지금 운영자와 정한 곳, 범위, 바꿀 수 있는지를 보여 준다", async () => {
  const res = await get();
  assert.deepEqual(res.json, { kind: "team", source: "app", operators: [{ id: "t1", name: "name-t1" }], teamId: "team-1", scope: "owner", stale: false, lock: null });
});

test("팀 소유자가 넓히면 곧바로 운영자가 바뀌고 설정에 남는다. 되돌리면 저장한 값을 지운다", async () => {
  const wide = await put("developer", "owner");
  assert.equal(wide.status, 200);
  assert.deepEqual([wide.json.operators.scope, operators()], ["developer", ["t1", "t2", "t3"]]);
  assert.equal(tunables.view().values.OPERATOR_SCOPE, "developer");
  assert.deepEqual(wide.json.tunables, tunables.view(), "저장한 운영 설정값을 함께 돌려준다(화면이 저장 번호를 맞춘다)");
  await put("owner");
  assert.deepEqual([operators(), tunables.view().values.OPERATOR_SCOPE], [["t1"], undefined]);
});

test("팀 소유자가 아닌 운영자(넓혀서 들어온 Admin)는 바꾸지 못한다", async () => {
  await put("admin");
  who = "t2";
  const res = await put("developer");
  assert.deepEqual([res.status, res.json.code], [403, "operator-scope-owner-only"]);
  assert.equal((await get()).json.lock, "not-app-owner");
  assert.equal(config.dashboard.operators.scope, "admin");
});

test("OWNER_ID 로 정했거나 개인 앱이거나 앱 정보가 없으면 바꾸지 못한다", async () => {
  config.dashboard.ownerId = "t1";
  assert.deepEqual([(await put("admin")).status, (await get()).json.lock, (await get()).json.source], [403, "override", "override"]);
  config.dashboard.ownerId = null;
  _setAppOwners(personalApp("t1"));
  assert.deepEqual([(await put("admin")).status, (await get()).json.lock], [403, "personal"]);
  config.dashboard.ownerId = "t1";
  _setAppOwners(null);
  assert.equal((await get()).json.lock, "unknown");
});

test("잘못된 범위는 거절, 화면에 불러온 범위와 다르면 거절, 로그인한 지 오래되면 다시 로그인을 요구한다", async () => {
  assert.equal((await put("everyone")).json.code, "nothing-to-save");
  assert.equal((await put("admin", "developer")).json.code, "config-changed");
  loginAt = () => Date.now() - RECENT_LOGIN_MS - 1000;
  assert.equal((await put("admin")).json.code, "reauth-required");
});
