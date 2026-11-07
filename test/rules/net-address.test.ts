// src/rules/net-address.ts: 주소를 정규화하고(IPv4 매핑 IPv6, 영역 ID, 대괄호), 종류를 구분하고, IP와 CIDR 목록을 파싱한다

import { test } from "node:test";
import assert from "node:assert/strict";
import { blockOf, inBlock, isInsideKind, kindOf, normalizeIp, parseCidr, parseCidrList } from "../../src/rules/net-address.ts";

test("normalizeIp: IPv4 매핑 IPv6는 IPv4로 바꾸고, 영역 ID와 대괄호는 떼고, 유효한 IP가 아니면 null", () => {
  assert.equal(normalizeIp("::ffff:192.168.0.1"), "192.168.0.1");
  assert.equal(normalizeIp("::FFFF:C0A8:1"), "192.168.0.1", "16진수 표기");
  assert.equal(normalizeIp("0:0:0:0:0:ffff:c0a8:1"), "192.168.0.1");
  assert.equal(normalizeIp("FE80::1%eth0"), "fe80::1");
  assert.equal(normalizeIp("[::1]"), "::1");
  assert.equal(normalizeIp(" 10.0.0.1 "), "10.0.0.1");
  assert.equal(normalizeIp("::"), "::");
  assert.equal(normalizeIp("::1.2.3.4"), "::1.2.3.4", "매핑이 아닌 IPv6는 그대로");
  for (const bad of ["", "localhost", "1.2.3", "300.1.1.1", "[1.2.3.4]", "1.2.3.4%eth0", "1.2.3.4%foo,2.3.4.5", "fe80::1%", "fe80::1%a b", "1.1.1.1, 2.2.2.2", null, undefined]) assert.equal(normalizeIp(bad), null, String(bad));
});

test("kindOf: loopback, 사설망, 링크 로컬, 100.64/10, 공인 주소를 구분한다", () => {
  const cases: Array<[string, string]> = [
    ["127.0.0.5", "loopback"],
    ["::1", "loopback"],
    ["10.255.0.1", "private"],
    ["172.31.0.1", "private"],
    ["172.32.0.1", "public"],
    ["192.168.1.1", "private"],
    ["::ffff:c0a8:101", "private"],
    ["fd12::1", "private"],
    ["169.254.0.1", "link-local"],
    ["fe80::abcd", "link-local"],
    ["100.64.0.1", "cgnat"],
    ["100.127.255.255", "cgnat"],
    ["100.128.0.1", "public"],
    ["8.8.8.8", "public"],
    ["2001:db8::1", "public"],
  ];
  for (const [ip, kind] of cases) assert.equal(kindOf(ip), kind, ip);
  assert.equal(kindOf("nope"), null);
  assert.equal(isInsideKind("8.8.8.8"), false);
  assert.equal(isInsideKind("::ffff:10.0.0.1"), true);
});

test("parseCidr: 프리픽스 길이는 1 이상, 주소 길이 이하. IPv4 매핑 IPv6 대역은 IPv4 대역으로 바꾼다", () => {
  assert.deepEqual(parseCidr("203.0.113.0/24"), { ip: "203.0.113.0", prefix: 24, family: "ipv4" });
  assert.deepEqual(parseCidr("2001:db8::1"), { ip: "2001:db8::1", prefix: 128, family: "ipv6" });
  assert.deepEqual(parseCidr("::ffff:203.0.113.0/120"), { ip: "203.0.113.0", prefix: 24, family: "ipv4" });
  assert.deepEqual(parseCidr("::ffff:cb00:7100/120"), { ip: "203.0.113.0", prefix: 24, family: "ipv4" });
  for (const bad of ["1.2.3.4/0", "1.2.3.4/33", "1.2.3.4/999", "1.2.3.4/x", "1.2.3.4/", "1.2.3.4/8/9", "::ffff:0:0/96", "::/0", "fe80::1%eth0/64", "x/8"]) assert.equal(parseCidr(bad), null, bad);
});

test("parseCidrList: 공인 IP와 CIDR은 허용하고, 내부 대역과 Express 키워드는 따로 돌려주고, 모든 주소를 신뢰하는 값과 잘못된 형식은 거부한다", () => {
  const parsed = parseCidrList(" 203.0.113.1 , 198.51.100.0/24,2001:db8::/32, ::ffff:cb00:7100/120, uniquelocal, 127.0.0.1, 192.168.0.0/24, ::ffff:c0a8:0/112, 10.0.0.0/7, *, ::/0, ::/8, ::ffff:0:0/96, 1.2.3.4/0, x/8, 1.2.3.4/8/9");
  assert.deepEqual(parsed.accepted, ["203.0.113.1", "198.51.100.0/24", "2001:db8::/32", "::ffff:cb00:7100/120", "10.0.0.0/7"]);
  assert.deepEqual(parsed.inside, ["uniquelocal", "127.0.0.1", "192.168.0.0/24", "::ffff:c0a8:0/112"]);
  assert.deepEqual(parsed.rejected, ["*", "::/0", "::/8", "::ffff:0:0/96", "1.2.3.4/0", "x/8", "1.2.3.4/8/9"]);
  assert.equal(inBlock(parsed.list, "198.51.100.77"), true);
  assert.equal(inBlock(parsed.list, "::ffff:203.0.113.1"), true);
  assert.equal(inBlock(parsed.list, "203.0.113.2"), true, "::ffff:cb00:7100/120은 203.0.113.0/24");
  assert.equal(inBlock(parsed.list, "8.8.8.8"), false);
});

test("blockOf, inBlock: CIDR 목록에 주소가 들어 있는지 본다. 잘못된 항목은 예외 없이 건너뛴다", () => {
  const block = blockOf(["104.16.0.0/13", "2606:4700::/32", "garbage", "1.2.3.4/999", "1.2.3.4/x", "5.6.7.8/8/9"]);
  assert.equal(inBlock(block, "104.23.255.255"), true);
  assert.equal(inBlock(block, "104.24.0.0"), false);
  assert.equal(inBlock(block, "2606:4700:10::1"), true);
  assert.equal(inBlock(block, "1.2.3.4"), false);
  assert.equal(inBlock(block, "5.6.7.8"), false);
  assert.equal(inBlock(block, "not-ip"), false);
});
