"use strict";

// src/SafeUrl.js — SSRF 방어가 실제로 버티는지 공격해 본다.
//
// CodeQL이 이 파일을 js/request-forgery(critical)로 지적한다. "URL이 사용자 입력에 의존한다"는
// 사실이지만 그게 이 모듈의 존재 이유다. 실제 방어(IP 핀 접속·홉별 재검증)를 CodeQL이 추적하지
// 못하는 것인지, 아니면 진짜 구멍이 있는지 확인한다.
//
// axios·dns를 가로채 네트워크 없이 검증한다. 실 소켓은 열리지 않는다.

const dnsPromises = require("dns").promises;
const { test, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// ── axios 가로채기 (SafeUrl require 전에) ────────────────────────────────────
const axiosPath = require.resolve("axios");
const calls = [];
let responder = () => ({ status: 200, headers: { "content-type": "audio/mpeg" }, data: null });
require.cache[axiosPath] = {
  id: axiosPath,
  filename: axiosPath,
  loaded: true,
  exports: (cfg) => {
    calls.push(cfg);
    return Promise.resolve(responder(cfg, calls.length));
  },
};

// ── dns.lookup 가로채기 ──────────────────────────────────────────────────────
// SafeUrl은 `require("dns").promises`를 잡아두고 호출 시점에 .lookup을 찾으므로
// 같은 객체의 프로퍼티를 바꾸면 가로채진다. 기본은 실제 해석에 위임.
const realLookup = dnsPromises.lookup.bind(dnsPromises);
let lookupImpl = realLookup;
dnsPromises.lookup = (...args) => lookupImpl(...args);

const { SsrfError, head, getStream } = require("../src/SafeUrl");

after(() => {
  dnsPromises.lookup = realLookup;
});

beforeEach(() => {
  calls.length = 0;
  lookupImpl = realLookup;
  responder = () => ({ status: 200, headers: { "content-type": "audio/mpeg" }, data: null });
});

const rejects = (p, re) => assert.rejects(p, (e) => e instanceof SsrfError && (!re || re.test(e.message)));

// ── 1. IP 우회 표기 ──────────────────────────────────────────────────────────

test("우회 표기로 내부 주소에 도달할 수 없다", async () => {
  const attacks = [
    "http://127.0.0.1/x.mp3", // 평문 루프백
    "http://[::1]/x.mp3", // IPv6 루프백
    "http://[::ffff:127.0.0.1]/x.mp3", // IPv4-매핑
    "http://[::ffff:169.254.169.254]/x.mp3", // 매핑된 클라우드 메타데이터
    "http://169.254.169.254/latest/meta-data/", // 클라우드 메타데이터
    "http://10.0.0.1/x.mp3",
    "http://192.168.1.1/x.mp3",
    "http://172.16.0.1/x.mp3",
    "http://100.64.0.1/x.mp3", // CGNAT
    "http://0.0.0.0/x.mp3",
    "http://2130706433/x.mp3", // 10진 = 127.0.0.1
    "http://0x7f000001/x.mp3", // 16진
    "http://0177.0.0.1/x.mp3", // 8진
    "http://127.1/x.mp3", // 축약형
  ];

  for (const url of attacks) {
    await rejects(head(url), null, url);
    assert.equal(calls.length, 0, `요청이 나가면 안 된다: ${url}`);
  }
});

test("허용되지 않는 스키마는 차단된다", async () => {
  for (const url of ["file:///etc/passwd", "gopher://127.0.0.1:11211/x", "ftp://example.com/x", "data:audio/mpeg;base64,AAAA"]) {
    await rejects(head(url), /스키마/);
  }
  assert.equal(calls.length, 0);
});

// ── 2. DNS ──────────────────────────────────────────────────────────────────

test("DNS가 여러 주소를 주면 하나라도 내부일 때 차단한다", async () => {
  // 공인 IP를 먼저 주고 내부 IP를 섞는 고전적 우회 — 첫 레코드만 보면 뚫린다
  lookupImpl = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ];

  await rejects(head("https://mixed.example/x.mp3"), /차단된 IP/);
  assert.equal(calls.length, 0, "요청이 나가면 안 된다");
});

test("DNS 리바인딩: 소켓이 검증된 IP 밖으로 나가지 못한다", async () => {
  // 검증 시점에는 공인 IP를 주고, 그 뒤 재해석하면 내부 IP를 주는 호스트
  let resolved = 0;
  lookupImpl = async () => {
    resolved++;
    return [{ address: resolved === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }];
  };

  await head("https://rebind.example/x.mp3");
  assert.equal(calls.length, 1);

  // 핀 에이전트의 lookup이 실제 소켓 연결에 쓰인다. 재해석 결과가 아니라 검증된 IP여야 한다.
  const agent = calls[0].httpsAgent;
  assert.ok(agent, "핀 에이전트가 실려야 한다");

  const pinned = await new Promise((resolve, reject) => {
    agent.options.lookup("rebind.example", {}, (err, address) => (err ? reject(err) : resolve(address)));
  });
  assert.equal(pinned, "93.184.216.34", "재해석된 내부 IP가 나오면 리바인딩으로 뚫린다");

  const pinnedAll = await new Promise((resolve, reject) => {
    agent.options.lookup("rebind.example", { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs)));
  });
  assert.deepEqual(pinnedAll, [{ address: "93.184.216.34", family: 4 }]);
});

