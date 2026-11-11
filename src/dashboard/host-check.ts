// Host 확인: 허용하는 호스트로 온 요청만 처리한다. 공격자의 공개 도메인이 이 봇의 주소를 가리키게 해 브라우저에서 접근하는 DNS 리바인딩을 막는다.
// 허용하는 호스트: 공개 주소(DASHBOARD_URL)의 호스트, localhost와 *.localhost, IP, 점 없는 호스트 이름, .local, .home.arpa, .internal, .lan.
// Host 헤더는 늘 검사하고, 바로 앞 홉을 신뢰하면 X-Forwarded-Host도 모든 값을 검사한다(내부 주소의 브라우저도 신뢰하는 홉이라 리바인딩 페이지가 이 헤더를 붙여 Host를 덮어쓰지 못하게 한다).
// 요청 대상이 절대 형식(GET http://호스트/경로)이면 그 호스트도 검사한다. 형식이 잘못되었거나 Host가 없거나 여러 개면 막는다.
// Host를 IP로 바꾸고 원래 이름을 넘기지 않는 프록시 뒤에서는 이 검사가 원래 이름을 보지 못한다(프록시가 Host나 X-Forwarded-Host를 넘겨야 한다)

import { isIP } from "node:net";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import logger from "../infra/log/logger.ts";
import { trustedPeer } from "./browser-side.ts";
import { warnGate } from "./warn-gate.ts";

const log = logger.child({ category: "dashboard" });

/** 이 접미사로 끝나면 허용한다(로컬이나 사설망에서만 쓰이는 도메인) */
const LOCAL_SUFFIXES = [".localhost", ".local", ".home.arpa", ".internal", ".lan"];
/**
 * Host 값 하나를 비교할 형태로: 소문자, IDNA(punycode), 포트와 끝의 점 제거, IPv6는 대괄호 포함.
 * 사용자 정보, 경로, 공백, % 같은 것이 섞였거나 형식이 잘못되면 null
 */
function normalizeHost(value: string): string | null {
  const text = value.trim();
  if (!text || /[\s@/\\?#%,]/.test(text)) return null;
  try {
    const url = new URL(`http://${text}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.hostname.replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

/** 허용하는 호스트인지. urlHost: 공개 주소의 호스트(normalizeHost 형태) */
function allowedHost(host: string, urlHost: string | null) {
  if (host === urlHost || host === "localhost") return true;
  if (isIP(host.replace(/^\[(.*)\]$/, "$1"))) return true;
  if (!host.includes(".")) return true;
  return LOCAL_SUFFIXES.some((s) => host.endsWith(s));
}

type HostValue = { header: string; value: string };

/** 이 요청에서 검사할 호스트 값들(어느 헤더에서 왔는지와 함께). Host 헤더가 없거나 여러 개면 null */
function hostValues(req: Request): HostValue[] | null {
  const hosts = req.rawHeaders.filter((name, i) => i % 2 === 0 && name.toLowerCase() === "host");
  if (hosts.length !== 1 || req.headers.host === undefined) return null;
  const values: HostValue[] = [{ header: "Host", value: req.headers.host }];
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(req.url);
  if (absolute) values.push({ header: "요청 대상", value: absolute[1] });
  const forwarded = trustedPeer(req) ? req.headers["x-forwarded-host"] : undefined;
  for (const value of String(forwarded ?? "").split(",")) if (value.trim()) values.push({ header: "X-Forwarded-Host", value });
  return values;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** 모든 요청의 앞(정적 파일, 세션보다 앞): 허용하지 않은 호스트로 온 요청에 403과 안내를 보낸다 */
function hostCheck(url: string): RequestHandler {
  let urlHost: string | null = null;
  try {
    urlHost = normalizeHost(new URL(url).host);
  } catch {
    // 설정 값은 읽을 때 이미 검사했다. 여기까지 오지 않는다
    urlHost = null;
  }
  const gate = warnGate();
  return (req: Request, res: Response, next: NextFunction) => {
    const values = hostValues(req);
    const checked = values?.map(({ header, value }) => ({ header, host: normalizeHost(value) })) ?? [{ header: "Host", host: null }];
    const bad = checked.find(({ host }) => host === null || !allowedHost(host, urlHost));
    if (!bad) return next();
    const shown = bad.host;
    const verdict = gate(`${bad.header}:${shown ?? ""}`);
    if (verdict === "warn") {
      log.warn(shown ? `허용하지 않은 호스트로 온 요청 차단(${bad.header}): ${shown}. 이 주소로 접속하려면 DASHBOARD_URL을 이 주소로 바꾸세요.` : "Host 헤더가 없거나 여러 개이거나 형식이 잘못된 요청 차단");
    } else if (verdict === "cap") {
      log.warn("허용하지 않은 호스트로 온 요청이 많아 1시간 동안 더는 로그에 남기지 않음(차단은 그대로)");
    }
    const body = shown ? `<p>이 주소(${escapeHtml(shown)})로는 대시보드를 열 수 없어요.</p><p>이 주소로 접속하려면 봇의 .env에서 <code>DASHBOARD_URL</code>을 이 주소로 바꾸고 봇을 다시 시작하세요.</p>` : "<p>요청의 Host 헤더가 잘못되어 대시보드를 열 수 없어요.</p>";
    res.status(403).type("html").send(`<!doctype html><meta charset="utf-8"><title>대시보드</title>${body}`);
  };
}

export { hostCheck, normalizeHost, allowedHost };
