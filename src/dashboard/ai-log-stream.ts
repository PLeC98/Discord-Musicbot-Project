// AI 리퀘스트 로그의 실시간 연결(SSE, /api/admin/ai/logs/stream). 새 기록이 쓰이면(store/ai-requests 의 onRecorded) 열린 연결 모두에 보낸다.
// 줄마다 기록 id 를 달아, 브라우저가 다시 붙을 때(Last-Event-ID) · 화면이 다시 열 때(?after=) 그 뒤의 줄부터 보낸다(최근 RESUME_MAX 줄까지).
// 사용자당 연결 수는 플레이어 · 운영자 로그 스트림과 따로 센다(SSE_MAX_CONNECTIONS). 유휴 연결은 하트비트(SSE_HEARTBEAT_SEC)로 붙들어 둔다.

import type { Response } from "express";
import config from "../config/index.ts";
import * as requests from "../store/ai-requests.ts";
import type { AiLogEntry, AiLogPushed } from "./contract/ai-log.ts";

/** 다시 붙을 때 보내는 놓친 줄의 상한 */
const RESUME_MAX = 200;

/** 서버 이름을 붙인다(디스코드 캐시. 모르면 id 그대로) */
type Decorate = (entry: AiLogEntry) => AiLogEntry;

const clients = new Map<Response, string>();
let heartbeat: NodeJS.Timeout | null = null;
let heartbeatMs = 0;
let decorate: Decorate = (entry) => entry;
let offRecorded: (() => void) | null = null;

const frameOf = (pushed: AiLogPushed) => `id: ${pushed.entry.id}\ndata: ${JSON.stringify(pushed)}\n\n`;

function pushedOf(entry: AiLogEntry): AiLogPushed {
  const { count, bytes } = requests.size();
  return { entry: decorate(entry), total: count, storage: { count, bytes, maxBytes: config.aiLog.maxBytes, enabled: config.aiLog.enabled } };
}

function broadcast(entry: AiLogEntry) {
  if (!clients.size) return;
  const frame = frameOf(pushedOf(entry));
  for (const res of [...clients.keys()]) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}

/** 하트비트 간격이 바뀌었으면 다시 건다(운영 조절값을 저장하면 부른다). 연결이 없으면 걸지 않는다 */
function syncHeartbeat() {
  const ms = config.dashboard.sse.heartbeatMs;
  if (!clients.size) {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    return;
  }
  if (heartbeat && ms === heartbeatMs) return;
  if (heartbeat) clearInterval(heartbeat);
  heartbeatMs = ms;
  heartbeat = setInterval(() => {
    for (const res of [...clients.keys()]) {
      try {
        res.write(": ping\n\n");
      } catch {
        clients.delete(res);
      }
    }
  }, ms);
  heartbeat.unref?.();
}

/** 연결 하나를 연다. 사용자의 연결이 상한이면 false(열지 않는다). after: 마지막으로 받은 기록 id */
function addClient(res: Response, userKey: string, after: number): boolean {
  if ([...clients.values()].filter((key) => key === userKey).length >= config.dashboard.sse.maxPerUser) return false;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  if (after > 0) for (const entry of requests.since(after, RESUME_MAX)) res.write(frameOf(pushedOf(entry)));
  clients.set(res, userKey);
  syncHeartbeat();
  const drop = () => {
    clients.delete(res);
    syncHeartbeat();
  };
  res.on("close", drop);
  res.on("error", drop);
  return true;
}

/** 새 기록을 듣기 시작한다(대시보드를 열 때 한 번). withNames: 서버 이름을 붙이는 함수 */
function start(withNames: Decorate) {
  decorate = withNames;
  offRecorded ??= requests.onRecorded(broadcast);
}

/** 연결을 모두 닫고 듣기를 멈춘다(대시보드를 닫을 때 · 시험) */
function stop() {
  for (const res of clients.keys()) res.end();
  clients.clear();
  syncHeartbeat();
  offRecorded?.();
  offRecorded = null;
}

export { addClient, start, stop, syncHeartbeat, RESUME_MAX };
