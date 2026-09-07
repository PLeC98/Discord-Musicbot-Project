"use strict";

// 대시보드 바인딩 주소 → 기동 로그 문장.
//
// 로그는 실제 바인딩을 그대로 말해야 한다. 모든 인터페이스에 열어놓고 localhost라고 적으면
// 운영자가 자기 노출 상태를 알 방법이 없다.

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const WILDCARD = new Set(["0.0.0.0", "::"]);

function isLoopbackHost(host) {
  return LOOPBACK.has(String(host ?? ""));
}

/**
 * @returns {{line: string, warnings: string[]}} 기동 로그 한 줄과 경고 목록.
 *
 * 경고는 설정만으로 확정되는 조합에서만 낸다(외부 바인딩 + DASHBOARD_URL이 http://).
 * 실제 연결이 평문인지는 기동 시점에 알 수 없다 — 그건 요청 시점의 그물(index.js)이 맡는다.
 */
function describeBinding(host, port, dashboardUrl) {
  if (isLoopbackHost(host)) {
    return { line: `🌐 Dashboard: http://${host}:${port} (이 기기 전용 — 외부 접속은 DASHBOARD_HOST)`, warnings: [] };
  }

  const scope = WILDCARD.has(String(host ?? "")) ? "모든 인터페이스" : "외부 접속 허용";
  const warnings = [];
  if (String(dashboardUrl ?? "").startsWith("http://")) {
    warnings.push("⚠️  [dashboard] 평문 HTTP로 외부에 열려 있습니다 — HTTPS 프록시 뒤에 두세요.");
  }
  return { line: `🌐 Dashboard: ${host}:${port} (${scope})`, warnings };
}

module.exports = { isLoopbackHost, describeBinding };
