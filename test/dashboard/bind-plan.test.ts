// src/dashboard/bind-plan.ts: 열 주소를 정하는 순서(DASHBOARD_HOST, 컨테이너, 이 기기 주소, 인증서 파일, https, http)와 기동 진단

import { test } from "node:test";
import assert from "node:assert/strict";
import type os from "node:os";
import { bindLine, bindNotes, callbackNote, inContainer, planBind, reachableAddresses, scopeOf, widenedNote } from "../../src/dashboard/bind-plan.ts";

const plan = (over: Partial<Parameters<typeof planBind>[0]>) => planBind({ envHost: null, url: "http://localhost:33333", container: false, certs: false, ...over });

test("열 주소: 먼저 맞는 것으로 정한다", () => {
  assert.deepEqual(plan({ envHost: "192.168.0.10", container: true, certs: true }), { hosts: ["192.168.0.10"], all: false, reason: "env" });
  assert.deepEqual(plan({ envHost: "0.0.0.0" }), { hosts: ["0.0.0.0"], all: true, reason: "env" });
  assert.deepEqual(plan({ container: true, url: "https://music.example.com" }), { hosts: ["::"], all: true, reason: "container" });
  for (const url of ["http://localhost:33333", "https://localhost", "http://127.0.0.1:33333", "http://[::1]:33333", "http://app.localhost"]) assert.deepEqual(plan({ url, certs: true }), { hosts: ["127.0.0.1", "::1"], all: false, reason: "loopback-url" }, url);
  assert.deepEqual(plan({ url: "https://music.example.com", certs: true }), { hosts: ["::"], all: true, reason: "certs" });
  assert.deepEqual(plan({ url: "https://music.example.com" }), { hosts: ["127.0.0.1", "::1"], all: false, reason: "https-url" });
  assert.deepEqual(plan({ url: "http://bot.example.com:33333" }), { hosts: ["::"], all: true, reason: "plain-url" });
});

test("컨테이너 판별: /.dockerenv, /run/.containerenv, KUBERNETES_SERVICE_HOST가 있으면 컨테이너로 본다", () => {
  assert.equal(
    inContainer((f) => f === "/.dockerenv", {}),
    true,
  );
  assert.equal(
    inContainer((f) => f === "/run/.containerenv", {}),
    true,
  );
  assert.equal(
    inContainer(() => false, { KUBERNETES_SERVICE_HOST: "10.0.0.1" }),
    true,
  );
  assert.equal(
    inContainer(() => false, {}),
    false,
  );
});

