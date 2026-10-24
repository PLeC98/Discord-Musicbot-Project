// 대시보드 바인딩 주소 → 기동 로그 문장. 대시보드를 열고 그 결과를 남긴다.
//
// 로그는 실제 바인딩을 그대로 말해야 한다. 모든 인터페이스에 열어놓고 localhost라고 적으면
// 운영자가 자기 노출 상태를 알 방법이 없다.

import type { Express } from "express";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import { describeError, messageOf } from "../rules/error-kind.ts";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const WILDCARD = new Set(["0.0.0.0", "::"]);

function isLoopbackHost(host: string | null | undefined) {
  return LOOPBACK.has(String(host ?? ""));
}

/**
 * @returns {{line: string, warnings: string[]}} 기동 로그 한 줄과 경고 목록.
 *
 * 경고는 설정만으로 확정되는 조합에서만 낸다(외부 바인딩 + DASHBOARD_URL이 http://).
 * 실제 연결이 평문인지는 기동 시점에 알 수 없다. 그건 요청 시점의 안전망(index.ts)이 맡는다.
 */
function describeBinding(host: string | null | undefined, port: number, dashboardUrl: string | null | undefined) {
  if (isLoopbackHost(host)) {
    return { line: `🌐 Dashboard: http://${host ?? "없음"}:${port} (이 기기 전용. 외부 접속은 DASHBOARD_HOST)`, warnings: [] };
  }

  const scope = WILDCARD.has(String(host ?? "")) ? "모든 인터페이스" : "외부 접속 허용";
  const warnings: string[] = [];
  if (String(dashboardUrl ?? "").startsWith("http://")) {
    warnings.push("⚠️ [dashboard] 평문 HTTP로 외부에 열려 있습니다. HTTPS 프록시 뒤에 두세요.");
  }
  return { line: `🌐 Dashboard: ${host ?? "없음"}:${port} (${scope})`, warnings };
}

// 요청을 읽지 못했을 때 답하는 상태. 들으면 Node 의 기본 처리가 꺼지므로 그 처리(_http_server 의 socketOnError)를 그대로 한다
const CLIENT_ERROR_STATUS: Record<string, string> = { HPE_HEADER_OVERFLOW: "431 Request Header Fields Too Large", HPE_CHUNK_EXTENSIONS_OVERFLOW: "413 Payload Too Large", ERR_HTTP_REQUEST_TIMEOUT: "408 Request Timeout" };

function onClientError(error: Error & { code?: string }, duplex: Duplex) {
  const socket = duplex as Socket & { _httpMessage?: { _headerSent?: boolean } | null };
  // 받는 도중 브라우저가 끊는 것은 흔하다
  if (error.code !== "ECONNRESET") log.trace(`대시보드 요청을 읽지 못했습니다(${socket.remoteAddress ?? "주소 모름"}): ${describeError(error)}`);
  // 나가던 응답의 헤더가 이미 소켓에 나갔으면 오류 응답을 끼워 쓰지 않는다
  if (socket.writable && !socket._httpMessage?._headerSent) socket.write(`HTTP/1.1 ${CLIENT_ERROR_STATUS[error.code ?? ""] ?? "400 Bad Request"}\r\nConnection: close\r\n\r\n`);
  socket.destroy(error);
}

/** 대시보드를 연다. 연 주소나 못 연 까닭을 남기고, 열었으면 opened 를 부른다. 못 열면 봇은 대시보드 없이 돈다 */
function listen(app: Pick<Express, "listen">, { host, port, url }: { host: string; port: number; url: string }, opened?: () => void): Server {
  const { line, warnings } = describeBinding(host, port, url);
  const server = app.listen(port, host, (error?: Error) => {
    if (error) return log.error(`대시보드를 열지 못했습니다. 봇은 대시보드 없이 돕니다: ${messageOf(error)}`);
    log.info(line);
    for (const w of warnings) log.warn(w);
    opened?.();
  });
  server.on("clientError", onClientError);
  return server;
}

export { isLoopbackHost, describeBinding, listen };