// ── 3. 리다이렉트 ────────────────────────────────────────────────────────────

const redirectTo = (location) => (cfg, n) => (n === 1 ? { status: 302, headers: { location }, data: null } : { status: 200, headers: { "content-type": "audio/mpeg" }, data: null });

test("공인 → 내부 리다이렉트는 두 번째 요청 전에 차단된다", async () => {
  responder = redirectTo("http://127.0.0.1:8080/admin");

  await rejects(head("https://1.1.1.1/x.mp3"), /차단된 IP/);
  assert.equal(calls.length, 1, "내부 주소로 요청이 나가면 안 된다");
});

test("리다이렉트가 우회 표기 IP를 써도 차단된다", async () => {
  for (const loc of ["http://2130706433/x", "http://0x7f000001/x", "http://[::ffff:169.254.169.254]/x"]) {
    calls.length = 0;
    responder = redirectTo(loc);
    await rejects(head("https://1.1.1.1/x.mp3"));
    assert.equal(calls.length, 1, loc);
  }
});

test("리다이렉트로 스키마를 바꿀 수 없다", async () => {
  responder = redirectTo("file:///etc/passwd");
  await rejects(head("https://1.1.1.1/x.mp3"), /스키마/);
  assert.equal(calls.length, 1);
});

test("상대 경로 리다이렉트도 재검증을 거친다", async () => {
  responder = redirectTo("//127.0.0.1/x"); // 프로토콜 상대 — 호스트가 바뀐다
  await rejects(head("https://1.1.1.1/x.mp3"), /차단된 IP/);
  assert.equal(calls.length, 1);
});

test("리다이렉트 무한 루프는 상한에서 끊긴다", async () => {
  responder = () => ({ status: 302, headers: { location: "https://1.1.1.1/loop" }, data: null });
  await rejects(head("https://1.1.1.1/x.mp3"), /리다이렉트 횟수 초과/);
  assert.ok(calls.length <= 5, `요청 ${calls.length}회 — 상한이 없으면 무한히 돈다`);
});

test("Location 없는 3xx는 오류로 끊는다", async () => {
  responder = () => ({ status: 302, headers: {}, data: null });
  await rejects(head("https://1.1.1.1/x.mp3"), /Location/);
});

test("리다이렉트를 axios에 맡기지 않는다 (홉별 재검증의 전제)", async () => {
  // maxRedirects가 0이 아니면 axios가 내부적으로 따라가버려 위 재검증이 전부 무의미해진다.
  // axios를 모킹한 상태에서는 동작으로 드러나지 않으므로 설정 자체를 고정한다.
  await head("https://1.1.1.1/x.mp3");
  assert.equal(calls[0].maxRedirects, 0);
  assert.equal(calls[0].validateStatus(302), true, "3xx를 우리가 받아 처리해야 한다");
});

// ── 4. 프록시 ────────────────────────────────────────────────────────────────

test("프록시 환경변수가 설정돼 있어도 요청은 프록시를 타지 않는다", async () => {
  // 프록시를 타면 목적지를 프록시가 다시 해석하므로 핀 접속이 통째로 무의미해진다
  const keys = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
  const saved = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    process.env[k] = "http://127.0.0.1:9";
  }
  try {
    await head("https://1.1.1.1/audio.mp3");
    assert.equal(calls[0].proxy, false, "proxy:false가 없으면 axios가 환경변수 프록시를 쓴다");
    assert.ok(calls[0].httpsAgent, "핀 에이전트가 실려야 한다");
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

// ── 5. 응답 가드 ─────────────────────────────────────────────────────────────

test("허용되지 않는 Content-Type은 거부한다 (내부 서비스 응답 유출 방지)", async () => {
  responder = () => ({ status: 200, headers: { "content-type": "text/html" }, data: null });
  await rejects(head("https://1.1.1.1/x.mp3"), /Content-Type/);
});

test("Content-Length 상한을 넘으면 거부한다", async () => {
  responder = () => ({ status: 200, headers: { "content-type": "audio/mpeg", "content-length": String(600 * 1024 * 1024) }, data: null });
  await rejects(head("https://1.1.1.1/x.mp3"), /최대 크기/);
});

test("getStream도 같은 검증 경로를 지난다", async () => {
  await rejects(getStream("http://127.0.0.1/x.mp3"));
  assert.equal(calls.length, 0);
});

// ── 6. 오라클 방지 ───────────────────────────────────────────────────────────

test("차단 사유에 내부 주소가 담기지만 SsrfError로만 던진다 (호출측이 일반화)", async () => {
  // DirectLink가 사용자에게는 일반 문구만 노출한다. 여기서는 진단을 위해 상세를 담되,
  // 타입으로 구분 가능해야 호출측이 안전하게 걸러낼 수 있다.
  await assert.rejects(head("http://169.254.169.254/x.mp3"), (e) => {
    assert.ok(e instanceof SsrfError);
    assert.equal(e.name, "SsrfError");
    return true;
  });
});
