/**
 * 사용자가 준 URL을 봇 서버가 대신 요청할 때의 SSRF 방어. DirectLink의 HEAD·GET과 파비콘의 링크로 추가가 여기를 지난다.
 *
 *  - 스키마 화이트리스트(http/https만)
 *  - 내부·예약 IP 대역 차단 (infra/public-address: 공인 unicast만 통과, IPv4-매핑 언랩)
 *  - IP 우회표기 정규화 (10진/16진/8진/매핑 모두 판정이 쓰는 ipaddr.parse가 해석)
 *  - DNS 리바인딩 차단 (해석 1회 → 그 IP로 핀 접속, 소켓 재해석 불가)
 *  - 리다이렉트 홉별 재검증 (http.request 는 따라가지 않는다. 수동 루프, IP-리터럴 리다이렉트까지 검사)
 *  - 프록시 환경 변수를 따르지 않는다 (고정 에이전트는 NODE_USE_ENV_PROXY 에도 프록시를 타지 않는다)
 *  - Content-Type 화이트리스트 + 파일 크기 상한 + 타임아웃 (부르는 쪽이 Accept 로 정한다, 기본은 직접 링크의 음원)
 *
 * 차단 사유는 서버 로그에만 남기고 사용자에게는 일반화된 오류만 준다.
 * 어느 IP가 막혔는지 알려 주면 봇이 내부망 탐지 도구가 된다.
 */

import type { Readable } from "stream";
import { promises as dns } from "dns";
import net from "net";
import http from "http";
import https from "https";
import { pipeline, Transform } from "stream";
import { isPublicIp } from "./public-address.ts";
import config from "../config/index.ts";

// --- 보안 상수 (코드 고정: 오설정으로 방어가 꺼지지 않도록 .env화하지 않음) ---
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const MAX_REDIRECTS = 3;
const HEAD_TIMEOUT_MS = 10000;
const GET_TIMEOUT_MS = 30000;
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const ALLOWED_CONTENT_TYPE = /^\s*(audio\/|video\/|application\/octet-stream|binary\/octet-stream)/i;

// DNS 조회. 테스트가 가짜를 넘긴다
type LookupFn = (host: string, options: { all: true; verbatim: boolean }) => Promise<Array<{ address: string; family: number }>>;
/** 요청 하나. 접속은 agent(고정 IP)로만 한다 */
type Outgoing = { method: "HEAD" | "GET"; url: URL; agent: http.Agent; timeoutMs: number; headers: Record<string, string> };
/** 응답. 본문은 스트림이고 다 쓰거나 부숴야 한다 */
type Incoming = { status: number; headers: Record<string, unknown>; body: Readable };
/** 요청 함수. 테스트가 가짜를 넘긴다 */
type HttpRequest = (request: Outgoing) => Promise<Incoming>;
/** 외부 경계. 생략하면 send 와 dns.lookup */
type RequestDeps = { request?: HttpRequest; lookup?: LookupFn };
/** 받을 것의 조건: Content-Type · 크기 상한 · 시간 한도(홉마다의 응답 대기, getBuffer 는 다운로드 전체에도) */
type Accept = { contentType: RegExp; maxBytes: number; timeoutMs: number };
/** 직접 링크(음원)의 조건 */
const DIRECT_LINK: Accept = { contentType: ALLOWED_CONTENT_TYPE, maxBytes: MAX_BYTES, timeoutMs: GET_TIMEOUT_MS };

class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/** 공인(global unicast) IP 가 아니면 막는다. 판정은 infra/public-address(패널의 대시보드 링크와 같은 판정) */
const isBlockedIp = (ip: string) => !isPublicIp(ip);

/** Content-Type 화이트리스트. 헤더 부재는 허용(일부 CDN이 생략). IP 차단이 주 방어이고 이건 심층방어. */
function isAllowedContentType(contentType: unknown, allowed = ALLOWED_CONTENT_TYPE): boolean {
  if (!contentType) return true;
  return allowed.test(String(contentType));
}

