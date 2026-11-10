// src/dashboard/tls-files.ts: 인증서 파일 찾기(.env 경로가 우선이고 certs/로 폴백하지 않는다), 기동 시 확인, TLS 설정, 인증서로 연 HTTPS.
// 인증서와 키는 test/fixtures/tls의 테스트용(gen 스크립트로 만든 10년짜리. 기한은 인증서에서 읽어 시각을 맞춘다)

process.env.OWNER_ID = "owner";
process.env.DASHBOARD_TRUST_PROXY = "";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import tls, { type TLSSocket } from "node:tls";
import type { NextFunction, Request, Response } from "express";
import { fake, fakeBot } from "../helpers/fake.ts";

const { openTempStore } = await import("../helpers/temp-store.ts");
const store = openTempStore("tls-files-");
const { default: config } = await import("../../src/config/index.ts");
const { createApp, openDashboard } = await import("../../src/dashboard/index.ts");
const { createPlayerStream } = await import("../../src/dashboard/player-stream.ts");
const { findTlsFiles, checkTls, tlsOptions, worldReadable, tlsStatus, isCloudflareOrigin, validRange, rotateTicketKeys, fatalProblems } = await import("../../src/dashboard/tls-files.ts");

const FIXTURES = path.join(import.meta.dirname, "..", "fixtures", "tls");
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const leaf = new X509Certificate(read("leaf.pem"));
/** 인증서가 유효한 동안의 한 시각(시작에서 하루 뒤) */
const VALID = Date.parse(leaf.validFrom) + 86_400_000;

const servers: Array<{ close(): unknown }> = [];
after(() => {
  for (const s of servers) s.close();
  store.close();
});

test("인증서 파일 찾기: .env 경로가 있으면 그것만(둘 다, .env 폴더 기준) 쓰고, 없으면 certs/에 둘 다 있을 때만 쓴다", () => {
  const root = path.resolve("/bot");
  const certsDir = path.join(root, "certs");
  const has = (files: string[]) => (f: string) => files.includes(f);
  const inCerts = [path.join(certsDir, "cert.pem"), path.join(certsDir, "key.pem")];
  assert.deepEqual(findTlsFiles({ envCert: null, envKey: null, root, certsDir, exists: has(inCerts) }), { files: { cert: inCerts[0], key: inCerts[1], from: "certs" }, error: null });
  assert.deepEqual(findTlsFiles({ envCert: null, envKey: null, root, certsDir, exists: has([]) }), { files: null, error: null });
  assert.match(findTlsFiles({ envCert: null, envKey: null, root, certsDir, exists: has([inCerts[0]]) }).error ?? "", /key\.pem이 없음/);

  const live = [path.resolve(root, "le/fullchain.pem"), path.resolve(root, "le/privkey.pem")];
  assert.deepEqual(findTlsFiles({ envCert: "le/fullchain.pem", envKey: "le/privkey.pem", root, certsDir, exists: has([...live, ...inCerts]) }).files, { cert: live[0], key: live[1], from: "env" });
  assert.match(findTlsFiles({ envCert: "le/fullchain.pem", envKey: null, root, certsDir, exists: has([...live, ...inCerts]) }).error ?? "", /둘 다/);
  const missing = findTlsFiles({ envCert: "le/fullchain.pem", envKey: "le/privkey.pem", root, certsDir, exists: has(inCerts) });
  assert.equal(missing.files, null, "경로가 틀리면 certs/로 폴백하지 않는다");
  assert.match(missing.error ?? "", /파일이 없음/);
});

test("확인: 서버 인증서 다음에 중간 인증서, 짝이 맞는 키, 일치하는 이름(SAN, 와일드카드, IP)이면 통과한다", () => {
  for (const host of ["music.example.com", "a.example.net", "192.168.0.10"]) {
    const checked = checkTls({ certPem: read("chain.pem"), keyPem: read("key.pem"), urlHost: host, now: VALID });
    assert.ok(checked.ok, host);
    assert.deepEqual(checked.ok ? checked.notes : null, [], host);
  }
});

test("확인: 열지 않는 문제(PEM이 아님, 맨 앞이 CA, 짝이 아닌 키, 암호가 걸린 키, 아직 유효하지 않음, 기한 지남)는 실패한다", () => {
  const errorsOf = (over: Partial<Parameters<typeof checkTls>[0]>) => {
    const checked = checkTls({ certPem: read("chain.pem"), keyPem: read("key.pem"), urlHost: "music.example.com", now: VALID, ...over });
    return checked.ok ? [] : checked.errors;
  };
  assert.match(errorsOf({ certPem: "그냥 글자" }).join(), /PEM 형식이 아님/);
  assert.match(errorsOf({ certPem: read("ca-first.pem") }).join(), /맨 앞이 서버 인증서가 아님/);
  assert.match(errorsOf({ keyPem: read("other-key.pem") }).join(), /짝이 아님/);
  assert.match(errorsOf({ keyPem: read("encrypted-key.pem") }).join(), /암호가 걸려/);
  assert.match(errorsOf({ keyPem: "x" }).join(), /키 읽기 실패/);
  assert.match(errorsOf({ now: Date.parse(leaf.validFrom) - 86_400_000 }).join(), /아직 유효하지 않음/);
  assert.match(errorsOf({ now: Date.parse(leaf.validTo) + 1000 }).join(), /기한이 지남/);
});

