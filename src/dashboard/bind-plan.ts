// 대시보드를 열 주소와 기동 진단. 먼저 맞는 것으로 연다:
// 1. DASHBOARD_HOST  2. 컨테이너 안이면 모든 주소  3. 공개 주소가 없거나 이 기기 주소면 127.0.0.1과 ::1
// 4. 인증서 파일이 있으면 모든 주소(봇이 직접 TLS를 처리하므로 앞에 프록시가 없다고 본다)
// 5. 공개 주소가 https면 127.0.0.1과 ::1(앞의 프록시가 같은 기기에 있다고 본다)  6. 그 밖(http, 이 기기 주소 아님)은 모든 주소.
// 환경 판별은 추정이므로 기동 로그에 선택한 주소와 이유, 접속할 수 있는 주소를 늘 보인다

import fs from "node:fs";
import os from "node:os";
import { isIP } from "node:net";
import { hostOf, isLoopbackName, kindOf, normalizeIp } from "../rules/net-address.ts";
import { L } from "../infra/log/text.ts";
import { asText, type LogText } from "../infra/log/log-text.ts";

type BindReason = "env" | "container" | "loopback-url" | "certs" | "https-url" | "plain-url";
/** hosts: 열 주소(::는 열지 못하면 0.0.0.0으로), all: 모든 주소인지 */
type BindPlan = { hosts: string[]; all: boolean; reason: BindReason };
type Note = { level: "info" | "warn"; text: LogText };

const LOOPBACK = ["127.0.0.1", "::1"];
const ALL = ["::"];

/** 컨테이너 안인지(Docker, Podman, Kubernetes). 추정이다 */
function inContainer(exists: (file: string) => boolean = fs.existsSync, env: NodeJS.ProcessEnv = process.env) {
  return exists("/.dockerenv") || exists("/run/.containerenv") || Boolean(env.KUBERNETES_SERVICE_HOST);
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

// 그 주소로 연 이유만. 판단이 틀렸을 때 고칠 곳은 docs/dashboard-network.md
const REASONS: Record<BindReason, string | LogText> = {
  env: "DASHBOARD_HOST",
  container: L.dashboard.bindReasonContainer(),
  "loopback-url": L.dashboard.bindReasonLoopbackUrl(),
  certs: L.dashboard.bindReasonCerts(),
  "https-url": L.dashboard.bindReasonHttpsUrl(),
  "plain-url": L.dashboard.bindReasonPlainUrl(),
};

/** 기동 로그의 연 주소 한 줄. opened: 실제로 연 주소(0.0.0.0으로 바꿔 연 것 포함). 범위는 주소가 보여 준다 */
function bindLine(plan: BindPlan, opened: string[], port: number, scheme: "http" | "https") {
  const shown = opened.map((h) => (h === "::" || h === "0.0.0.0" ? L.dashboard.bindAllAddresses({ host: h, port }) : `${scheme}://${isIP(h) === 6 ? `[${h}]` : h}:${port}`));
  return L.dashboard.bindLine({ addresses: shown.map(asText).join(", "), reason: REASONS[plan.reason] });
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

/** 기동 진단(연 주소 한 줄 뒤). reachable: 다른 기기에서 접속할 수 있는 이 기기의 주소 */
function bindNotes(plan: BindPlan, { url, port, envHost, container, reachable, scheme = "http" }: { url: string; port: number; envHost: string | null; container: boolean; reachable: string[]; scheme?: "http" | "https" }): Note[] {
  const notes: Note[] = [];
  const https = url.startsWith("https:");
  const addresses = reachable.map((ip) => `${scheme}://${isIP(ip) === 6 ? `[${ip}]` : ip}:${port}`).join(", ");
  if (plan.reason === "loopback-url" && !container) notes.push({ level: "info", text: L.dashboard.bindOtherDeviceHint({ addresses }) });
  if (container) notes.push(...containerNotes(url));
  if (plan.all && plan.reason !== "container" && addresses) notes.push({ level: "info", text: L.dashboard.bindReachableAddresses({ addresses }) });
  if (https && plan.reason === "env" && !envHostIsLoopback(envHost)) notes.push({ level: "info", text: L.dashboard.bindHttpsPlainNoLogin() });
  if (!https && plan.reason === "plain-url") notes.push({ level: "info", text: L.dashboard.bindHttpsPossible() });
  return notes;
}

const envHostIsLoopback = (envHost: string | null) => !envHost || isLoopbackName(envHost);

/** 컨테이너 안일 때의 안내: 공개 주소가 이 기기 주소면 컨테이너 밖 주소를 안내하고, 출발지 IP가 바뀌는 환경의 한계는 늘 알린다 */
function containerNotes(url: string): Note[] {
  const notes: Note[] = [];
  if (isLoopbackName(hostOf(new URL(url)))) notes.push({ level: "info", text: L.dashboard.bindContainerUrlHint() });
  notes.push({ level: "info", text: L.dashboard.bindContainerLimits() });
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
  return { level: "warn", text: L.dashboard.bindWidened({ scope: now, reason: REASONS[plan.reason] }) };
}

export { planBind, inContainer, bindLine, bindNotes, reachableAddresses, scopeOf, widenedNote };
export type { BindPlan, BindReason, Note };
