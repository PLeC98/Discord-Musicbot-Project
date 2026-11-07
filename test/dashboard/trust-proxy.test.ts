// src/dashboard/client-ip.ts, index.ts의 신뢰하는 프록시: 내부 주소(loopback, 사설망, 링크 로컬, 100.64/10, 이 기기의 주소와 on-link IPv6 프리픽스)는
// 자동으로 신뢰하고, 공인 IP의 원격 프록시만 DASHBOARD_TRUST_PROXY로 추가한다. 모든 주소를 신뢰하는 값은 받지 않는다. Cloudflare 대역의 홉이면 CF-Connecting-IP를 쓴다

process.env.OWNER_ID = "owner";
// .env에 무엇이 있든 기본값을 본다(dotenv는 이미 있는 값을 덮지 않고, 빈 값은 기본값이다)
process.env.DASHBOARD_TRUST_PROXY = "";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import os from "node:os";
import { fake, fakeBot } from "../helpers/fake.ts";
import { baseUrl, listenForFetch } from "../helpers/listen.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("trust-proxy-");
const { default: config } = await import("../../src/config/index.ts");
const { createApp } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const { clientIp, isInside, trustProxy, _useInterfaces } = await import("../../src/dashboard/client-ip.ts");

const anonymous = (req: Request, _res: Response, next: NextFunction) => {
  req.session = fake<Request["session"]>({});
  next();
};
const appWith = (trust: string) => {
  const saved = config.dashboard.trustProxy;
  config.dashboard.trustProxy = trust;
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

/** 그 값으로 앱을 띄우고, 헤더를 실은 익명 GET을 그 경로로 보내는 함수를 돌려준다. 같은 기기의 HTTPS 프록시처럼 X-Forwarded-Proto: https를 붙인다(인터넷 평문 막기에 걸리지 않게) */
async function serve(trust: string, path: string) {
  const server = await listenForFetch(appWith(trust), "127.0.0.1");
  servers.push(server);
  return (headers: Record<string, string>) => fetch(`${baseUrl(server)}${path}`, { headers: { "x-forwarded-proto": "https", ...headers }, redirect: "manual", signal: AbortSignal.timeout(3000) }).then((r) => r.status);
}
/** 한도 하나를 1로 두고 돌린다(같은 키로 세면 둘째 요청이 429다) */
async function withMax<T>(key: "apiMax" | "authMax", fn: () => Promise<T>) {
  const saved = config.dashboard.rateLimit[key];
  config.dashboard.rateLimit[key] = 1;
  try {
    return await fn();
  } finally {
    config.dashboard.rateLimit[key] = saved;
  }
}
type Interfaces = ReturnType<typeof os.networkInterfaces>;
const v6 = (address: string, cidr: string) => ({ address, netmask: "", family: "IPv6" as const, mac: "00:00:00:00:00:00", internal: false, cidr, scopeid: 0 });

test("기본: 내부 주소(loopback, 사설망, 링크 로컬, 100.64/10)는 신뢰하고 공인 주소는 신뢰하지 않는다", () => {
  assert.equal(config.dashboard.trustProxy, "");
  const trust = appWith("").get("trust proxy fn") as (addr: string, i: number) => boolean;
  for (const addr of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "192.168.0.10", "10.0.0.5", "172.17.0.2", "fd00::1", "169.254.1.1", "fe80::1%eth0", "100.100.1.2"]) assert.equal(trust(addr, 0), true, addr);
  for (const addr of ["8.8.8.8", "203.0.113.5", "172.32.0.1", "100.128.0.1", "2001:db8::1", "::ffff:8.8.8.8", "::ffff:808:808"]) assert.equal(trust(addr, 0), false, addr);
});