test("확인: 열고 warn하는 문제(중간 인증서 없음(Cloudflare Origin 제외), 이름 불일치, 기한 14일 이내, 다른 사용자가 읽는 키)는 경고를 남긴다", () => {
  const notesOf = (over: Partial<Parameters<typeof checkTls>[0]>) => {
    const checked = checkTls({ certPem: read("chain.pem"), keyPem: read("key.pem"), urlHost: "music.example.com", now: VALID, ...over });
    assert.ok(checked.ok);
    return checked.ok ? checked.notes.map((n) => n.text).join("\n") : "";
  };
  assert.match(notesOf({ certPem: read("leaf.pem") }), /중간 인증서가 없음/);
  assert.equal(notesOf({ certPem: read("cf-origin.pem") }), "", "Cloudflare Origin 인증서는 중간 인증서 없이 쓰는 것이 정상");
  assert.match(notesOf({ urlHost: "other.example.org" }), /이름에 공개 주소의 호스트\(other\.example\.org\)가 없음/);
  assert.match(notesOf({ urlHost: "10.0.0.1" }), /이름에 공개 주소의 호스트/);
  assert.match(notesOf({ now: Date.parse(leaf.validTo) - 10 * 86_400_000 }), /기한이 10일 남음/);
  assert.equal(notesOf({ now: Date.parse(leaf.validTo) - 20 * 86_400_000 }), "");
  assert.match(notesOf({ keyWorldReadable: true }), /chmod 600/);
});

test("키 파일 권한: Windows는 보지 않고, 그 밖은 다른 사용자 읽기 권한만 본다", () => {
  assert.equal(worldReadable(path.join(FIXTURES, "key.pem"), "win32"), false);
  if (process.platform === "win32") return;
  const file = path.join(store.dir, "key-mode.pem");
  fs.writeFileSync(file, "x", { mode: 0o640 });
  assert.equal(worldReadable(file), false, "그룹 읽기(certbot의 0640)는 경고하지 않는다");
  fs.chmodSync(file, 0o644);
  assert.equal(worldReadable(file), true);
});

test("TLS 설정: TLS 1.2 이상, CBC cipher suite 제외, ALPN은 http/1.1만 허용한다", () => {
  const options = tlsOptions("c", "k");
  assert.equal(options.minVersion, "TLSv1.2");
  assert.deepEqual(options.ALPNProtocols, ["http/1.1"]);
  assert.doesNotMatch(String(options.ciphers), /CBC|SHA1?(:|$)|RC4|3DES/);
  assert.match(String(options.ciphers), /ECDHE-RSA-AES128-GCM-SHA256/);
});

const anonymous = (r: Request, _res: Response, next: NextFunction) => {
  r.session = fake<Request["session"]>({});
  next();
};
const appOf = () => createApp(fakeBot({ client: { user: null, isReady: () => false } }), { stream: createPlayerStream(), deployCommands: () => assert.fail("등록하지 않는다"), sessionMiddleware: anonymous });

async function freePort() {
  const probe = net.createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise((done) => probe.close(done));
  return port;
}

/** 그 인증서 폴더와 공개 주소로 기동한다(127.0.0.1에만 연다) */
async function openWith(files: Record<string, string>, url: (port: number) => string) {
  const certsDir = fs.mkdtempSync(path.join(store.dir, "certs-"));
  for (const [name, fixture] of Object.entries(files)) fs.copyFileSync(path.join(FIXTURES, fixture), path.join(certsDir, name));
  const port = await freePort();
  const saved = { url: config.dashboard.url, port: config.dashboard.port, host: config.dashboard.host, tlsCert: config.dashboard.tlsCert, tlsKey: config.dashboard.tlsKey };
  Object.assign(config.dashboard, { url: url(port), port, host: "127.0.0.1", tlsCert: null, tlsKey: null });
  try {
    const opened = await openDashboard(appOf(), { scopeFile: path.join(store.dir, "scope.json"), container: false, certsDir });
    servers.push(...opened);
    return { opened, port };
  } finally {
    Object.assign(config.dashboard, saved);
  }
}

