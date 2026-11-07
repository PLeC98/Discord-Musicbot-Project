// 인증서 파일로 봇이 직접 HTTPS를 연다(발급, 갱신은 하지 않는다). 설계는 notes/plan-dashboard-network.md 4.4.
// 찾는 곳: .env의 DASHBOARD_TLS_CERT, DASHBOARD_TLS_KEY(둘 다, .env가 있는 폴더 기준)가 있으면 그것만, 없으면 certs/cert.pem과 certs/key.pem(둘 다 있을 때만 켜진다).
// 기동 시 확인: PEM인지, 맨 앞이 서버 인증서인지, 키가 짝인지, 암호가 걸린 키인지, 유효 기간 안인지(문제가 있으면 열지 않는다), 중간 인증서, 이름, 남은 기한 14일, 키 파일 권한(warn).
// 파일을 바꾸면 봇을 다시 시작한다(다시 시작 없이 교체하지 않는다)

import fs from "node:fs";
import path from "node:path";
import { X509Certificate, createPrivateKey, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { SecureContextOptions, TlsOptions } from "node:tls";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";

const log = logger.child({ category: "dashboard" });

type TlsFiles = { cert: string; key: string; from: "certs" | "env" };
type Found = { files: TlsFiles | null; error: string | null };
type Note = { level: "info" | "warn"; text: string };
type Checked = { ok: true; leaf: X509Certificate; notes: Note[] } | { ok: false; errors: string[] };

/** 남은 기한이 이 일수 이하면 warn */
const WARN_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * 인증서 파일을 찾는다. .env 경로가 하나라도 있으면 둘 다 있어야 하고 certs/로 폴백하지 않는다.
 * certs/는 둘 다 있을 때만 쓰고 하나만 있으면 error. 아무것도 없으면 files, error 모두 null
 */
function findTlsFiles({ envCert, envKey, root, certsDir, exists = fs.existsSync }: { envCert: string | null; envKey: string | null; root: string; certsDir: string; exists?: (file: string) => boolean }): Found {
  if (envCert || envKey) {
    if (!envCert || !envKey) return { files: null, error: `.env에 DASHBOARD_TLS_CERT와 DASHBOARD_TLS_KEY를 둘 다 넣으세요(지금은 ${envCert ? "DASHBOARD_TLS_CERT" : "DASHBOARD_TLS_KEY"}만 있음).` };
    const cert = path.resolve(root, envCert);
    const key = path.resolve(root, envKey);
    const missing = [cert, key].filter((f) => !exists(f));
    if (missing.length) return { files: null, error: `.env의 DASHBOARD_TLS_CERT, DASHBOARD_TLS_KEY가 가리키는 파일이 없습니다: ${missing.join(", ")}` };
    return { files: { cert, key, from: "env" }, error: null };
  }
  const cert = path.join(certsDir, "cert.pem");
  const key = path.join(certsDir, "key.pem");
  const has = [exists(cert), exists(key)];
  if (has[0] && has[1]) return { files: { cert, key, from: "certs" }, error: null };
  if (has[0] || has[1]) return { files: null, error: `certs/에 ${has[0] ? "key.pem" : "cert.pem"}이 없습니다. cert.pem과 key.pem을 둘 다 두거나 둘 다 빼세요.` };
  return { files: null, error: null };
}

const CERT_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
/** Cloudflare Origin CA가 발급한 인증서(중간 인증서 없이 쓰는 것이 정상) */
const isCloudflareOrigin = (leaf: Pick<X509Certificate, "issuer">) => /CloudFlare Origin SSL (ECC )?Certificate Authority/i.test(leaf.issuer);
/** 자체 서명 인증서(발급자가 자신이고 자기 공개 키로 서명이 맞는다). checkIssued는 키 용도까지 봐서 서버 인증서에는 false다 */
const isSelfSigned = (leaf: X509Certificate) => leaf.issuer === leaf.subject && leaf.verify(leaf.publicKey);

const dateText = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** 남은 일수(올림) */
/** 유효 기간(ms). 읽지 못하면 null */
function validRange(leaf: Pick<X509Certificate, "validFrom" | "validTo">) {
  const from = Date.parse(leaf.validFrom);
  const to = Date.parse(leaf.validTo);
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
}
const daysLeft = (leaf: X509Certificate, now: number) => Math.ceil((Date.parse(leaf.validTo) - now) / DAY_MS);

/** 키 PEM을 읽는다. 암호가 걸렸거나 읽지 못하면 그 까닭 */
function keyProblem(keyPem: string): string | null {
  if (/ENCRYPTED/.test(keyPem)) return "키에 암호가 걸려 있어 쓸 수 없습니다. 암호를 푼 키를 쓰세요(예: openssl pkey -in 암호키.pem -out key.pem).";
  try {
    createPrivateKey(keyPem);
    return null;
  } catch (error) {
    return `키를 읽지 못했습니다(PEM 형식의 개인 키인지 확인하세요): ${messageOf(error)}`;
  }
}

/**
 * 인증서와 키를 확인한다. errors가 있으면 대시보드를 열지 않는다. notes는 연 뒤에 남기는 warn
 * urlHost: 공개 주소의 호스트(대괄호 없이), now: 지금 시각, keyWorldReadable: 키 파일을 다른 사용자가 읽을 수 있는지(Windows는 false)
 */
function checkTls({ certPem, keyPem, urlHost, now = Date.now(), keyWorldReadable = false }: { certPem: string; keyPem: string; urlHost: string; now?: number; keyWorldReadable?: boolean }): Checked {
  const blocks = certPem.match(CERT_BLOCK) ?? [];
  if (!blocks.length) return { ok: false, errors: ["인증서 파일이 PEM 형식이 아닙니다(-----BEGIN CERTIFICATE-----로 시작하는 파일)."] };
  let certs: X509Certificate[];
  try {
    certs = blocks.map((b) => new X509Certificate(b));
  } catch (error) {
    return { ok: false, errors: [`인증서를 읽지 못했습니다: ${messageOf(error)}`] };
  }
  const [leaf, ...rest] = certs;
  const errors = fatalProblems(leaf, keyPem, now);
  return errors.length ? { ok: false, errors } : { ok: true, leaf, notes: softProblems({ leaf, rest, urlHost, now, keyWorldReadable }) };
}

/** 열지 않는 문제: 맨 앞이 CA 인증서, 키(암호, 형식, 짝), 유효 기간 */
function fatalProblems(leaf: X509Certificate, keyPem: string, now: number) {
  const errors: string[] = [];
  // 깨진 날짜는 OpenSSL에서 "Bad time value"가 되어 Date.parse가 NaN이 된다(그대로 두면 유효 기간 검사를 모두 통과한다)
  if (!validRange(leaf)) return [...errors, `인증서의 유효 기간을 읽지 못했습니다(${leaf.validFrom} ~ ${leaf.validTo}). 다시 발급받은 인증서를 쓰세요.`];
  if (leaf.ca) errors.push("인증서 파일의 맨 앞이 서버 인증서가 아닙니다(CA 인증서). 서버 인증서 다음에 중간 인증서를 이어 붙이세요.");
  const badKey = keyProblem(keyPem);
  if (badKey) errors.push(badKey);
  else if (!leaf.ca && !leaf.checkPrivateKey(createPrivateKey(keyPem))) errors.push("키가 인증서와 짝이 아닙니다. 그 인증서를 발급받을 때 쓴 키를 넣으세요.");
  if (Date.parse(leaf.validFrom) > now) errors.push(`인증서가 아직 유효하지 않습니다(유효 시작 ${dateText(Date.parse(leaf.validFrom))}). 기기의 시각을 확인하세요.`);
  if (Date.parse(leaf.validTo) <= now) errors.push(`인증서의 기한이 지났습니다(${dateText(Date.parse(leaf.validTo))}). 새 인증서로 바꾸고 봇을 다시 시작하세요.`);
  return errors;
}

/** 열고 warn하는 문제: 중간 인증서, 이름, 남은 기한, 키 파일 권한 */
function softProblems({ leaf, rest, urlHost, now, keyWorldReadable }: { leaf: X509Certificate; rest: X509Certificate[]; urlHost: string; now: number; keyWorldReadable: boolean }) {
  const notes: Note[] = [];
  const issued = rest.some((c) => leaf.checkIssued(c));
  if (!issued && !isCloudflareOrigin(leaf) && !isSelfSigned(leaf)) notes.push({ level: "warn", text: "인증서 파일에 중간 인증서가 없습니다. 브라우저는 대개 스스로 찾지만 일부 기기는 붙지 못할 수 있습니다(fullchain.pem처럼 서버 인증서 다음에 중간 인증서를 이은 파일을 쓰세요)." });
  // 호스트 이름 검증은 현행 표준(RFC 9525)대로: 부분 와일드카드(a*.example.com), SAN이 없을 때 CN으로 대체하는 것은 허용하지 않는다
  const named = isIP(urlHost) ? leaf.checkIP(urlHost) : leaf.checkHost(urlHost, { partialWildcards: false, subject: "never" });
  if (!named) notes.push({ level: "warn", text: `인증서의 이름에 공개 주소의 호스트(${urlHost})가 없습니다. 브라우저가 경고합니다(인증서 이름: ${leaf.subjectAltName ?? leaf.subject}).` });
  const left = daysLeft(leaf, now);
  if (left <= WARN_DAYS) notes.push({ level: "warn", text: expiryText(left, leaf) });
  if (keyWorldReadable) notes.push({ level: "warn", text: "키 파일을 이 기기의 다른 사용자도 읽을 수 있습니다(chmod 600)." });
  return notes;
}

const expiryText = (left: number, leaf: X509Certificate) => `대시보드 인증서의 기한이 ${left}일 남았습니다(${dateText(Date.parse(leaf.validTo))}). 새 인증서로 바꾸고 봇을 다시 시작하세요.`;

/** Mozilla intermediate(TLS 1.2 cipher suite, TLS 1.3은 OpenSSL 기본 세 가지). Node 기본에는 CBC cipher suite가 들어 있다 */
const CIPHERS = ["TLS_AES_128_GCM_SHA256", "TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256", "ECDHE-ECDSA-AES128-GCM-SHA256", "ECDHE-RSA-AES128-GCM-SHA256", "ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-RSA-AES256-GCM-SHA384", "ECDHE-ECDSA-CHACHA20-POLY1305", "ECDHE-RSA-CHACHA20-POLY1305", "DHE-RSA-AES128-GCM-SHA256", "DHE-RSA-AES256-GCM-SHA384", "DHE-RSA-CHACHA20-POLY1305"].join(":");

/** HTTPS 서버의 TLS 설정: TLS 1.2 이상, 위 cipher suite, ALPN은 http/1.1만(HTTP/2를 알리면서 HTTP/1로 받으면 연결이 깨진다) */
function tlsOptions(certPem: string, keyPem: string): TlsOptions & SecureContextOptions {
  return { cert: certPem, key: keyPem, minVersion: "TLSv1.2", ciphers: CIPHERS, dhparam: "auto", ALPNProtocols: ["http/1.1"] };
}

/** 키 파일을 다른 사용자가 읽을 수 있는지(리눅스, macOS의 권한. Windows의 ACL은 보지 않는다) */
function worldReadable(file: string, platform = process.platform) {
  if (platform === "win32") return false;
  try {
    return (fs.statSync(file).mode & 0o004) !== 0;
  } catch {
    return false;
  }
}

type TlsState = { from: TlsFiles["from"]; expiresAt: number; daysLeft: number } | null;
let state: TlsState = null;
let timer: NodeJS.Timeout | null = null;

/** 봇 상태 탭의 인증서 기한. 인증서 파일로 열지 않았으면 null */
function tlsStatus(now = Date.now()): TlsState {
  return state ? { ...state, daysLeft: Math.ceil((state.expiresAt - now) / DAY_MS) } : null;
}

/** 연 뒤: 하루 한 번 남은 기한을 다시 계산해 14일 안이면 warn, 지났으면 error(봇 상태에도 보인다) */
function watchExpiry(leaf: X509Certificate, from: TlsFiles["from"]) {
  state = { from, expiresAt: Date.parse(leaf.validTo), daysLeft: daysLeft(leaf, Date.now()) };
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    const left = daysLeft(leaf, Date.now());
    if (left <= 0) log.error(`대시보드 인증서의 기한이 지남(${dateText(Date.parse(leaf.validTo))}). 브라우저가 접속을 막음. 새 인증서로 바꾸고 봇을 다시 시작하세요`);
    else if (left <= WARN_DAYS) log.warn(expiryText(left, leaf));
  }, DAY_MS);
  timer.unref();
}

/** TLS 세션 티켓 키 교체 주기. 같은 키를 오래 쓰면 키가 유출되었을 때 기록해 둔 TLS 1.2 세션을 복호화할 수 있다 */
const TICKET_ROTATE_MS = 12 * 60 * 60_000;

/** 연 HTTPS 서버들의 세션 티켓 키를 주기적으로 새로 만든다(타이머는 프로세스를 붙잡지 않는다) */
function rotateTicketKeys(servers: readonly object[], every = TICKET_ROTATE_MS) {
  const rotate = () => {
    // HTTPS 서버(tls.Server)에만 있다
    for (const server of servers) (server as { setTicketKeys?: (keys: Buffer) => void }).setTicketKeys?.(randomBytes(48));
  };
  rotate();
  setInterval(rotate, every).unref();
}

export { findTlsFiles, checkTls, tlsOptions, worldReadable, tlsStatus, watchExpiry, rotateTicketKeys, isCloudflareOrigin, validRange, fatalProblems, WARN_DAYS };
export type { TlsFiles };
