// src/dashboard/index.ts의 믿는 프록시(DASHBOARD_TRUST_PROXY): 기본은 이 기기(loopback)만 믿고, 믿지 않는 주소의 X-Forwarded-*는
// 사용자 IP를 바꾸지 않고 주소별로 한 번 경고를 남긴다. 받지 않는 값(모두 믿기 포함)은 경고를 남기고 loopback만 믿는다

process.env.OWNER_ID = "owner";
// .env에 무엇이 있든 기본값을 본다(dotenv는 이미 있는 값을 덮지 않고, 빈 값은 기본값이다)
process.env.DASHBOARD_TRUST_PROXY = "";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { fake, fakeBot } from "../helpers/fake.ts";
import { baseUrl, listenForFetch } from "../helpers/listen.ts";
import logSink from "../../src/infra/log/sink.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("trust-proxy-");
const { default: config } = await import("../../src/config/index.ts");
const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");

const logs: string[] = [];
logSink.addDestination((rec: unknown) => logs.push(JSON.stringify(rec)));

const anonymous = (req: Request, _res: Response, next: NextFunction) => {
  req.session = fake<Request["session"]>({});
  next();
};
const appWith = (trustProxy: string) => {
  const saved = config.dashboard.trustProxy;
  config.dashboard.trustProxy = trustProxy;
  try {
    return createApp(fakeBot({ client: { user: null, isReady: () => false } }), { stream: createPlayerStream(), deployCommands: () => assert.fail("등록하지 않는다"), sessionMiddleware: anonymous });
  } finally {
    config.dashboard.trustProxy = saved;
  }
};
const servers: Array<{ close(): unknown }> = [];
after(() => {
  for (const s of servers) s.close();
  store.close();
});

/** 그 값으로 앱을 띄우고, X-Forwarded-For를 실은 익명 GET을 보내는 함수를 돌려준다(일반 한도가 1이라 같은 IP로 보면 둘째가 429다) */
async function serve(trustProxy: string) {
  const server = await listenForFetch(appWith(trustProxy), "127.0.0.1");
  servers.push(server);
  return (xff: string) => fetch(`${baseUrl(server)}/api/bot`, { headers: { "x-forwarded-for": xff }, signal: AbortSignal.timeout(3000) }).then((r) => r.status);
}
async function withApiMax<T>(fn: () => Promise<T>) {
  const saved = config.dashboard.rateLimit.apiMax;
  config.dashboard.rateLimit.apiMax = 1;
  try {
    return await fn();
  } finally {
    config.dashboard.rateLimit.apiMax = saved;
  }
}

test("기본(loopback)은 127.0.0.1, ::1, ::ffff:127.0.0.1만 믿는다", () => {
  assert.equal(config.dashboard.trustProxy, "loopback");
  const trust = appWith("loopback").get("trust proxy fn") as (addr: string, i: number) => boolean;
  for (const addr of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(trust(addr, 0), true, addr);
  for (const addr of ["192.168.0.10", "10.0.0.5", "172.17.0.2", "fd00::1", "169.254.1.1", "8.8.8.8"]) assert.equal(trust(addr, 0), false, addr);
});

test("믿는 프록시가 알린 사용자 IP로 센다", () =>
  withApiMax(async () => {
    const get = await serve("loopback");
    assert.deepEqual([await get("203.0.113.1"), await get("203.0.113.2")], [200, 200], "사용자마다 따로 센다");
    assert.equal(await get("203.0.113.1"), 429);
  }));

test("믿지 않는 주소의 X-Forwarded-For는 사용자 IP를 바꾸지 않고, 주소별로 한 번 경고를 남긴다", () =>
  withApiMax(async () => {
    const before = logs.length;
    const get = await serve("10.0.0.1");
    assert.equal(await get("203.0.113.1"), 200);
    assert.equal(await get("203.0.113.2"), 429, "꾸민 IP와 상관없이 소켓 주소로 센다");
    const warned = logs.slice(before).filter((l) => l.includes("신뢰하는 프록시가 아닙니다"));
    assert.equal(warned.length, 1, "주소마다 한 번");
    assert.match(warned[0], /127\.0\.0\.1/);
    assert.match(warned[0], /DASHBOARD_TRUST_PROXY=10\.0\.0\.1/);
  }));

test("받지 않는 값(모두 믿기 true, *, 엉뚱한 글)은 알리고 이 기기(loopback)만 믿는다", async () => {
  for (const value of ["true", "*", "banana"]) {
    const before = logs.length;
    const trust = appWith(value).get("trust proxy fn") as (addr: string, i: number) => boolean;
    assert.ok(
      logs.slice(before).some((l) => l.includes("DASHBOARD_TRUST_PROXY 값을 쓸 수 없습니다")),
      value,
    );
    assert.equal(trust("127.0.0.1", 0), true, value);
    assert.equal(trust("192.168.0.10", 0), false, value);
    assert.equal(trust("8.8.8.8", 0), false, value);
  }
});

test("설정에 넣은 주소는 믿는다(쉼표로 여럿, CIDR)", () => {
  const trust = appWith("loopback, 192.168.0.10, 172.18.0.0/16").get("trust proxy fn") as (addr: string, i: number) => boolean;
  for (const addr of ["127.0.0.1", "192.168.0.10", "172.18.3.4"]) assert.equal(trust(addr, 0), true, addr);
  for (const addr of ["192.168.0.11", "172.19.0.1"]) assert.equal(trust(addr, 0), false, addr);
});
