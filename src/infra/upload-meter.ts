// 봇이 내보낸 양의 누계(바이트): 음성 패킷 · 대시보드 응답. 봇 상태 탭이 구간마다 차이로 속도를 낸다.
// 음성은 voice 내부를 읽지 않고 재생 출력이 내준 Opus 패킷마다 더한다(플레이어 하나에 연결 하나이고, voice 는 연결이 준비됐을 때만 읽는다).
// 패킷 크기에 RTP 머리(12) · 암호화 태그(16) · nonce(4) · UDP(8) · IPv4(20)를 더한 추정이다. 무음 프레임 · keep-alive · DAVE 의 덧붙임은 빠진다.
// 대시보드는 HTTP 연결의 bytesWritten(HTTP 머리 포함, TCP · IP 머리는 빠진다). 같은 기계(루프백)에서 연 연결은 기계 밖으로 나가지 않아 세지 않는다

import type { Socket } from "node:net";

const VOICE_PACKET_OVERHEAD = 12 + 16 + 4 + 8 + 20;

let voiceBytes = 0;
let dashboardClosed = 0;
const sockets = new Set<Socket>();

const isLoopback = (address = "") => address === "::1" || /^(::ffff:)?127\./.test(address);

/** 재생 출력이 패킷 하나를 voice 에 내줬다 */
function addVoicePacket(bytes: number) {
  voiceBytes += bytes + VOICE_PACKET_OVERHEAD;
}

/** 대시보드 HTTP 서버의 연결을 센다. 오래 열린 연결(실시간 연결)도 구간마다 쓴 만큼 들어간다 */
function countServer(server: { on(event: "connection", listener: (socket: Socket) => void): unknown }) {
  server.on("connection", (socket) => {
    if (isLoopback(socket.remoteAddress)) return;
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      dashboardClosed += socket.bytesWritten;
    });
  });
}

/** 켜진 뒤 보낸 누계 */
function uploadTotals() {
  let dashboard = dashboardClosed;
  for (const socket of sockets) dashboard += socket.bytesWritten;
  return { voice: voiceBytes, dashboard };
}

export { addVoicePacket, countServer, uploadTotals, isLoopback, VOICE_PACKET_OVERHEAD };