/**
 * URL 파싱 + 스키마/호스트 검증 + 접속할 IP 결정.
 * 호스트명은 모든 A/AAAA를 해석해 하나라도 내부면 거부하고, 통과 시 접속할 IP를 핀한다.
 * @throws {SsrfError}
 */
async function validateAndResolve(rawUrl: string, lookup: LookupFn = dns.lookup.bind(dns)): Promise<{ url: URL; pinnedIp: string; family: number }> {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`잘못된 URL: ${rawUrl}`);
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SsrfError(`허용되지 않는 스키마: ${url.protocol}`);
  }

  // URL.hostname은 IPv6 리터럴을 대괄호 포함으로 준다('[::1]'). net.isIP 판정 전에 벗긴다.
  // (안 벗기면 모든 IPv6 리터럴이 DNS 경로로 빠져 공인 IPv6 주소도 사용 불가)
  const rawHost = url.hostname;
  const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;

  // 호스트가 IP 리터럴이면 net이 DNS lookup을 건너뛰므로(=핀 에이전트 우회) 여기서 직접 검사
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError(`차단된 IP(리터럴): ${host}`);
    return { url, pinnedIp: host, family: net.isIPv6(host) ? 6 : 4 };
  }

  let addrs;
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(`DNS 해석 실패: ${host}`);
  }
  if (!addrs || addrs.length === 0) throw new SsrfError(`DNS 결과 없음: ${host}`);
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new SsrfError(`차단된 IP: ${a.address} (${host})`);
  }
  const chosen = addrs[0];
  return { url, pinnedIp: chosen.address, family: chosen.family };
}

/**
 * 검증된 IP로만 접속하는 에이전트. lookup을 무시하고 항상 핀 IP를 돌려줘
 * 소켓 레벨의 DNS 재해석(리바인딩)을 차단한다. autoSelectFamily(Node20+)가
 * all:true로 호출하는 경우까지 처리.
 */
function createPinnedAgent(protocol: string, pinnedIp: string, family: number) {
  const Agent = protocol === "https:" ? https.Agent : http.Agent;
  return new Agent({
    keepAlive: false,
    lookup(_hostname, options, callback) {
      if (options && options.all) {
        callback(null, [{ address: pinnedIp, family }]);
      } else {
        callback(null, pinnedIp, family);
      }
    },
  });
}

/**
 * 요청 하나를 보낸다. 리다이렉트를 따라가지 않고, 프록시를 타지 않고, 주어진 에이전트(고정 IP)로만 접속한다.
 * 시간 제한은 소켓이 그만큼 조용하면 끊는다(응답을 기다릴 때도, 본문을 받는 중에도).
 */
function send({ method, url, agent, timeoutMs, headers }: Outgoing): Promise<Incoming> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, { method, agent, headers, timeout: timeoutMs }, (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }));
    req.on("timeout", () => req.destroy(new Error(`응답이 ${timeoutMs}ms 동안 없습니다`)));
    req.on("error", reject);
    req.end();
  });
}

/**
 * 가드된 요청 + 수동 리다이렉트 루프. 각 홉을 재검증·핀 접속한다.
 * 호출측이 응답 본문을 다 쓰거나 부순 뒤 agent.destroy() 한다.
 */
async function guardedRequest(method: "HEAD" | "GET", rawUrl: string, { request = send, lookup }: RequestDeps = {}, timeoutMs = method === "HEAD" ? HEAD_TIMEOUT_MS : GET_TIMEOUT_MS, extra: Record<string, string> = {}) {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url, pinnedIp, family } = await validateAndResolve(currentUrl, lookup);
    const agent = createPinnedAgent(url.protocol, pinnedIp, family);

    let response;
    try {
      // 덧붙인 헤더(Range)는 홉마다 다시 보낸다
      response = await request({ method, url, agent, timeoutMs, headers: { "User-Agent": config.userAgents.browser, ...extra } });
    } catch (err) {
      agent.destroy();
      throw err;
    }

    if (response.status >= 300 && response.status < 400) {
      // 리다이렉트: 본문과 소켓을 정리하고 다음 홉에서 재검증
      response.body.destroy();
      agent.destroy();
      const location = response.headers.location;
      if (!location) throw new SsrfError("리다이렉트 응답에 Location 헤더 없음");
      currentUrl = new URL(String(location), url).href; // 상대 경로/프로토콜 상대 처리
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      response.body.destroy();
      agent.destroy();
      // 받는 쪽이 상태로 가른다(416 은 받을 구간이 없음, 4xx 는 다시 받아도 같다)
      throw Object.assign(new Error(`요청 실패: HTTP ${response.status}`), { status: response.status });
    }

    return { response, agent, finalUrl: url.href };
  }

  throw new SsrfError(`리다이렉트 횟수 초과(>${MAX_REDIRECTS})`);
}