test("내부 홉(이 테스트는 127.0.0.1)이 전달한 사용자 IP로 센다. 신뢰하지 않는 홉을 만나면 거기서 멈춘다", () =>
  withMax("apiMax", async () => {
    const get = await serve("", "/api/bot");
    assert.deepEqual([await get({ "x-forwarded-for": "203.0.113.1" }), await get({ "x-forwarded-for": "203.0.113.2" })], [200, 200], "사용자마다 따로 센다");
    assert.equal(await get({ "x-forwarded-for": "203.0.113.1" }), 429);
    // 오른쪽의 공인 주소는 신뢰하지 않으므로 그 왼쪽의 값은 보지 않는다
    assert.equal(await get({ "x-forwarded-for": "198.51.100.1, 203.0.113.50" }), 200);
    assert.equal(await get({ "x-forwarded-for": "198.51.100.2, 203.0.113.50" }), 429, "왼쪽 값을 바꿔도 같은 사용자");
  }));

test("IP로 세는 한도(로그인, 공개 경로)도 Cloudflare 뒤에서는 CF-Connecting-IP로 센다", () =>
  withMax("authMax", async () => {
    const get = await serve("", "/auth/none");
    const viaCloudflare = (ip: string) => get({ "x-forwarded-for": "104.16.0.1", "cf-connecting-ip": ip });
    assert.notEqual(await viaCloudflare("198.51.100.1"), 429);
    assert.notEqual(await viaCloudflare("198.51.100.2"), 429, "같은 엣지를 거친 다른 사용자");
    assert.equal(await viaCloudflare("198.51.100.1"), 429);
  }));

test("DASHBOARD_TRUST_PROXY: 공인 IP의 원격 프록시를 추가한다(쉼표 구분, CIDR). 내부 주소와 Express 키워드는 이미 신뢰한다고 따로 돌려준다", () => {
  const parsed = trustProxy("203.0.113.7, 198.51.100.0/24, loopback, 192.168.0.10, 10.1.0.0/16");
  assert.deepEqual(parsed.accepted, ["203.0.113.7", "198.51.100.0/24"]);
  assert.deepEqual(parsed.inside, ["loopback", "192.168.0.10", "10.1.0.0/16"]);
  assert.deepEqual(parsed.rejected, []);
  for (const addr of ["203.0.113.7", "198.51.100.200", "192.168.0.11"]) assert.equal(parsed.trust(addr), true, addr);
  for (const addr of ["203.0.113.8", "198.51.101.1"]) assert.equal(parsed.trust(addr), false, addr);
});

test("모든 주소를 신뢰하는 값과 잘못된 형식의 값은 받지 않는다(그 값만 빼고 나머지는 적용)", () => {
  const parsed = trustProxy("*, true, 0.0.0.0/0, ::/0, ::ffff:0:0/96, ::/8, banana, 1.2.3.4/33, 203.0.113.7");
  assert.deepEqual(parsed.rejected, ["*", "true", "0.0.0.0/0", "::/0", "::ffff:0:0/96", "::/8", "banana", "1.2.3.4/33"]);
  assert.deepEqual(parsed.accepted, ["203.0.113.7"]);
  for (const addr of ["8.8.8.8", "::ffff:8.8.8.8"]) assert.equal(parsed.trust(addr), false, addr);
});

test("이 기기 네트워크 인터페이스의 주소와 on-link IPv6 프리픽스는 내부 주소다. 프리픽스가 /64보다 좁은 인터페이스(VPS의 /96, /128 등)는 이웃이 없다", () => {
  const cards = (): Interfaces => ({
    eth0: [{ address: "203.0.113.9", netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "203.0.113.9/24" }, v6("2001:db8:1::5", "2001:db8:1::5/64")],
    vps: [v6("2001:db8:9::9", "2001:db8:9::9/96")],
  });
  _useInterfaces(cards);
  try {
    assert.equal(isInside("203.0.113.9"), true, "이 기기의 공인 IPv4");
    assert.equal(isInside("203.0.113.10"), false, "같은 IPv4 서브넷이어도 다른 기기는 공인");
    assert.equal(isInside("2001:db8:1::77"), true, "같은 /64의 이웃");
    assert.equal(isInside("2001:db8:2::1"), false);
    assert.equal(isInside("2001:db8:9::9"), true, "이 기기 주소");
    assert.equal(isInside("2001:0db8:0009:0000:0000:0000:0000:0009"), true, "표기가 달라도 같은 주소");
    assert.equal(isInside("2001:db8:9::8"), false, "프리픽스가 /64보다 좁은 인터페이스는 이웃이 없다");
  } finally {
    _useInterfaces(os.networkInterfaces);
  }
});

