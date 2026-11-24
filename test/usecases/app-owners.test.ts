// src/usecases/app-owners.ts: 앱 정보 보관, 덮어쓰기(OWNER_ID), 다시 받기

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import config from "../../src/config/index.ts";
import { _setAppOwners, appOwners, onOperatorsChanged, operators, refreshAppOwners, startAppOwners, STALE_MS } from "../../src/usecases/app-owners.ts";
import sink from "../../src/infra/log/sink.ts";
import { isBotOwner } from "../../src/usecases/permissions.ts";
import { personalApp, teamApp } from "../helpers/app-owners.ts";

const saved = { ownerId: config.dashboard.ownerId, scope: config.dashboard.operators.scope };
afterEach(() => {
  config.dashboard.ownerId = saved.ownerId;
  config.dashboard.operators.scope = saved.scope;
  _setAppOwners(null);
});

test("덮어쓰기가 있으면 적힌 그대로, 없으면 앱 정보로 정한 운영자. 판정 때마다 설정 객체에서 읽는다", () => {
  config.dashboard.ownerId = null;
  _setAppOwners(personalApp("u1"));
  assert.deepEqual([isBotOwner("u1"), isBotOwner("u2")], [true, false]);
  config.dashboard.ownerId = "u2, u3";
  assert.deepEqual([isBotOwner("u1"), isBotOwner("u2"), isBotOwner("u3")], [false, true, true]);
});

test("덮어쓰기의 형식이 틀려도 자동으로 넘어가지 않는다(아무와도 맞지 않으면 아무도 운영자가 아니다)", () => {
  config.dashboard.ownerId = "not-an-id";
  _setAppOwners(personalApp("u1"));
  assert.equal(isBotOwner("u1"), false);
});

test("앱 정보가 없으면(테스트가 기동 없이 연 경우 등) 덮어쓰기만 동작한다", () => {
  config.dashboard.ownerId = null;
  assert.deepEqual(operators(), []);
  config.dashboard.ownerId = "owner";
  assert.equal(isBotOwner("owner"), true);
});

test("넓히는 범위는 설정 객체를 따르고, 마지막 성공이 1시간을 넘으면 소유자만 남긴다", () => {
  config.dashboard.ownerId = null;
  config.dashboard.operators.scope = "admin";
  const app = teamApp("t1", [{ id: "t2", role: "admin" }]);
  _setAppOwners(app);
  assert.deepEqual(operators(), ["t1", "t2"]);
  _setAppOwners(app, { at: Date.now() - STALE_MS - 1000 });
  assert.deepEqual(operators(), ["t1"]);
});

test("다시 받기: 형식이 틀린 응답, 실패는 마지막 것을 그대로 쓴다. 바뀌면 알린다", async () => {
  config.dashboard.ownerId = null;
  let answer: () => Promise<unknown> = async () => teamApp("t1", []);
  _setAppOwners(personalApp("u1"), { reader: () => answer() });
  let told = 0;
  const off = onOperatorsChanged(() => told++);
  try {
    answer = async () => ({ team: "?" });
    await refreshAppOwners();
    assert.deepEqual(operators(), ["u1"], "형식이 틀린 응답은 넣지 않는다");
    answer = () => Promise.reject(new Error("down"));
    await refreshAppOwners();
    assert.deepEqual(operators(), ["u1"], "실패는 마지막 것");
    answer = async () => teamApp("t1", []);
    await refreshAppOwners();
    assert.deepEqual([operators(), appOwners()?.kind, told], [["t1"], "team", 1]);
  } finally {
    off();
  }
});

test("다시 받기는 한 번에 하나다(받는 중이면 진행 중인 받기를 기다린다)", async () => {
  let calls = 0;
  let release: (value: unknown) => void = () => {};
  _setAppOwners(personalApp("u1"), {
    reader: () => {
      calls++;
      return new Promise((resolve) => (release = resolve));
    },
  });
  const first = refreshAppOwners();
  const second = refreshAppOwners();
  release(personalApp("u2"));
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(appOwners()?.kind === "personal" && appOwners()?.ownerId, "u2");
});

test("로그인 때의 다시 받기는 마지막 성공이 1분 이내면 건너뛴다", async () => {
  let calls = 0;
  _setAppOwners(personalApp("u1"), {
    reader: async () => {
      calls++;
      return personalApp("u1");
    },
  });
  await refreshAppOwners({ freshMs: 60_000 });
  assert.equal(calls, 0);
  _setAppOwners(personalApp("u1"), {
    at: Date.now() - 120_000,
    reader: async () => {
      calls++;
      return personalApp("u1");
    },
  });
  await refreshAppOwners({ freshMs: 60_000 });
  assert.equal(calls, 1);
});

test("기동 로그: 운영자와 정한 곳, 덮어쓰기면 앱 소유자 계산과 같은지, 정하지 못하면 warn", () => {
  const boot = (raw: unknown, ownerId: string | null) => {
    config.dashboard.ownerId = ownerId;
    _setAppOwners(null);
    const from = sink.buffer.length;
    startAppOwners(raw, async () => raw);
    return sink.buffer.slice(from).map((e) => `${e.level} ${e.text}`);
  };
  assert.deepEqual(boot(personalApp("u1"), null), ["info 봇 운영자: name-u1 (앱 소유자)"]);
  assert.deepEqual(boot(teamApp("t1", [{ id: "t1", role: "admin" }]), null), ["info 봇 운영자: name-t1 (팀 소유자)"]);
  assert.match(boot(personalApp("u1"), "u1").join("\n"), /OWNER_ID 1명\(앱 소유자로 정한 운영자와 같으니 OWNER_ID를 지워도 됨\)/);
  assert.match(boot(personalApp("u1"), "u2").join("\n"), /OWNER_ID 1명\(앱 소유자로 정한 운영자와 다름/);
  const unknown = boot({ team: "?" }, null);
  assert.ok(unknown.some((line) => line.startsWith("warn 디스코드 앱 정보에서 봇 운영자를 정하지 못함")) && unknown.some((line) => line.startsWith("warn 봇 운영자를 정하지 못함")), unknown.join("\n"));
});
