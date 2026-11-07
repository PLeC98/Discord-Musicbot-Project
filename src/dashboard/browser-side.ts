// 브라우저 쪽에서 본 요청: 브라우저와 첫 홉 사이가 HTTPS인지, 어느 호스트로 왔는지. 쿠키 이름과 Secure, HSTS, 평문 접속 판정에 쓴다.
// X-Forwarded-* 헤더는 바로 앞 홉을 신뢰할 때만 읽는다(dashboard/client-ip의 trust proxy와 같은 기준)

import type { TLSSocket } from "node:tls";
import type { NextFunction, Request, RequestHandler, Response } from "express";

type TrustFn = (addr: string, i: number) => boolean;

/** 바로 앞 홉(소켓 상대)을 신뢰하는지 */
function trustedPeer(req: Request) {
  const trust = req.app.get("trust proxy fn") as TrustFn;
  return trust(req.socket.remoteAddress ?? "", 0);
}

/**
 * 브라우저 쪽이 HTTPS인지 다음 순서로 판정한다:
 * 1. 바로 앞 홉을 신뢰하고 X-Forwarded-Proto를 보냈으면 그 값(여러 개면 모두 https일 때만)
 * 2. 소켓이 TLS면 https(인증서 파일로 봇이 직접 TLS를 처리하는 구성)
 * 3. 바로 앞 홉을 신뢰하고 공개 주소가 https면 https(X-Forwarded-Proto를 보내지 않는 최소 설정의 프록시).
 *    그 프록시가 실제로는 평문으로 받으면 브라우저가 Secure 쿠키를 받지 않아 로그인이 되지 않는다(fail-closed)
 */
function browserSecure(req: Request, urlHttps: boolean): boolean {
  const trusted = trustedPeer(req);
  const header = trusted ? req.headers["x-forwarded-proto"] : undefined;
  const values = String(header ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (values.length) return values.every((v) => v === "https");
  if ((req.socket as Partial<TLSSocket>).encrypted) return true;
  return trusted && urlHttps;
}

/** 호스트 이름을 비교할 형태로: 소문자, 끝의 점 제거 */
const hostKey = (host: string) => host.toLowerCase().replace(/\.$/, "");

/** 공개 주소가 https면 그 호스트 이름, 아니면 null */
function httpsHostOf(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? hostKey(parsed.hostname) : null;
  } catch {
    return null;
  }
}

/** 모든 요청의 맨 앞: req.secure, req.protocol을 브라우저 쪽 판정으로 바꾼다(Express는 X-Forwarded-Proto의 첫 값만 보고, 공개 주소 폴백이 없다) */
function browserSide(url: string): RequestHandler {
  const urlHttps = httpsHostOf(url) !== null;
  return (req: Request, _res: Response, next: NextFunction) => {
    const secure = browserSecure(req, urlHttps);
    Object.defineProperty(req, "secure", { value: secure, configurable: true, enumerable: true });
    Object.defineProperty(req, "protocol", { value: secure ? "https" : "http", configurable: true, enumerable: true });
    next();
  };
}

/** HSTS 기간(1년). 되돌리려면 브라우저가 기억한 이 기간 동안 HTTPS를 계속 열어 두어야 한다 */
const HSTS_MAX_AGE = 31_536_000;

/**
 * HSTS: 브라우저 쪽이 HTTPS이고 Host가 https 공개 주소의 호스트일 때만 붙인다.
 * localhost, IP, 다른 이름으로 열어 본 브라우저가 그 호스트를 HTTPS 전용으로 기억하지 않게 한다(includeSubDomains, preload는 붙이지 않는다)
 */
function strictTransport(url: string): RequestHandler {
  const host = httpsHostOf(url);
  return (req: Request, res: Response, next: NextFunction) => {
    if (host && req.secure && hostKey(req.hostname ?? "") === host) res.setHeader("Strict-Transport-Security", `max-age=${HSTS_MAX_AGE}`);
    next();
  };
}

export { browserSecure, browserSide, strictTransport, httpsHostOf };