test("이 기기의 주소는 60초가 지난 뒤 쓸 때 다시 읽는다(없어진 주소는 그때부터 신뢰하지 않는다)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  let current: Interfaces = { eth0: [v6("2001:db8:1::5", "2001:db8:1::5/64")] };
  let reads = 0;
  _useInterfaces(() => {
    reads += 1;
    return current;
  });
  try {
    assert.equal(isInside("2001:db8:1::77"), true);
    current = { eth0: [v6("2001:db8:2::5", "2001:db8:2::5/64")] };
    assert.equal(isInside("2001:db8:1::77"), true, "60초 안에는 읽은 것을 쓴다");
    assert.equal(isInside("2001:db8:2::77"), false, "모르는 주소가 와도 60초 안에는 다시 읽지 않는다");
    assert.equal(reads, 1);
    t.mock.timers.tick(60_000);
    assert.equal(isInside("2001:db8:1::77"), false, "없어진 프리픽스");
    assert.equal(isInside("2001:db8:2::77"), true, "새 프리픽스");
    assert.equal(reads, 2);
  } finally {
    _useInterfaces(os.networkInterfaces);
  }
});

test("Cloudflare 대역의 홉이면 CF-Connecting-IP(값이 IP 하나일 때만)를 쓰고, 다른 홉이면 그 헤더를 무시한다", () => {
  const req = (ip: string, cf?: string | string[]) => fake<Request>({ ip, socket: { remoteAddress: ip }, headers: cf === undefined ? {} : { "cf-connecting-ip": cf } });
  assert.equal(clientIp(req("104.16.0.1", "198.51.100.7")), "198.51.100.7");
  assert.equal(clientIp(req("2606:4700::1", "2001:db8::7")), "2001:db8::7");
  assert.equal(clientIp(req("203.0.113.5", "198.51.100.7")), "203.0.113.5", "Cloudflare가 아닌 홉의 헤더는 위조할 수 있다");
  for (const bad of ["1.1.1.1, 2.2.2.2", "1.2.3.4%foo,2.3.4.5", "1.2.3.4%eth0", "nope"]) assert.equal(clientIp(req("104.16.0.1", bad)), "104.16.0.1", bad);
  assert.equal(clientIp(req("104.16.0.1", ["1.1.1.1", "2.2.2.2"])), "104.16.0.1");
  assert.equal(clientIp(req("104.16.0.1")), "104.16.0.1");
});

test("IPv6 전환 주소(Teredo, 6to4)의 프리픽스는 /64 이하여도 이웃으로 보지 않는다(같은 프리픽스에 인터넷의 다른 사용자가 있다)", () => {
  _useInterfaces((): Interfaces => ({ teredo: [v6("2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:0:4136:e378:8000:63bf:3fff:fdd2/64")], sixtofour: [v6("2002:cb00:7105::1", "2002:cb00:7105::1/16")] }));
  try {
    assert.equal(isInside("2001:0:4136:e378:8000:63bf:3fff:fdd2"), true, "이 기기 주소는 그대로");
    assert.equal(isInside("2001:0:4136:e378:8000:1111:2222:3333"), false, "같은 Teredo 서버를 쓰는 인터넷 사용자");
    assert.equal(isInside("2002:1234:5678::1"), false, "다른 6to4 사용자");
  } finally {
    _useInterfaces(os.networkInterfaces);
  }
});
