// 대시보드를 열 주소와 기동 진단. 먼저 맞는 것으로 연다:
// 1. DASHBOARD_HOST  2. 컨테이너 안이면 모든 주소  3. 공개 주소가 없거나 이 기기 주소면 127.0.0.1과 ::1
// 4. 인증서 파일이 있으면 모든 주소(봇이 직접 TLS를 처리하므로 앞에 프록시가 없다고 본다)
// 5. 공개 주소가 https면 127.0.0.1과 ::1(앞의 프록시가 같은 기기에 있다고 본다)  6. 그 밖(http, 이 기기 주소 아님)은 모든 주소.
// 환경 판별은 추정이므로 기동 로그에 선택한 주소와 까닭, 접속할 수 있는 주소를 늘 보인다

import fs from "node:fs";
import os from "node:os";
import { isIP } from "node:net";
import { kindOf, normalizeIp } from "../rules/net-address.ts";

type BindReason = "env" | "container" | "loopback-url" | "certs" | "https-url" | "plain-url";
/** hosts: 열 주소(::는 열지 못하면 0.0.0.0으로), all: 모든 주소인지 */
type BindPlan = { hosts: string[]; all: boolean; reason: BindReason };
type Note = { level: "info" | "warn"; text: string };

const LOOPBACK = ["127.0.0.1", "::1"];
const ALL = ["::"];

/** 컨테이너 안인지(Docker, Podman, Kubernetes). 추정이다 */
function inContainer(exists: (file: string) => boolean = fs.existsSync, env: NodeJS.ProcessEnv = process.env) {
  return exists("/.dockerenv") || exists("/run/.containerenv") || Boolean(env.KUBERNETES_SERVICE_HOST);
}

/** URL의 호스트(대괄호, 끝의 점 없이 소문자) */
const hostOf = (url: URL) =>
  url.hostname
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.$/, "")
    .toLowerCase();

/** 이 기기 주소인지(localhost, *.localhost, 127/8, ::1) */
function isLoopbackName(host: string) {
  return host === "localhost" || host.endsWith(".localhost") || kindOf(host) === "loopback";
}

function planBind({ envHost, url, container, certs }: { envHost: string | null; url: string; container: boolean; certs: boolean }): BindPlan {
  if (envHost) return { hosts: [envHost], all: envHost === "0.0.0.0" || envHost === "::", reason: "env" };
  if (container) return { hosts: ALL, all: true, reason: "container" };
  const parsed = new URL(url);
  if (isLoopbackName(hostOf(parsed))) return { hosts: LOOPBACK, all: false, reason: "loopback-url" };
  if (certs) return { hosts: ALL, all: true, reason: "certs" };
  if (parsed.protocol === "https:") return { hosts: LOOPBACK, all: false, reason: "https-url" };
  return { hosts: ALL, all: true, reason: "plain-url" };
}

const REASONS: Record<BindReason, string> = {
  env: "DASHBOARD_HOST",
  container: "컨테이너 안이라 모든 주소. 컨테이너 밖에 여는 범위는 -p가 정함. host 네트워크면 DASHBOARD_HOST를 넣으세요",
  "loopback-url": "이 기기 전용(공개 주소가 없거나 이 기기 주소)",
  certs: "인증서 파일이 있어 모든 주소에 직접 HTTPS",
  "https-url": "이 기기 전용(공개 주소가 https라 같은 기기의 프록시가 접속한다고 판단). 프록시가 다른 기기나 다른 컨테이너면 DASHBOARD_HOST를, 프록시 없이 직접 HTTPS로 열려면 certs/에 cert.pem과 key.pem을 넣으세요",
  "plain-url": "모든 주소(공개 주소가 http라 다른 기기에서 바로 접속한다고 판단)",
};

/** 기동 로그의 연 주소 한 줄. opened: 실제로 연 주소(0.0.0.0으로 바꿔 연 것 포함) */
function bindLine(plan: BindPlan, opened: string[], port: number, scheme: "http" | "https") {
  const shown = opened.map((h) => (h === "::" || h === "0.0.0.0" ? `모든 주소(${h}):${port}` : `${scheme}://${isIP(h) === 6 ? `[${h}]` : h}:${port}`));
  return `🌐 Dashboard: ${shown.join(", ")} (${REASONS[plan.reason]})`;
}

/** 다른 기기에서 접속할 수 있는 이 기기의 주소(loopback, 링크 로컬 제외) */
function reachableAddresses(read: typeof os.networkInterfaces = os.networkInterfaces) {
  const found: string[] = [];
  for (const list of Object.values(read())) {
    for (const a of list ?? []) {
      const ip = normalizeIp(a.address);
      const kind = ip ? kindOf(ip) : null;
      if (ip && !a.internal && kind !== "loopback" && kind !== "link-local" && !found.includes(ip)) found.push(ip);
    }
  }
  return found;
}