/** 최대 크기 초과 시 에러로 스트림을 끊는 통과 변환. */
function byteCap(maxBytes: number) {
  let total = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(new Error(`다운로드한 파일이 최대 크기(${maxBytes} bytes)를 초과했습니다`));
        return;
      }
      cb(null, chunk);
    },
  });
}

/** 응답 헤더의 Content-Type / Content-Length 심층방어 검사. @throws {SsrfError} */
function assertResponseAllowed(responseHeaders: object, accept = DIRECT_LINK) {
  const headers = responseHeaders as Record<string, unknown>;
  const ct = headers["content-type"] || "";
  if (!isAllowedContentType(ct, accept.contentType)) {
    throw new SsrfError(`허용되지 않는 Content-Type: ${String(ct)}`);
  }
  const len = headers["content-length"];
  if (len && Number(len) > accept.maxBytes) {
    throw new SsrfError(`파일이 최대 크기(${accept.maxBytes} bytes)를 초과: ${String(len)}`);
  }
}

/**
 * 가드된 HEAD. 최종 응답 헤더 반환(Content-Type/크기 검증 포함). @throws
 * deps: { request, lookup } 외부 경계. 생략하면 send 와 dns.lookup
 */
async function head(rawUrl: string, deps: RequestDeps = {}) {
  const { response, agent } = await guardedRequest("HEAD", rawUrl, deps);
  try {
    assertResponseAllowed(response.headers);
    return { status: response.status, headers: response.headers };
  } finally {
    response.body.destroy();
    agent.destroy();
  }
}

const BODY_CHECK_MS = 1000;

/**
 * 본문 무응답 감시. 받는 쪽이 받으려는데 idleMs 동안 아무것도 오지 않으면 스트림을 오류로 닫는다.
 * 받는 쪽이 멈춰(일시정지 등) 흐름을 막은 동안은 서버가 조용한 것이 정상이라 세지 않는다.
 * 소켓의 시간 제한은 이 둘을 가르지 못해 오래 멈춘 재생을 끊는다. 그래서 응답이 오면 소켓 쪽은 끄고 이것으로 바꾼다.
 * pipeline 뒤에 건다. 먼저 걸면 data 리스너가 흐름을 먼저 열어 받는 쪽 없이 흘린다
 */
function watchBodyIdle(source: Readable & { setTimeout?(ms: number): unknown }, idleMs: number) {
  source.setTimeout?.(0);
  let last = Date.now();
  source.on("data", () => (last = Date.now()));
  const timer = setInterval(
    () => {
      if (source.readableFlowing !== true) last = Date.now();
      else if (Date.now() - last >= idleMs) source.destroy(new Error(`본문이 ${idleMs}ms 동안 오지 않습니다`));
    },
    Math.min(BODY_CHECK_MS, idleMs),
  );
  timer.unref?.();
  source.once("close", () => clearInterval(timer));
}

