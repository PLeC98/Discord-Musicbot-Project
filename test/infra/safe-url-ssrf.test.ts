// src/infra/safe-url.ts — SSRF 방어가 실제로 버티는지 공격해 본다.
//
// CodeQL이 이 파일을 js/request-forgery(critical)로 지적한다. "URL이 사용자 입력에 의존한다"는
// 사실이지만 그게 이 모듈의 존재 이유다. 실제 방어(IP 핀 접속·홉별 재검증)를 CodeQL이 추적하지
// 못하는 것인지, 아니면 진짜 구멍이 있는지 확인한다.
//
// 요청 함수와 DNS 해석을 가짜로 넘겨 네트워크 없이 검증한다. 요청 함수 자체(고정 접속 · 리다이렉트 · 시간 제한 · 프록시)는
// 맨 아래에서 로컬 서버로 진짜 소켓을 연다.

import dns from "dns";
const dnsPromises = dns.promises;
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { PassThrough, Readable } from "node:stream";
import type { Incoming, LookupFn, Outgoing, RequestDeps } from "../../src/infra/safe-url.ts";

type Reply = Incoming;
const reply = (status: number, headers: Record<string, string> = {}): Reply => ({ status, headers, body: Readable.from([]) });
const AUDIO = { "content-type": "audio/mpeg" };

// ── 바깥 경계 가짜: 요청 함수와 DNS 해석. head · getStream 에 넘긴다 ─────────────
const calls: Outgoing[] = [];
let responder: (request: Outgoing, n: number) => Reply = () => reply(200, AUDIO);
// 기본은 실제 해석에 위임
const realLookup: LookupFn = (host, options) => dnsPromises.lookup(host, options);
let lookupImpl: LookupFn = realLookup;
const deps: RequestDeps = {
  request: (cfg) => {
    calls.push(cfg);
    return Promise.resolve(responder(cfg, calls.length));
  },
  lookup: (host, options) => lookupImpl(host, options),
};

const safeUrl = await import("../../src/infra/safe-url.ts");
const { SsrfError } = safeUrl;
const head = (url: string) => safeUrl.head(url, deps);
const getStream = (url: string) => safeUrl.getStream(url, deps);

beforeEach(() => {
  calls.length = 0;
  lookupImpl = realLookup;
  responder = () => reply(200, AUDIO);
});

// 세 번째 인자는 실패했을 때 어느 입력이었는지 읽으려고 붙인 이름표다
const rejects = (p: Promise<unknown>, re?: RegExp | null, _label?: string) => assert.rejects(p, (e) => e instanceof SsrfError && (!re || re.test(e.message)));

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
  const agent = calls[0].agent as unknown as { options: { lookup: (host: string, options: object, cb: (err: Error | null, address: unknown) => void) => void } };
  assert.ok(agent, "핀 에이전트가 실려야 한다");

  const pinned = await new Promise((resolve, reject) => {
    agent.options.lookup("rebind.example", {}, (err: Error | null, address: unknown) => (err ? reject(err) : resolve(address)));
  });
  assert.equal(pinned, "93.184.216.34", "재해석된 내부 IP가 나오면 리바인딩으로 뚫린다");

  const pinnedAll = await new Promise((resolve, reject) => {
    agent.options.lookup("rebind.example", { all: true }, (err: Error | null, addrs: unknown) => (err ? reject(err) : resolve(addrs)));
  });
  assert.deepEqual(pinnedAll, [{ address: "93.184.216.34", family: 4 }]);
});

// ── 3. 리다이렉트 ────────────────────────────────────────────────────────────

const redirectTo =
  (location: string) =>
  (_request: Outgoing, n: number): Reply =>
    n === 1 ? reply(302, { location }) : reply(200, AUDIO);

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
  responder = () => reply(302, { location: "https://1.1.1.1/loop" });
  await rejects(head("https://1.1.1.1/x.mp3"), /리다이렉트 횟수 초과/);
  assert.ok(calls.length <= 5, `요청 ${calls.length}회 — 상한이 없으면 무한히 돈다`);
});

test("Location 없는 3xx는 오류로 끊는다", async () => {
  responder = () => reply(302);
  await rejects(head("https://1.1.1.1/x.mp3"), /Location/);
});

// ── 5. 응답 가드 ─────────────────────────────────────────────────────────────

test("허용되지 않는 Content-Type은 거부한다 (내부 서비스 응답 유출 방지)", async () => {
  responder = () => reply(200, { "content-type": "text/html" });
  await rejects(head("https://1.1.1.1/x.mp3"), /Content-Type/);
});

