// 대시보드의 스트림(SSE)을 그것을 연 로그인 세션에 묶고, 세션이 끝나면(로그아웃, 다른 기기 로그아웃, 만료, 절대 수명) 끊는다.
// 경로가 열 때 한 번 보는 것으로는 세션이 끝난 뒤에도 흐른다(훔친 쿠키로 연 실시간 로그 등).
//   열기 바로 앞(admit)  저장소에서 세션이 살아 있는지 본다. 실시간 로그, AI 로그는 열자마자 놓친 줄을 보내니 연 뒤에 보면 늦다.
//                        경로는 확인, 열기, 묶기 사이에 기다리지 않는다
//   연 뒤(track)        요청에서 세션을 뗀다. 응답이 끝날 때 express-session 이 그 요청이 읽은 낡은 세션을 저장하지 않게(끝낸 세션을 되살린다).
//                        머리를 보낼 때 express-session 이 세션을 읽어 쿠키를 붙이므로 머리를 보낸 뒤에 부른다
//   끊기                 저장소가 세션 끝을 알리면 곧바로, 알림이 없는 끝(날 SQL 로 지움 등)은 RECHECK_MS 마다 다시 보아.
//                        끝 이벤트를 쓰고 끝낸 뒤 소켓을 부순다(읽지 않는 클라이언트는 끝내도 닫히지 않는다. 그래서 SSE 는 Connection: close 로 연다)

import type { Request, Response } from "express";
import type { Socket } from "node:net";
import { SESSION_MAX_MS, tokenStoreOf, type SqliteSessionStore } from "./session-store.ts";
import { forgetGuilds } from "./user-guilds.ts";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
const log = logger.child({ category: "dashboard" });

/** 알림 없는 끝을 다시 보는 간격 */
const RECHECK_MS = 30_000;
/** 끝 이벤트를 쓰고 끝낸 뒤 소켓을 부수기까지(읽는 클라이언트는 그 안에 받고 닫는다) */
const CLOSE_GRACE_MS = 1000;
/** 쌓인 것이 이보다 많으면 끝 이벤트 없이 곧바로 부순다(읽지 않는 클라이언트) */
const LARGE_BACKLOG = 512 * 1024;
/** 다시 보기에서 저장소 읽기가 이만큼의 차례 잇달아 실패하면 그 차례에 확인하지 못한 스트림을 끊는다(망가진 DB 가 끝난 세션의 스트림을 살려 두지 않게. DB 오류는 스트림마다가 아니라 한꺼번에 온다) */
const FAILURES_TO_CLOSE = 3;

/** 끝을 알리는 SSE 이벤트. 화면이 받으면 닫고, 조금 뒤 로그인이 살아 있는지 확인한다(다시 로그인한 브라우저는 새 쿠키로 다시 연다) */
const ENDED_FRAME = "event: session-ended\ndata: {}\n\n";

type Tracked = { res: Response; socket: Socket | null; sid: string; userId: string; name: string; kind: string; deadline: number; store: SqliteSessionStore; drop: () => void };

const tracked = new Map<Response, Tracked>();
const heard = new WeakSet<SqliteSessionStore>();
let timer: NodeJS.Timeout | null = null;
let failures = 0;

/** 열기 바로 앞: 이 요청의 로그인 세션이 아직 살아 있나. 저장소가 세션을 다루지 않으면(시험의 메모리 저장소) 참. DB 오류는 던진다 */
function admit(req: Request): boolean {
  const store = tokenStoreOf(req);
  if (!store) return true;
  const user = req.session?.user;
  return !!user && store.liveSession(req.sessionID)?.user?.id === user.id;
}

/**
 * 연 스트림을 그 세션에 묶고 요청에서 세션을 뗀다. 머리를 보낸 뒤에 부른다. kind: 로그에 적을 스트림 이름,
 * drop: 그 스트림 모듈의 정리(끊을 때 곧바로 부른다. 닫힘을 기다리면 그사이 하트비트가 끝낸 응답에 쓴다)
 */
