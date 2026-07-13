"use strict";

// src/SafeUrl.js — SSRF 방어의 오프라인 검증 배터리 (네트워크/DNS 미접촉 경로만).
// 회귀 대상: IPv6 리터럴 대괄호 미제거로 전 IPv6 리터럴이 DNS 경로로 빠지던 문제

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SsrfError, isBlockedIp, isAllowedContentType, validateAndResolve } = require("../src/SafeUrl");

test("isBlockedIp: 내부·예약 대역 차단 배터리", () => {
  const blocked = [
    "127.0.0.1", // 루프백
    "10.0.0.1", // 사설 A
    "172.16.0.1", // 사설 B
    "192.168.1.1", // 사설 C
    "169.254.169.254", // 링크로컬 (클라우드 메타데이터)
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "255.255.255.255", // 브로드캐스트
    "224.0.0.1", // 멀티캐스트
    "::1", // IPv6 루프백
    "fe80::1", // IPv6 링크로컬
    "fc00::1", // IPv6 ULA
    "::ffff:10.0.0.1", // IPv4-매핑 내부 (언랩 후 재판정)
    "not-an-ip",
  ];
  for (const ip of blocked) assert.equal(isBlockedIp(ip), true, ip);

  const allowed = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"];
  for (const ip of allowed) assert.equal(isBlockedIp(ip), false, ip);
});

test("IPv6 리터럴: 대괄호를 벗겨 IP로 판정 — 내부는 리터럴 차단, 공인은 핀 접속 (L-03 회귀)", async () => {
  // 구 코드: '[::1]'이 net.isIP 실패 → DNS 경로 → 'DNS 해석 실패'로 우연히 차단.
  // 신 코드: IP 리터럴로 인식해 명시적 차단 (메시지로 경로 구분)
  await assert.rejects(validateAndResolve("http://[::1]/x"), (e) => e instanceof SsrfError && /리터럴/.test(e.message));
  await assert.rejects(validateAndResolve("http://[fe80::1]/x"), /리터럴/);

  // 공인 IPv6 리터럴은 DNS 없이 그 주소로 핀 — 구 코드에서는 사용 자체가 불가했음
  const { pinnedIp, family, url } = await validateAndResolve("https://[2606:4700:4700::1111]/file.mp3");
  assert.equal(pinnedIp, "2606:4700:4700::1111");
  assert.equal(family, 6);
  assert.equal(url.hostname, "[2606:4700:4700::1111]", "URL 객체는 원형 유지 (요청 href용)");
});

test("IPv4 리터럴: 내부 차단 / 공인 핀", async () => {
  await assert.rejects(validateAndResolve("http://169.254.169.254/latest/meta-data"), /리터럴/);
  await assert.rejects(validateAndResolve("http://10.1.2.3/x"), /리터럴/);

  const { pinnedIp, family } = await validateAndResolve("http://1.1.1.1/audio.ogg");
  assert.equal(pinnedIp, "1.1.1.1");
  assert.equal(family, 4);
});

test("스키마 화이트리스트: http/https 외 거부", async () => {
  for (const bad of ["ftp://1.1.1.1/a", "file:///etc/passwd", "gopher://1.1.1.1/"]) {
    await assert.rejects(validateAndResolve(bad), /스키마/, bad);
  }
  await assert.rejects(validateAndResolve("not a url"), /잘못된 URL/);
});

test("Content-Type 화이트리스트: 오디오/비디오/옥텟만, 부재는 허용(심층방어)", () => {
  for (const ok of ["audio/mpeg", "video/mp4", "application/octet-stream", "binary/octet-stream", "AUDIO/OGG", ""]) {
    assert.equal(isAllowedContentType(ok), true, ok);
  }
  for (const bad of ["text/html", "application/json", "image/png"]) {
    assert.equal(isAllowedContentType(bad), false, bad);
  }
});
