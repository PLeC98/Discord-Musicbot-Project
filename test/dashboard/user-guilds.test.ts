// src/dashboard/user-guilds.ts: 사용자가 든 서버(로그인 때 받은 토큰으로 /users/@me/guilds).
// 지키는 것: 세션마다 30초 캐시하고, 같은 세션이 한꺼번에 요청하면 진행 중인 요청 하나를 공유한다. stale 목록은 바로 주고 뒤에서 새로 받는다.
// 10분 쓰지 않은 캐시 항목은 지운다. 401 을 받은 세션은 다시 로그인할 때까지 조회하지 않는다(401 은 IP 차단 한도에 든다). 그 밖의 실패는 이번만

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fake } from "../helpers/fake.ts";
import { userGuilds, forgetGuilds, _resetUserGuilds, KEEP_MS, IDLE_MS } from "../../src/dashboard/user-guilds.ts";
import type { DiscordHttp } from "../../src/dashboard/discord-api.ts";

const row = (id: string) => ({ id, name: id, icon: null, owner: false, permissions: "0" });
let answer: () => Promise<{ data: unknown }>;
let asked = 0;
const http = fake<DiscordHttp>({
  get: async () => {
    asked++;
    return answer();
  },
});
const fail = (status: number) => () => Promise.reject(Object.assign(new Error(`HTTP ${status}`), { response: { status } }));
const ids = (guilds: Array<{ id: string }>) => guilds.map((g) => g.id);

beforeEach(() => {
  _resetUserGuilds();
  asked = 0;
  answer = async () => ({ data: [row("a")] });
});

test("같은 세션이 한꺼번에 물으면 디스코드에는 한 번만 묻는다", async () => {
  let release: () => void = () => {};
  answer = () => new Promise((resolve) => (release = () => resolve({ data: [row("a")] })));
  const both = Promise.all([userGuilds("s", "tok", { http, now: 0 }), userGuilds("s", "tok", { http, now: 0 })]);
  release();
  const [x, y] = await both;
  assert.deepEqual([ids(x), ids(y)], [["a"], ["a"]]);
  assert.equal(asked, 1);
});

test("stale 목록: 30초가 지나도 캐시된 목록을 바로 주고 새로 받기는 뒤에서 한다", async () => {
  await userGuilds("s", "tok", { http, now: 0 });
  answer = async () => ({ data: [row("b")] });
  const old = await userGuilds("s", "tok", { http, now: KEEP_MS, stale: true });
  assert.deepEqual(ids(old), ["a"], "기다리지 않고 캐시된 목록");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ids(await userGuilds("s", "tok", { http, now: KEEP_MS + 1 })), ["b"], "뒤에서 받은 새 목록");
  assert.equal(asked, 2);
});

test("10분 쓰지 않은 캐시 항목은 지운다(다시 쓰면 새로 받는다, stale 목록도 남지 않는다)", async () => {
  await userGuilds("s", "tok", { http, now: 0 });
  await userGuilds("other", "tok", { http, now: IDLE_MS });
  answer = async () => ({ data: [row("c")] });
  assert.deepEqual(ids(await userGuilds("s", "tok", { http, now: IDLE_MS, stale: true })), ["c"]);
});

test("401 을 받은 세션은 다시 로그인할 때까지(캐시 항목을 지울 때까지) 묻지 않고 401 로 던진다. 429 는 이번만", async () => {
  answer = fail(401);
  await assert.rejects(userGuilds("s", "tok", { http, now: 0 }), /401/);
  await assert.rejects(userGuilds("s", "tok", { http, now: KEEP_MS * 10 }), /401/);
  assert.equal(asked, 1);
  forgetGuilds("s");
  answer = fail(429);
  await assert.rejects(userGuilds("s", "tok", { http, now: 0 }), /429/);
  answer = async () => ({ data: [row("a")] });
  assert.deepEqual(ids(await userGuilds("s", "tok", { http, now: 1 })), ["a"], "429 뒤에는 다시 묻는다");
});