test("기동: certs/에 인증서가 있으면 HTTPS로 열고(ALPN http/1.1), 평문으로 접속하면 TLS 핸드셰이크에서 끊는다", async () => {
  const { opened, port } = await openWith({ "cert.pem": "chain.pem", "key.pem": "key.pem" }, (p) => `https://music.example.com:${p}`);
  assert.equal(opened.length, 1);
  const status = await new Promise<number>((done, fail) => {
    const req = https.get({ host: "127.0.0.1", port, path: "/api/bot", servername: "music.example.com", headers: { host: `music.example.com:${port}` }, ca: read("ca.pem") }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on("error", fail);
  });
  assert.equal(status, 200);
  // h2를 먼저 원하는 브라우저에도 http/1.1만 선택한다
  const alpn = await new Promise<string | false | null>((done, fail) => {
    const socket: TLSSocket = tls.connect({ host: "127.0.0.1", port, servername: "music.example.com", ca: read("ca.pem"), ALPNProtocols: ["h2", "http/1.1"] }, () => {
      done(socket.alpnProtocol);
      socket.end();
    });
    socket.on("error", fail);
  });
  assert.equal(alpn, "http/1.1");
  const plain = await new Promise<string>((done) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write("GET / HTTP/1.1\r\nHost: music.example.com\r\n\r\n"));
    let data = "";
    socket.on("data", (c) => (data += String(c)));
    socket.on("error", () => done(data));
    socket.on("close", () => done(data));
  });
  assert.doesNotMatch(plain, /^HTTP\/1\.1 200/, "평문은 받지 않는다");
  assert.equal(tlsStatus()?.from, "certs");
  assert.equal(tlsStatus()?.expiresAt, Date.parse(leaf.validTo));
});

test("기동: 인증서 파일이 있는데 공개 주소가 https가 아니거나 이 기기 주소이거나, 파일이 하나만 있거나, 확인에 실패하면 열지 않는다", async () => {
  assert.deepEqual((await openWith({ "cert.pem": "chain.pem", "key.pem": "key.pem" }, (p) => `http://music.example.com:${p}`)).opened, []);
  assert.deepEqual((await openWith({ "cert.pem": "chain.pem", "key.pem": "key.pem" }, (p) => `https://localhost:${p}`)).opened, []);
  assert.deepEqual((await openWith({ "cert.pem": "chain.pem" }, (p) => `https://music.example.com:${p}`)).opened, []);
  assert.deepEqual((await openWith({ "cert.pem": "chain.pem", "key.pem": "other-key.pem" }, (p) => `https://music.example.com:${p}`)).opened, []);
});

test("확인: 자체 서명 서버 인증서와 Cloudflare Origin(RSA, ECC)은 중간 인증서 경고를 내지 않는다", () => {
  const self = checkTls({ certPem: read("self-signed.pem"), keyPem: read("self-key.pem"), urlHost: "music.example.com", now: VALID });
  assert.deepEqual(self.ok ? self.notes : null, []);
  assert.equal(isCloudflareOrigin({ issuer: "O=CloudFlare, Inc.\nOU=CloudFlare Origin SSL Certificate Authority" }), true);
  assert.equal(isCloudflareOrigin({ issuer: "O=CloudFlare, Inc.\nOU=CloudFlare Origin SSL ECC Certificate Authority" }), true);
  assert.equal(isCloudflareOrigin({ issuer: "CN=R11\nO=Let's Encrypt" }), false);
});

test("확인: 읽지 못한 유효 기간(Bad time value)은 null을 반환한다", () => {
  assert.equal(validRange({ validFrom: "Bad time value", validTo: leaf.validTo }), null);
  assert.equal(validRange({ validFrom: leaf.validFrom, validTo: "Bad time value" }), null);
  assert.deepEqual(validRange(leaf), { from: Date.parse(leaf.validFrom), to: Date.parse(leaf.validTo) });
});

test("TLS 세션 티켓 키는 열 때 새로 만들고 주기적으로 바꾼다", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const keys: Buffer[] = [];
  rotateTicketKeys([{ setTicketKeys: (k: Buffer) => keys.push(k) }], 1000);
  assert.equal(keys.length, 1);
  t.mock.timers.tick(1000);
  assert.equal(keys.length, 2);
  assert.equal(keys[1].length, 48);
  assert.notDeepEqual(keys[0], keys[1]);
});

test("기동: 공개 주소가 끝에 점이 붙은 이 기기 주소(https://localhost.)여도 인증서로 열지 않는다", async () => {
  assert.deepEqual((await openWith({ "cert.pem": "chain.pem", "key.pem": "key.pem" }, (p) => `https://localhost.:${p}`)).opened, []);
});

test("확인: 유효 기간을 읽지 못한 인증서는 대시보드를 열지 않는다", () => {
  // 깨진 날짜는 OpenSSL의 X509Certificate에서 이 문자열이 된다(그런 인증서를 만들기 어려워 속성만 흉내 낸다)
  const broken = fake<X509Certificate>({ ca: false, validFrom: "Bad time value", validTo: "Bad time value", checkPrivateKey: () => true });
  assert.match(fatalProblems(broken, read("key.pem"), VALID).join(), /유효 기간 읽기 실패/);
});
