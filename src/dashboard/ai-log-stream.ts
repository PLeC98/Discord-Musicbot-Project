// AI 리퀘스트 로그의 SSE 연결(/api/admin/ai/logs/stream). 새 기록이 쓰이면(store/ai-requests 의 onRecorded) 열린 연결 모두에 보낸다.
// 줄마다 기록 id 를 달아, 브라우저가 재연결할 때(Last-Event-ID), 화면이 다시 열 때(?after=) 그 뒤의 줄부터 보낸다(최근 RESUME_MAX 줄까지).
// 사용자당 연결 수는 플레이어, 운영자 로그 스트림과 따로 센다(SSE_MAX_CONNECTIONS). 유휴 연결은 하트비트(SSE_HEARTBEAT_SEC)로 붙들어 둔다.

import type { Response } from "express";
import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
import * as requests from "../store/ai-requests.ts";
import type { AiLogEntry, AiLogPushed } from "./contract/ai-log.ts";
const log = logger.child({ category: "dashboard" });

/** 재연결할 때 보내는 놓친 줄의 상한(줄 수, 바이트). 줄 요약의 글은 길이가 고르지 않다. 넘긴 줄은 화면이 목록을 다시 읽을 때 본다 */
const RESUME_MAX = 200;
const RESUME_MAX_BYTES = 512 * 1024;
/** 보내지 못하고 쌓인 양이 이만큼을 넘으면 읽지 않는 소비자로 보고 끊는다(실시간 로그와 같다) */
const MAX_PENDING_BYTES = 1024 * 1024;

/** 서버 이름을 붙인다(디스코드 캐시. 모르면 id 그대로) */
type Decorate = (entry: AiLogEntry) => AiLogEntry;

const clients = new Map<Response, string>();
let heartbeat: NodeJS.Timeout | null = null;
let heartbeatMs = 0;
let decorate: Decorate = (entry) => entry;
let offRecorded: (() => void) | null = null;

/** 다시 붙을 때 놓친 줄을 다 보내지 못했다 */
const GAP_FRAME = "event: gap\ndata: {}\n\n";
const frameOf = (pushed: AiLogPushed) => `id: ${pushed.entry.id}\ndata: ${JSON.stringify(pushed)}\n\n`;

function pushedOf(entry: AiLogEntry): AiLogPushed {
  const { count, bytes } = requests.size();
  return { entry: decorate(entry), total: count, storage: { count, bytes, maxBytes: config.aiLog.maxBytes, enabled: config.aiLog.enabled } };
}

// 쓴다. 쌓인 양이 상한을 넘었으면 쓰지 않고 끊는다(끝내기로는 읽지 않는 소켓이 남아 부순다. 브라우저가 Last-Event-ID 로 이어 받는다)
function send(res: Response, frame: string, what: string) {
  try {
    if (res.writableLength > MAX_PENDING_BYTES) {
      drop(res);
      res.destroy();
      return;
    }
    res.write(frame);
  } catch (error) {
    log.trace(`AI 리퀘스트 로그 SSE ${what} 실패: ${messageOf(error)}`);
    drop(res);
  }
}

function broadcast(entry: AiLogEntry) {
  if (!clients.size) return;
  const frame = frameOf(pushedOf(entry));
  for (const res of [...clients.keys()]) send(res, frame, "쓰기");
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
    for (const res of [...clients.keys()]) send(res, ": ping\n\n", "하트비트 쓰기");
  }, ms);
  heartbeat.unref?.();
}

/** 연결 하나를 연다. 사용자의 연결이 상한이면 false(열지 않는다). after: 마지막으로 받은 기록 id */
function addClient(res: Response, userKey: string, after: number): boolean {
  if ([...clients.values()].filter((key) => key === userKey).length >= config.dashboard.sse.maxPerUser) return false;
  // 끊을 때 이 연결의 소켓을 부수므로 다시 쓰지 않게(Connection: close)
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "close", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  if (after > 0) {
    let bytes = 0;
    for (const entry of requests.since(after, RESUME_MAX)) {
      const frame = frameOf(pushedOf(entry));
      bytes += Buffer.byteLength(frame);
      if (bytes > RESUME_MAX_BYTES) {
        // 못 보낸 줄이 있다. 다음 새 줄이 이어 받을 자리를 앞으로 옮기므로 화면이 목록을 다시 읽게 알린다
        res.write(GAP_FRAME);
        break;
      }
      res.write(frame);
    }
  }
  clients.set(res, userKey);
  syncHeartbeat();
  res.on("close", () => drop(res));
  res.on("error", (error: unknown) => {
    log.debug(`AI 리퀘스트 로그 SSE 연결 오류: ${messageOf(error)}`);
    drop(res);
  });
  return true;
}

/** 연결 하나를 뺀다(닫힘, 오류, 쓰기 실패, 세션이 끝나 끊을 때). 닫힘을 기다리지 않는다 */
function drop(res: Response) {
  if (!clients.delete(res)) return;
  syncHeartbeat();
}

/** 새 기록을 듣기 시작한다(대시보드를 열 때 한 번). withNames: 서버 이름을 붙이는 함수 */
function start(withNames: Decorate) {
  decorate = withNames;
  offRecorded ??= requests.onRecorded(broadcast);
}

/** 연결을 모두 닫고 듣기를 멈춘다(대시보드를 닫을 때, 테스트) */
function stop() {
  for (const res of clients.keys()) res.end();
  clients.clear();
  syncHeartbeat();
  offRecorded?.();
  offRecorded = null;
}

export { addClient, drop, start, stop, syncHeartbeat, RESUME_MAX, RESUME_MAX_BYTES, MAX_PENDING_BYTES };
