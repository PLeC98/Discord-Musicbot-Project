"use strict";

/**
 * SafeUrl — 사용자가 제공한 URL을 봇 서버가 대신 요청할 때의 SSRF 방어 계층.
 *
 * 직접 오디오 링크(DirectLink)의 getInfo(HEAD)·getStream(GET)이 이 모듈을 통과
 * 방어 요소:
 *  - 스키마 화이트리스트(http/https만)
 *  - 내부·예약 IP 대역 차단 (ipaddr.js: 공인 unicast만 통과, IPv4-매핑 언랩)
 *  - IP 우회표기 정규화 (10진/16진/8진/매핑 모두 ipaddr.parse가 해석)
 *  - DNS 리바인딩 차단 (해석 1회 → 그 IP로 핀 접속, 소켓 재해석 불가)
 *  - 리다이렉트 홉별 재검증 (maxRedirects:0 수동 루프, IP-리터럴 리다이렉트까지 검사)
 *  - Content-Type 화이트리스트 + 파일 크기 상한 + 타임아웃
 *
 * SSRF 오라클 방지: 차단 사유(어느 IP가 막혔는지)는 서버 로그로만 남기고, 이 모듈을 호출하는 쪽(DirectLink)은 사용자에게 일반화된 오류만 노출한다 — 안 그러면 봇이 내부망 도달성을 되짚어주는 탐지 도구가 된다.
 */

const axios = require("axios");
const dns = require("dns").promises;
const net = require("net");
const http = require("http");
const https = require("https");
const { pipeline, Transform } = require("stream");
const ipaddr = require("ipaddr.js");

// --- 보안 상수 (코드 고정: 오설정으로 방어가 꺼지지 않도록 .env화하지 않음) ---
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const MAX_REDIRECTS = 3;
const HEAD_TIMEOUT_MS = 10000;
const GET_TIMEOUT_MS = 30000;
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const ALLOWED_CONTENT_TYPE = /^\s*(audio\/|video\/|application\/octet-stream|binary\/octet-stream)/i;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

class SsrfError extends Error {
  constructor(message) {
    super(message);
    this.name = "SsrfError";
  }
}

/**
 * 공인(global unicast) IP만 통과. 그 외(사설·루프백·링크로컬·CGNAT·예약·멀티캐스트 등)
 * 전부 차단. 파싱 불가·IPv4-매핑 IPv6(::ffff:x)는 내장 IPv4로 재판정.
 */
function isBlockedIp(ip) {
  let addr;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return true; // 파싱 불가 → 차단
  }
  if (addr.kind() === "ipv6" && addr.isIPv4MappedAddress()) {
    return isBlockedIp(addr.toIPv4Address().toString());
  }
  return addr.range() !== "unicast";
}

/** Content-Type 화이트리스트. 헤더 부재는 허용(일부 CDN이 생략) — IP 차단이 주 방어이고 이건 심층방어. */
function isAllowedContentType(contentType) {
  if (!contentType) return true;
  return ALLOWED_CONTENT_TYPE.test(contentType);
}

/**
 * URL 파싱 + 스키마/호스트 검증 + 접속할 IP 결정.
 * 호스트명은 모든 A/AAAA를 해석해 하나라도 내부면 거부하고, 통과 시 접속할 IP를 핀한다.
 * @returns {{ url: URL, pinnedIp: string, family: number }}
 * @throws {SsrfError}
 */
async function validateAndResolve(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`잘못된 URL: ${rawUrl}`);
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SsrfError(`허용되지 않는 스키마: ${url.protocol}`);
  }

  // URL.hostname은 IPv6 리터럴을 대괄호 포함으로 준다('[::1]') — net.isIP 판정 전에 벗긴다.
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
    addrs = await dns.lookup(host, { all: true, verbatim: true });
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
 * 검증된 IP로만 접속하는 에이전트 — lookup을 무시하고 항상 핀 IP를 돌려줘
 * 소켓 레벨의 DNS 재해석(리바인딩)을 차단한다. autoSelectFamily(Node20+)가
 * all:true로 호출하는 경우까지 처리.
 */