function track(req: Request, res: Response, kind: string, drop?: () => void) {
  const store = tokenStoreOf(req);
  const user = req.session?.user;
  if (!store || !user) return;
  const entry: Tracked = { res, socket: req.socket, sid: req.sessionID, userId: user.id, name: user.username || user.id, kind, deadline: (req.session.loginAt ?? 0) + SESSION_MAX_MS, store, drop: drop ?? (() => undefined) };
  // 이 요청이 고친 기기 기록(브라우저, 주소, 마지막 활동)을 떼기 전에 저장한다(떼면 응답이 끝날 때 저장하지 않는다). 방금 살아 있음을 보았다
  req.session.save(() => undefined);
  (req as { session: unknown }).session = null;
  tracked.set(res, entry);
  const untrack = () => {
    if (tracked.get(res) === entry) tracked.delete(res);
    if (!tracked.size) disarm();
  };
  res.once("close", untrack);
  res.once("error", untrack);
  if (!heard.has(store)) {
    heard.add(store);
    store.onEnded(onEnded);
  }
  arm();
}

// 저장소가 세션 끝을 알렸다
function onEnded(sid: string) {
  forgetGuilds(sid);
  for (const entry of [...tracked.values()]) if (entry.sid === sid) close(entry, "세션이 끝남");
}

// 끊는다. 묶음에서 곧바로 빼고 모듈 정리를 부른다
function close(entry: Tracked, why: string) {
  if (tracked.get(entry.res) !== entry) return;
  tracked.delete(entry.res);
  if (!tracked.size) disarm();
  const { res, socket } = entry;
  // 쌓인 양은 끝내기 앞에서 잰다(끝낸 뒤에는 0 이다)
  const large = res.writableLength > LARGE_BACKLOG;
  try {
    entry.drop();
  } catch (error) {
    log.debug(`스트림 정리 실패(${entry.kind}): ${messageOf(error)}`);
  }
  if (large || res.writableEnded || res.destroyed) {
    socket?.destroy();
  } else {
    res.write(ENDED_FRAME);
    res.end();
    // 끝낸 뒤에는 응답이 소켓에서 떨어져 응답을 부숴도 소켓은 남는다. 소켓을 직접 부순다
    setTimeout(() => socket?.destroy(), CLOSE_GRACE_MS).unref();
  }
  // 로그아웃, 다시 로그인마다 탭 수만큼 나온다. 끊은 일 자체(다른 기기 로그아웃 등)는 그 경로가 남긴다
  log.debug(`스트림을 끊었습니다(${why}): ${entry.kind} | ${entry.name}`);
}

/** 묶인 스트림의 세션을 다시 본다(RECHECK_MS 마다). 세션마다 저장소를 한 번 읽는다. 절대 기한은 저장소를 읽지 못해도 본다 */
function recheck(now = Date.now()) {
  const bySid = new Map<string, Tracked[]>();
  for (const entry of tracked.values()) bySid.set(entry.sid, [...(bySid.get(entry.sid) ?? []), entry]);
  const unchecked: Tracked[] = [];
  let firstError: unknown = null;
  for (const [sid, entries] of bySid) {
    const alive = entries.filter((entry) => {
      if (entry.deadline > now) return true;
      close(entry, "로그인 30일이 지남");
      return false;
    });
    if (!alive.length) continue;
    let session;
    try {
      session = alive[0].store.liveSession(sid);
    } catch (error) {
      firstError ??= error;
      unchecked.push(...alive);
      continue;
    }
    for (const entry of alive) if (session?.user?.id !== entry.userId) close(entry, "세션이 끝남");
  }
  if (!firstError) {
    failures = 0;
    return;
  }
  failures++;
  log.warn(`스트림의 로그인 세션을 확인하지 못했습니다(${failures}/${FAILURES_TO_CLOSE}): ${messageOf(firstError)}`);
  if (failures < FAILURES_TO_CLOSE) return;
  for (const entry of unchecked) close(entry, "세션을 확인하지 못함");
  failures = 0;
}

function arm() {
  if (timer) return;
  timer = setInterval(() => recheck(), RECHECK_MS);
  timer.unref();
}

function disarm() {
  if (timer) clearInterval(timer);
  timer = null;
  failures = 0;
}

/** 시험: 묶음을 비운다 */
function _reset() {
  tracked.clear();
  disarm();
}

export { admit, track, recheck, _reset, RECHECK_MS, ENDED_FRAME };