/**
 * 가드된 GET 스트림. Content-Type 검증 + 크기 캡이 적용된 Readable 반환. deps 는 head 와 같다. @throws
 * bodyIdleMs: 받는 쪽이 받으려는데 본문이 이만큼 안 오면 끊는다(재생은 짧게 잡아 플레이어보다 먼저 결론 낸다).
 * accept: 받을 것의 조건(Content-Type · 크기 상한 · 홉마다의 응답 대기). 기본은 음원(직접 링크)
 * from · to: 이 바이트 구간을 받는다(Range, to 는 끝 바이트를 포함하고 없으면 끝까지). 서버가 따르지 않을 수 있어 받는 쪽이 상태 · 헤더로 확인한다(servedFrom).
 * ifRange: 처음 응답의 강한 ETag 나 Last-Modified. 파일이 바뀌었으면 서버가 구간 대신 전체를 준다(200)
 */
async function getStream(rawUrl: string, deps: RequestDeps = {}, { bodyIdleMs = GET_TIMEOUT_MS, accept = DIRECT_LINK, from, to, ifRange }: { bodyIdleMs?: number; accept?: Accept; from?: number; to?: number; ifRange?: string } = {}) {
  const { response, agent, finalUrl } = await guardedRequest("GET", rawUrl, deps, accept.timeoutMs, rangeHeaders(from, to, ifRange));
  const source = response.body;
  try {
    assertResponseAllowed(response.headers, accept);
  } catch (err) {
    source.destroy();
    agent.destroy();
    throw err;
  }

  // 받는 쪽이 음원의 버전(ETag 등) · 이어 받기가 됐는지(상태) · 리다이렉트를 거친 마지막 주소(재생목록의 상대 주소 기준)를 읽는다
  const capped = Object.assign(byteCap(accept.maxBytes), { headers: response.headers, status: response.status, url: finalUrl });
  pipeline(source, capped, () => {
    agent.destroy(); // 스트림 정상 종료/오류 어느 쪽이든 소켓 정리
  });
  watchBodyIdle(source, bodyIdleMs);
  return capped;
}

/**
 * 가드된 GET 을 끝까지 받아 버퍼로(작은 파일). accept 의 Content-Type · 크기 상한을 지키고, 다운로드 전체가 timeoutMs 를 넘으면 끊는다. deps 는 head 와 같다. @throws
 */
async function getBuffer(rawUrl: string, accept: Accept, deps: RequestDeps = {}): Promise<Buffer> {
  const { response, agent } = await guardedRequest("GET", rawUrl, deps, accept.timeoutMs);
  const source = response.body;
  const deadline = setTimeout(() => source.destroy(new Error(`다운로드가 ${accept.timeoutMs}ms 안에 끝나지 않았습니다`)), accept.timeoutMs);
  try {
    assertResponseAllowed(response.headers, accept);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of source as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > accept.maxBytes) throw new SsrfError(`파일이 최대 크기(${accept.maxBytes} bytes)를 초과했습니다`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(deadline);
    source.destroy();
    agent.destroy();
  }
}

/** 구간 요청의 헤더(from 이 없으면 없음). If-Range 는 구간과 함께일 때만 뜻이 있다 */
function rangeHeaders(from: number | undefined, to: number | undefined, ifRange: string | undefined): Record<string, string> {
  if (from === undefined) return {};
  return { Range: `bytes=${from}-${to ?? ""}`, ...(ifRange ? { "If-Range": ifRange } : {}) };
}

/** 받은 응답이 몇 바이트째부터인가: 206 이면 Content-Range 의 시작(없거나 깨졌으면 null), 그 밖은 처음부터(0) */
function servedFrom({ status, headers }: { status: number; headers: Record<string, unknown> }): number | null {
  if (status !== 206) return 0;
  const range = /^\s*bytes\s+(\d+)-\d+\/(?:\d+|\*)\s*$/i.exec(String(headers["content-range"] ?? ""));
  return range ? Number(range[1]) : null;
}

export { SsrfError, head, getStream, getBuffer, servedFrom, isBlockedIp, isAllowedContentType, validateAndResolve, MAX_BYTES, DIRECT_LINK, HEAD_TIMEOUT_MS };
// 테스트가 진짜 소켓으로 보는 것
export const _internals = { send, createPinnedAgent };
export type { Accept, LookupFn, HttpRequest, RequestDeps, Outgoing, Incoming };
