// 인터넷 평문 막기. 인터넷을 평문으로 지나는 길로 보이면 대시보드를 열지 않거나 모든 응답을 안내(403)로 바꾼다. DASHBOARD_ALLOW_PLAINTEXT로만 푼다.
// 흔한 설정 실수에서 세션이 인터넷 평문으로 만들어지지 않게 하는 장치이지 기밀성의 보장이 아니다(놓치는 것: 출발지 IP를 바꾸는 SNAT, 기동 뒤의 DNS 변경, 신뢰하는 프록시 뒤의 다른 평문 구간).
// - 홉 검사: 소켓이 평문이고 소켓 상대가 내부 주소가 아니다(봇 포트에 인터넷에서 바로, Cloudflare Flexible, 원격 프록시가 인터넷으로)
// - 브라우저 쪽 검사: 사용자 IP가 내부 주소가 아니고 브라우저 쪽이 http다(같은 기기의 프록시가 X-Forwarded-Proto: http로 알린 경우)
// - 공개 주소 검사(기동 시): 공개 주소가 http이고 그 호스트가 공인 주소면 대시보드를 열지 않는다. DNS를 조회하지 못하면 막지 않고 warn
// 같은 네트워크의 평문(사설망, Tailscale 안)은 막지 않는다

import dns from "node:dns/promises";
import type { TLSSocket } from "node:tls";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import logger from "../infra/log/logger.ts";
import { isLoopbackName, kindOf } from "../rules/net-address.ts";
import { clientIp, isInside } from "./client-ip.ts";
import { warnGate } from "./warn-gate.ts";

const log = logger.child({ category: "dashboard" });

/** 기동 시 공개 주소의 DNS를 조회하는 시간 제한 */
const LOOKUP_TIMEOUT_MS = 3000;

type Reason = "hop" | "browser";

/** 이 요청이 인터넷 평문으로 보이는 까닭. 아니면 null */
function plaintextReason(req: Request): Reason | null {
  if (!(req.socket as Partial<TLSSocket>).encrypted && !isInside(req.socket.remoteAddress)) return "hop";
  if (!req.secure && !isInside(clientIp(req))) return "browser";
  return null;
}

const REASON_TEXT: Record<Reason, string> = {
  hop: "인터넷 주소가 봇 포트에 평문으로 바로 붙음",
  browser: "프록시가 인터넷 사용자의 평문(http) 접속을 알림",
};

const PAGE = '<!doctype html><meta charset="utf-8"><title>대시보드</title>' + "<p>인터넷을 평문(http)으로 지나는 연결이라 대시보드를 열지 않았어요. 로그인 정보가 그대로 보일 수 있어요.</p>" + "<p>봇 운영자라면 docs/dashboard-network.md의 공개 방법대로 HTTPS로 공개하세요.</p>";

/** 모든 요청의 앞(Host 확인 뒤, 정적 파일, 세션보다 앞): 인터넷 평문 요청에 403과 안내 */
function plaintextGate(allow: boolean): RequestHandler {
  if (allow) return (_req, _res, next) => next();
  const gate = warnGate();
  return (req: Request, res: Response, next: NextFunction) => {
    const reason = plaintextReason(req);
    if (!reason) return next();
    const verdict = gate(reason);
    if (verdict === "warn") log.warn(`인터넷 평문 접속 차단(${REASON_TEXT[reason]}, ${clientIp(req)}). docs/dashboard-network.md의 공개 방법대로 HTTPS로 공개하세요. 위험을 감수한다면 .env에 DASHBOARD_ALLOW_PLAINTEXT=true`);
    else if (verdict === "cap") log.warn("인터넷 평문 접속이 많아 1시간 동안 더는 로그에 남기지 않음(차단은 그대로)");
    res.status(403).type("html").send(PAGE);
  };
}

type Lookup = (host: string) => Promise<Array<{ address: string }>>;
/** open이 false면 detail: 공인 주소(도메인이면 도메인 → 주소) */
type UrlVerdict = { open: true; note?: string } | { open: false; detail: string };

const defaultLookup: Lookup = (host) => dns.lookup(host, { all: true, verbatim: true });

/** 시간 제한 안에 DNS를 조회한다. 넘으면 "timeout" */
async function lookupWithin(lookup: Lookup, host: string, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((done) => (timer = setTimeout(() => done("timeout"), ms)));
  try {
    return await Promise.race([lookup(host), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 기동 시 공개 주소 검사: http이고 호스트가 공인 주소(도메인이면 조회된 주소 중 하나라도)면 열지 않는다.
 * 이 기기의 주소인지는 보지 않는다(VPS의 공인 IP는 이 기기 주소지만 인터넷이다)
 */
async function checkPublicUrl(url: string, { lookup = defaultLookup, timeoutMs = LOOKUP_TIMEOUT_MS }: { lookup?: Lookup; timeoutMs?: number } = {}): Promise<UrlVerdict> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:") return { open: true };
  const host = parsed.hostname
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "")
    .toLowerCase();
  if (isLoopbackName(host)) return { open: true };
  const literal = kindOf(host);
  if (literal) return literal === "public" ? { open: false, detail: host } : { open: true };
  let found: Awaited<ReturnType<Lookup>> | "timeout";
  try {
    found = await lookupWithin(lookup, host, timeoutMs);
  } catch (error) {
    const code = (error as { code?: string }).code;
    const why = code === "ENOTFOUND" || code === "EAI_NONAME" ? "찾지 못해" : `조회하지 못해(${code ?? "알 수 없음"})`;
    return { open: true, note: `DASHBOARD_URL의 호스트(${host})를 ${why} 공인 주소인지 확인하지 못함. 대시보드는 열고 요청마다 인터넷 평문을 검사` };
  }
  if (found === "timeout") return { open: true, note: `DASHBOARD_URL의 호스트(${host})를 ${timeoutMs / 1000}초 안에 조회하지 못해 공인 주소인지 확인하지 못함. 대시보드는 열고 요청마다 인터넷 평문을 검사` };
  const publicAddress = found.map((a) => a.address).find((a) => kindOf(a) === "public");
  return publicAddress ? { open: false, detail: `${host} → ${publicAddress}` } : { open: true };
}

/**
 * 기동 시: 공개 주소가 http이고 호스트가 점이 있는 도메인 이름이면 안내 한 줄(평문 허용과 상관없이). 아니면 null.
 * 같은 상위 도메인의 다른 사이트가 쿠키를 심을 수 있다. 같은 이름이 둘이면 받지 않지만(dashboard/cookies), 우리 쿠키가 없는 브라우저에 심은 하나는 가를 수 없다
 */
function siblingCookieNote(url: string): string | null {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:") return null;
  const host = parsed.hostname.replace(/\.$/, "").toLowerCase();
  if (!host.includes(".") || isLoopbackName(host) || kindOf(host.replace(/^\[(.*)\]$/, "$1"))) return null;
  return `DASHBOARD_URL이 http이고 도메인 이름(${host})이라 같은 상위 도메인의 다른 사이트가 쿠키를 심어 다른 계정으로 로그인시키거나 자기 세션을 쓰게 할 수 있음. HTTPS로 공개하세요`;
}

export { plaintextGate, plaintextReason, checkPublicUrl, siblingCookieNote, LOOKUP_TIMEOUT_MS };