function createPinnedAgent(protocol, pinnedIp, family) {
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
 * 가드된 요청 + 수동 리다이렉트 루프. 각 홉을 재검증·핀 접속한다.
 * @returns {{ response: import('axios').AxiosResponse, agent: import('http').Agent }}
 *   (호출측이 응답 소비 후 agent.destroy())
 */
async function guardedRequest(method, rawUrl, { responseType } = {}) {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url, pinnedIp, family } = await validateAndResolve(currentUrl);
    const isHttps = url.protocol === "https:";
    const agent = createPinnedAgent(url.protocol, pinnedIp, family);

    let response;
    try {
      response = await axios({
        method,
        url: url.href,
        responseType,
        timeout: method === "head" ? HEAD_TIMEOUT_MS : GET_TIMEOUT_MS,
        maxRedirects: 0, // 리다이렉트는 홉별 재검증을 위해 수동 처리
        maxContentLength: responseType === "stream" ? Infinity : MAX_BYTES,
        maxBodyLength: MAX_BYTES,
        validateStatus: (s) => s >= 200 && s < 400, // 3xx도 우리가 읽어야 함
        httpAgent: isHttps ? undefined : agent,
        httpsAgent: isHttps ? agent : undefined,
        headers: { "User-Agent": USER_AGENT },
      });
    } catch (err) {
      agent.destroy();
      throw err;
    }

    if (response.status >= 300 && response.status < 400) {
      // 리다이렉트: 스트림/소켓 정리 후 다음 홉에서 재검증
      if (responseType === "stream" && response.data && typeof response.data.destroy === "function") {
        response.data.destroy();
      }
      agent.destroy();
      const location = response.headers.location;
      if (!location) throw new SsrfError("리다이렉트 응답에 Location 헤더 없음");
      currentUrl = new URL(location, url).href; // 상대 경로/프로토콜 상대 처리
      continue;
    }

    return { response, agent };
  }

  throw new SsrfError(`리다이렉트 횟수 초과(>${MAX_REDIRECTS})`);
}

/** 최대 크기 초과 시 에러로 스트림을 끊는 통과 변환. */
function byteCap(maxBytes) {
  let total = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(new Error(`직접 링크 파일이 최대 크기(${maxBytes} bytes)를 초과했습니다`));
        return;
      }
      cb(null, chunk);
    },
  });
}

/** 응답 헤더의 Content-Type / Content-Length 심층방어 검사. @throws {SsrfError} */
function assertResponseAllowed(headers) {
  const ct = headers["content-type"] || "";
  if (!isAllowedContentType(ct)) {
    throw new SsrfError(`허용되지 않는 Content-Type: ${ct}`);
  }
  const len = headers["content-length"];
  if (len && Number(len) > MAX_BYTES) {
    throw new SsrfError(`파일이 최대 크기(${MAX_BYTES} bytes)를 초과: ${len}`);
  }
}

/** 가드된 HEAD — 최종 응답 헤더 반환(Content-Type/크기 검증 포함). @throws */
async function head(rawUrl) {
  const { response, agent } = await guardedRequest("head", rawUrl);
  try {
    assertResponseAllowed(response.headers);
    return { status: response.status, headers: response.headers };
  } finally {
    agent.destroy();
  }
}

/** 가드된 GET 스트림 — Content-Type 검증 + 크기 캡이 적용된 Readable 반환. @throws */
async function getStream(rawUrl) {
  const { response, agent } = await guardedRequest("get", rawUrl, { responseType: "stream" });
  const source = response.data;
  try {
    assertResponseAllowed(response.headers);
  } catch (err) {
    if (source && typeof source.destroy === "function") source.destroy();
    agent.destroy();
    throw err;
  }

  const capped = byteCap(MAX_BYTES);
  pipeline(source, capped, () => {
    agent.destroy(); // 스트림 정상 종료/오류 어느 쪽이든 소켓 정리
  });
  return capped;
}

module.exports = {
  SsrfError,
  head,
  getStream,
  // 테스트/재사용을 위한 내부 노출
  isBlockedIp,
  isAllowedContentType,
  validateAndResolve,
  MAX_BYTES,
};
