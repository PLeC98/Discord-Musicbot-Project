// 대시보드를 연다. 열 주소마다 HTTP 서버 하나(같은 앱). 연 주소나 못 연 까닭을 남긴다.
// ::(모든 주소)를 열지 못하면(IPv6가 꺼진 기기) 0.0.0.0으로, ::1을 열지 못하면 그 주소만 빼고 연다. 포트가 겹치면 아무것도 열지 않는다

import http, { type Server } from "node:http";
import https from "node:https";
import type { TlsOptions } from "node:tls";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { RequestListener } from "node:http";
import logger from "../infra/log/logger.ts";
import { describeError, messageOf } from "../rules/error-kind.ts";

const log = logger.child({ category: "dashboard" });

// 요청을 읽지 못했을 때 답하는 상태. 들으면 Node 의 기본 처리가 꺼지므로 그 처리(_http_server 의 socketOnError)를 그대로 한다
const CLIENT_ERROR_STATUS: Record<string, string> = { HPE_HEADER_OVERFLOW: "431 Request Header Fields Too Large", HPE_CHUNK_EXTENSIONS_OVERFLOW: "413 Payload Too Large", ERR_HTTP_REQUEST_TIMEOUT: "408 Request Timeout" };

function onClientError(error: Error & { code?: string }, duplex: Duplex) {
  const socket = duplex as Socket & { _httpMessage?: { _headerSent?: boolean } | null };
  // 받는 도중 브라우저가 끊는 것(ECONNRESET)은 흔해 남기지 않는다
  if (error.code !== "ECONNRESET") log.trace(`대시보드 요청을 읽지 못했습니다(${socket.remoteAddress ?? "주소 모름"}): ${describeError(error)}`);
  // 나가던 응답의 헤더가 이미 소켓에 나갔으면 오류 응답을 끼워 쓰지 않는다
  if (socket.writable && !socket._httpMessage?._headerSent) socket.write(`HTTP/1.1 ${CLIENT_ERROR_STATUS[error.code ?? ""] ?? "400 Bad Request"}\r\nConnection: close\r\n\r\n`);
  socket.destroy(error);
}

/** 서버 하나를 만든다(요청을 읽지 못한 연결의 오류 응답, 100-continue를 앱으로 전달). tls가 있으면 HTTPS 서버(dashboard/tls-files) */
function createServer(app: RequestListener, tls?: TlsOptions): Server {
  const server: Server = tls ? https.createServer(tls, app) : http.createServer(app);
  server.on("clientError", onClientError);
  // 100-continue에 Node가 먼저 응답하지 않게 가로채 앱으로 넘긴다. 앱이 검사를 모두 통과한 뒤에 100을 보낸다(body-limit의 continueBody)
  server.on("checkContinue", (req, res) => server.emit("request", req, res));
  return server;
}

/** 서버를 그 주소, 포트에 연다. 못 열면 그 오류로 실패한다 */
function openOn(server: Server, host: string, port: number) {
  return new Promise<void>((done, fail) => {
    const onError = (error: Error) => fail(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      // 연 뒤의 서버 오류. 리스너가 없으면 프로세스가 죽는다
      server.on("error", (error) => log.error(`대시보드 서버 오류(${host}:${port}): ${messageOf(error)}`));
      done();
    });
  });
}

const codeOf = (error: unknown) => (error as { code?: string }).code;
/** 이 기기에서 그 주소족을 쓸 수 없다는 오류(IPv6가 꺼진 기기) */
const familyMissing = (error: unknown) => codeOf(error) === "EAFNOSUPPORT" || codeOf(error) === "EADDRNOTAVAIL";

type Opened = { servers: Server[]; hosts: string[] };

/**
 * 열 주소마다 서버를 연다. 연 서버와 실제로 연 주소. 하나도 못 열었거나 포트가 겹치면 연 것을 닫고 servers는 비어 있다(까닭은 error 로그).
 * makeServer: 서버를 만드는 함수(인증서 파일이 있으면 HTTPS 서버)
 */
async function listenAll(makeServer: () => Server, hosts: string[], port: number): Promise<Opened> {
  const opened: Opened = { servers: [], hosts: [] };
  const close = () => {
    for (const s of opened.servers) s.close();
    opened.servers = [];
    opened.hosts = [];
  };
  for (const host of hosts) {
    try {
      const server = makeServer();
      await openOn(server, host, port);
      opened.servers.push(server);
      opened.hosts.push(host);
      continue;
    } catch (first) {
      let error = first;
      if (codeOf(error) === "EADDRINUSE") {
        close();
        log.error(`대시보드 포트(${port})를 다른 프로그램이 쓰고 있어 대시보드를 열지 못했습니다(대시보드 없이 계속 실행). .env의 DASHBOARD_PORT를 바꾸세요.`);
        return opened;
      }
      if (host === "::" && familyMissing(error)) {
        try {
          const fallback = makeServer();
          await openOn(fallback, "0.0.0.0", port);
          opened.servers.push(fallback);
          opened.hosts.push("0.0.0.0");
          log.info("IPv6를 쓸 수 없어 0.0.0.0(IPv4의 모든 주소)으로 열었습니다.");
          continue;
        } catch (fallbackError) {
          error = fallbackError;
        }
      }
      if (host === "::1" && familyMissing(error) && opened.servers.length) {
        log.info("IPv6를 쓸 수 없어 ::1은 열지 않았습니다(127.0.0.1만).");
        continue;
      }
      close();
      log.error(`대시보드 서버 실행 실패(대시보드 없이 계속 실행): ${host}:${port}, ${messageOf(error)}`);
      return opened;
    }
  }
  return opened;
}

export { createServer, listenAll };