test("Content-Length 상한을 넘으면 거부한다", async () => {
  responder = () => reply(200, { ...AUDIO, "content-length": String(600 * 1024 * 1024) });
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

test("2xx 가 아닌 응답은 실패로 끊는다", async () => {
  responder = () => reply(404, AUDIO);
  await assert.rejects(head("https://1.1.1.1/x.mp3"), /HTTP 404/);
});

// ── 7. 요청 함수: 진짜 소켓 ──────────────────────────────────────────────────
// 풀리지 않는 호스트(pinned.invalid)로 보낸다. 응답이 오면 고정 IP 로 접속한 것이다.

const { send, createPinnedAgent } = safeUrl._internals;

async function localServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as { port: number };
  return { server, url: (p: string) => new URL(`http://pinned.invalid:${port}${p}`) };
}
const pinned = () => createPinnedAgent("http:", "127.0.0.1", 4);
const drain = async (body: Readable) => {
  let bytes = 0;
  for await (const chunk of body) bytes += (chunk as Buffer).length;
  return bytes;
};

test("진짜 소켓: 고정 IP 로 접속하고, 리다이렉트는 따라가지 않고 그대로 돌려준다", async () => {
  const { server, url } = await localServer((req, res) => {
    if (req.url === "/redirect") return res.writeHead(302, { Location: "/final" }).end();
    res.writeHead(200, AUDIO).end(Buffer.alloc(4096, 1));
  });
  try {
    const moved = await send({ method: "GET", url: url("/redirect"), agent: pinned(), timeoutMs: 2000, headers: {} });
    assert.equal(moved.status, 302);
    assert.equal(moved.headers.location, "/final");
    moved.body.destroy();

    const ok = await send({ method: "GET", url: url("/final"), agent: pinned(), timeoutMs: 2000, headers: {} });
    assert.equal(ok.status, 200);
    assert.equal(await drain(ok.body), 4096, "본문을 스트림으로 받는다");
  } finally {
    server.close();
  }
});

test("진짜 소켓: 응답이 없거나 본문을 받다 멎으면 시간 제한으로 끊는다", async () => {
  const { server, url } = await localServer((req, res) => {
    if (req.url === "/silent") return; // 헤더도 안 보낸다
    res.writeHead(200, AUDIO);
    res.write(Buffer.alloc(1024, 1)); // 조금 보내고 멎는다
  });
  try {
    await assert.rejects(send({ method: "GET", url: url("/silent"), agent: pinned(), timeoutMs: 200, headers: {} }), /200ms/);
    const stalled = await send({ method: "GET", url: url("/stall"), agent: pinned(), timeoutMs: 200, headers: {} });
    await assert.rejects(drain(stalled.body));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("본문 무응답: 받는 쪽이 받으려는데 한도만큼 안 오면 오류로 닫는다. 받는 쪽이 멈춘 동안은 세지 않고, 소켓 시간 제한은 끈다", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
  let socketTimeout: number | null = null;
  const body = Object.assign(new PassThrough(), { setTimeout: (ms: number) => (socketTimeout = ms) });
  responder = () => ({ status: 200, headers: AUDIO, body });

  const stream = await safeUrl.getStream("https://files.example/a.mp3", deps, { bodyIdleMs: 6000 });
  const errors: Error[] = [];
  stream.on("error", (e) => errors.push(e));
  stream.resume();
  assert.equal(socketTimeout, 0, "오래 멈춘 재생을 소켓이 끊지 않게");

  body.write(Buffer.alloc(10));
  t.mock.timers.tick(5_000);
  body.pause(); // 받는 쪽이 멈춰 흐름이 막혔다
  t.mock.timers.tick(60_000);
  body.resume();
  t.mock.timers.tick(5_000);
  await new Promise((done) => setImmediate(done));
  assert.equal(errors.length, 0, "멈춘 동안은 세지 않고, 다시 받기 시작한 때부터 센다");

  body.write(Buffer.alloc(10)); // 받으면 처음부터 다시 센다
  t.mock.timers.tick(5_000);
  await new Promise((done) => setImmediate(done));
  assert.equal(errors.length, 0);

  t.mock.timers.tick(1_000);
  await new Promise((done) => setImmediate(done));
  assert.match(errors[0]?.message ?? "", /본문이 6000ms 동안 오지 않습니다/);
});

// Node 24 는 NODE_USE_ENV_PROXY=1 이면 전역 에이전트가 HTTP_PROXY 를 탄다. 프로세스를 띄울 때 읽으므로 자식으로 본다.
// 프록시를 타면 목적지를 프록시가 다시 풀어 고정 접속이 무의미해진다
test("진짜 소켓: 프록시 환경 변수를 켜도 고정 에이전트는 프록시를 타지 않는다", async () => {
  const { server, url } = await localServer((_req, res) => res.writeHead(200, AUDIO).end("직접"));
  try {
    const probe = `
      const { _internals } = await import(${JSON.stringify(new URL("../../src/infra/safe-url.ts", import.meta.url).href)});
      const r = await _internals.send({ method: "GET", url: new URL(${JSON.stringify(url("/").href)}), agent: _internals.createPinnedAgent("http:", "127.0.0.1", 4), timeoutMs: 2000, headers: {} });
      let body = ""; for await (const c of r.body) body += c;
      console.log("PROBE " + r.status + " " + body);`;
    const env = { ...process.env, NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", NO_PROXY: "", no_proxy: "" };
    const child = await new Promise<{ stdout: string }>((done) => {
      // spawnSync 은 이 프로세스의 서버를 막으므로 비동기로 띄운다
      const c = spawn(process.execPath, ["--input-type=module", "-e", probe], { env });
      let stdout = "";
      c.stdout.on("data", (d) => (stdout += d));
      c.on("close", () => done({ stdout }));
    });
    assert.match(child.stdout, /PROBE 200 직접/);
  } finally {
    server.close();
  }
});
