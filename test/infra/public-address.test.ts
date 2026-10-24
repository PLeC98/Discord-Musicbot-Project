// src/infra/public-address.ts — 바깥에서 닿는 공개 주소인가. 외부 링크 가드와 패널의 대시보드 링크가 같이 쓴다

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, isPublicUrl } from "../../src/infra/public-address.ts";

test("공인 unicast 만 공개 IP 다. RFC 특수 대역은 막을 대역을 적지 않아도 모두 빠진다", () => {
  const notPublic = [
    ["0.0.0.0", "지정 안 됨"],
    ["10.1.2.3", "사설"],
    ["100.64.1.1", "CGNAT(Tailscale 포함)"],
    ["127.0.0.1", "루프백"],
    ["169.254.1.1", "링크로컬"],
    ["172.16.0.1", "사설"],
    ["192.0.2.1", "문서용(TEST-NET-1)"],
    ["198.18.0.1", "벤치마크"],
    ["203.0.113.1", "문서용(TEST-NET-3)"],
    ["224.0.0.1", "멀티캐스트"],
    ["240.0.0.1", "예약"],
    ["255.255.255.255", "브로드캐스트"],
    ["::1", "루프백"],
    ["fe80::1", "링크로컬"],
    ["fec0::1", "옛 site-local"],
    ["fd12::1", "ULA"],
    ["2001:db8::1", "문서용"],
    ["64:ff9b::a00:1", "NAT64"],
    ["2002:c0a8:1::1", "6to4"],
    ["2001::1", "Teredo"],
    ["::ffff:192.168.0.1", "IPv4 를 담은 IPv6 는 안의 IPv4 로"],
    ["not-an-ip", "읽지 못함"],
  ];
  for (const [ip, why] of notPublic) assert.equal(isPublicIp(ip), false, `${ip} ${why}`);
  for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPublicIp(ip), true, ip);
});

test("주소: IP 로 적었으면 공인 unicast 일 때만, 이름이면 localhost 와 안쪽 망 이름만 아니다. DNS 는 보지 않는다", () => {
  const cases: Array<[string, boolean]> = [
    ["http://localhost:33333", false],
    ["http://LOCALHOST.:33333", false],
    ["http://dash.localhost", false],
    ["http://127.0.0.1:33333", false],
    ["http://2130706433:33333", false], // 10진 표기 127.0.0.1
    ["http://[::1]:33333", false],
    ["http://192.168.0.10:33333", false],
    ["http://100.101.102.103", false],
    ["http://nas.local", false],
    ["http://bot.lan", false],
    ["http://router.home.arpa", false],
    ["http://svc.internal", false],
    ["not a url", false],
    ["https://bot.example.org", true],
    ["http://93.184.216.34:8080", true],
    ["http://[2606:4700::1111]", true],
    ["https://music.example.com/dashboard", true],
  ];
  for (const [url, expected] of cases) assert.equal(isPublicUrl(url), expected, url);
});