test("연 주소 한 줄: 실제로 연 주소와 까닭을 표시한다", () => {
  assert.equal(bindLine(plan({}), ["127.0.0.1", "::1"], 33333, "http"), "🌐 Dashboard: http://127.0.0.1:33333, http://[::1]:33333 (이 기기 전용(공개 주소가 없거나 이 기기 주소))");
  assert.match(bindLine(plan({ url: "http://bot.example.com" }), ["0.0.0.0"], 33333, "http"), /모든 주소\(0\.0\.0\.0\):33333 \(모든 주소\(공개 주소가 http/);
  assert.match(bindLine(plan({ url: "https://music.example.com" }), ["127.0.0.1"], 33333, "http"), /DASHBOARD_HOST/);
});

test("접속할 수 있는 주소: loopback, 링크 로컬은 빼고 중복 없이 돌려준다", () => {
  const nic = (address: string, internal = false) => ({ address, netmask: "", family: address.includes(":") ? ("IPv6" as const) : ("IPv4" as const), mac: "", internal, cidr: null, scopeid: 0 });
  const read = (): ReturnType<typeof os.networkInterfaces> => ({ lo: [nic("127.0.0.1", true), nic("::1", true)], eth0: [nic("192.168.0.10"), nic("fe80::1"), nic("2001:db8::5")], ts: [nic("100.101.1.2"), nic("192.168.0.10")] });
  assert.deepEqual(reachableAddresses(read), ["192.168.0.10", "2001:db8::5", "100.101.1.2"]);
});

test("기동 진단: 공개 주소가 없으면 다른 기기에서 쓰는 법과 이 기기의 주소를, 컨테이너면 컨테이너 밖 주소를 안내한다", () => {
  const notes = bindNotes(plan({}), { url: "http://localhost:33333", port: 33333, envHost: null, container: false, reachable: ["192.168.0.10"] });
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /DASHBOARD_URL/);
  assert.match(notes[0].text, /http:\/\/192\.168\.0\.10:33333/);
  const container = bindNotes(plan({ container: true }), { url: "http://localhost:33333", port: 33333, envHost: null, container: true, reachable: [] });
  assert.match(container.map((n) => n.text).join("\n"), /컨테이너 밖에서 접속할 주소/);
});

test("기동 진단: 모든 주소면 접속할 수 있는 주소, http면 HTTPS 사용법, https인데 DASHBOARD_HOST로 망에 열면 평문 직접 접속 시 로그인되지 않음을 안내한다", () => {
  const plain = bindNotes(plan({ url: "http://bot.example.com" }), { url: "http://bot.example.com", port: 33333, envHost: null, container: false, reachable: ["192.168.0.10"] }).map((n) => n.text);
  assert.ok(plain.some((t) => t.includes("다른 기기에서 접속할 수 있는 주소: http://192.168.0.10:33333")));
  assert.ok(plain.some((t) => t.includes("HTTPS로 쓸 수 있음")));
  const https = bindNotes(plan({ envHost: "0.0.0.0", url: "https://music.example.com" }), { url: "https://music.example.com", port: 33333, envHost: "0.0.0.0", container: false, reachable: [] }).map((n) => n.text);
  assert.ok(https.some((t) => t.includes("로그인되지 않음")));
  const local = bindNotes(plan({ envHost: "127.0.0.1", url: "https://music.example.com" }), { url: "https://music.example.com", port: 33333, envHost: "127.0.0.1", container: false, reachable: [] });
  assert.deepEqual(local, [], "DASHBOARD_HOST가 이 기기 주소면 없다");
});

test("콜백 안내: 사설 IP의 http는 디스코드가 받지 않는다(warn), 사설 IP의 https와 100.64/10은 받지 않을 수 있다", () => {
  assert.match(callbackNote("http://192.168.0.10:33333")?.text ?? "", /받지 않아 로그인할 수 없음/);
  assert.match(callbackNote("https://192.168.0.10")?.text ?? "", /받지 않을 수 있음/);
  assert.match(callbackNote("http://100.101.1.2:33333")?.text ?? "", /받지 않을 수 있음/);
  for (const url of ["http://localhost:33333", "https://music.example.com", "http://203.0.113.5"]) assert.equal(callbackNote(url), null, url);
});

test("넓어진 범위: 이전 실행이 이 기기 전용이었는데 이번에 더 넓게 열면 경고한다", () => {
  assert.equal(scopeOf(plan({})), "loopback");
  assert.equal(scopeOf(plan({ url: "http://bot.example.com" })), "all");
  assert.equal(scopeOf(plan({ envHost: "192.168.0.10" })), "192.168.0.10");
  assert.match(widenedNote("loopback", plan({ url: "http://bot.example.com" }))?.text ?? "", /더 넓게 열림\(모든 주소:/);
  assert.match(widenedNote("loopback", plan({ envHost: "192.168.0.10" }))?.text ?? "", /더 넓게 열림\(192\.168\.0\.10:/);
  assert.equal(widenedNote("loopback", plan({ url: "https://music.example.com" })), null);
  assert.equal(widenedNote(null, plan({ url: "http://bot.example.com" })), null, "처음 실행");
  assert.equal(widenedNote("all", plan({ url: "http://bot.example.com" })), null);
});

test("컨테이너 안이면 공개 주소, 여는 주소와 상관없이 출발지 IP가 바뀌는 환경의 한계를 알린다", () => {
  for (const [envHost, url] of [
    [null, "https://music.example.com"],
    [null, "http://bot.lan:33333"],
    ["0.0.0.0", "https://music.example.com"],
  ] as const) {
    const texts = bindNotes(planBind({ envHost, url, container: true, certs: false }), { url, port: 33333, envHost, container: true, reachable: [] }).map((n) => n.text);
    assert.ok(
      texts.some((t) => t.includes("인터넷 평문 접속을 감지하지 못함")),
      `${envHost} ${url}`,
    );
  }
});