/** 공개 주소가 도메인이 아닌 IP인데 디스코드가 그 콜백을 받지 않거나 받지 않을 수 있을 때의 안내 */
function callbackNote(url: string): Note | null {
  const parsed = new URL(url);
  const kind = kindOf(hostOf(parsed));
  if (kind === "private" && parsed.protocol === "http:") return { level: "warn", text: `DASHBOARD_URL(${url})이 사설 IP의 http라 디스코드가 이 콜백을 받지 않아 로그인할 수 없음. 이 주소를 가리키는 도메인(공유기 DDNS, Tailscale의 MagicDNS 등)을 쓰세요` };
  if (kind === "private" || kind === "cgnat" || kind === "link-local") return { level: "warn", text: `DASHBOARD_URL(${url})이 사설 IP라 디스코드가 이 콜백을 받지 않을 수 있음. 로그인이 막히면 이 주소를 가리키는 도메인을 쓰세요` };
  return null;
}

/** 기동 진단(연 주소 한 줄 뒤). reachable: 다른 기기에서 접속할 수 있는 이 기기의 주소 */
function bindNotes(plan: BindPlan, { url, port, envHost, container, reachable, scheme = "http" }: { url: string; port: number; envHost: string | null; container: boolean; reachable: string[]; scheme?: "http" | "https" }): Note[] {
  const notes: Note[] = [];
  const https = url.startsWith("https:");
  const addresses = reachable.map((ip) => `${scheme}://${isIP(ip) === 6 ? `[${ip}]` : ip}:${port}`).join(", ");
  if (plan.reason === "loopback-url" && !container) notes.push({ level: "info", text: `다른 기기에서 쓰려면 .env의 DASHBOARD_URL에 그 기기에서 접속할 주소를 넣으세요. 디스코드는 사설 IP의 콜백을 받지 않아 이 기기를 가리키는 도메인(공유기 DDNS, Tailscale의 MagicDNS 등)이 필요함.${addresses ? ` 이 기기의 주소: ${addresses}` : ""}` });
  if (container) notes.push(...containerNotes(url));
  if (plan.all && plan.reason !== "container" && addresses) notes.push({ level: "info", text: `다른 기기에서 접속할 수 있는 주소: ${addresses}` });
  if (https && plan.reason === "env" && !envHostIsLoopback(envHost)) notes.push({ level: "info", text: "공개 주소가 https라 다른 기기에서 평문으로 바로 접속하면 로그인되지 않음(브라우저가 Secure 쿠키를 받지 않음)" });
  if (!https && plan.reason === "plain-url") notes.push({ level: "info", text: "도메인과 인증서가 있으면 HTTPS로 쓸 수 있음(docs/dashboard-network.md)" });
  const callback = callbackNote(url);
  if (callback) notes.push(callback);
  return notes;
}

const envHostIsLoopback = (envHost: string | null) => !envHost || isLoopbackName(envHost);

/** 컨테이너 안일 때의 안내: 공개 주소가 이 기기 주소면 컨테이너 밖 주소를 안내하고, 출발지 IP가 바뀌는 환경의 한계는 늘 알린다 */
function containerNotes(url: string): Note[] {
  const notes: Note[] = [];
  if (isLoopbackName(hostOf(new URL(url)))) notes.push({ level: "info", text: "컨테이너 밖에서 쓰려면 .env의 DASHBOARD_URL에 컨테이너 밖에서 접속할 주소를 넣으세요" });
  notes.push({ level: "info", text: "컨테이너 안. 출발지 IP가 바뀌는 환경(Docker Desktop, rootless Docker)에서는 인터넷 평문 접속을 감지하지 못함. 운영에는 리눅스 Docker의 bridge 네트워크를 권장" });
  return notes;
}

/** 연 범위를 비교할 형태: loopback, all, 그 밖은 주소 그대로 */
function scopeOf(plan: BindPlan) {
  if (plan.all) return "all";
  return plan.hosts.every(isLoopbackName) ? "loopback" : plan.hosts.join(",");
}

/** 이전 실행보다 넓게 열었으면 그 안내. previous: 이전 실행의 scopeOf(없으면 null) */
function widenedNote(previous: string | null, plan: BindPlan): Note | null {
  const now = scopeOf(plan);
  if (previous !== "loopback" || now === "loopback") return null;
  return { level: "warn", text: `이전 실행은 이 기기 전용이었는데 이번에는 더 넓게 열림(${now === "all" ? "모든 주소" : now}: ${REASONS[plan.reason]}). 의도한 것이 아니면 .env의 DASHBOARD_URL, DASHBOARD_HOST를 확인하세요` };
}

export { planBind, inContainer, bindLine, bindNotes, reachableAddresses, callbackNote, scopeOf, widenedNote, isLoopbackName };
export type { BindPlan, BindReason, Note };
