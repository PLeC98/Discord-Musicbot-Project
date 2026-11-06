// 로그인한 요청을 그 로그인 세션에 묶고, 세션이 끝나면(로그아웃, 다른 기기 로그아웃, 만료, 절대 수명, 다시 로그인) 그 세션으로 진행 중인 요청을 멈춘다.
// 경로가 받아들일 때 한 번 보는 것으로는 세션이 끝난 뒤에도 요청이 끝까지 간다(훔친 쿠키로 걸어 둔 불러오기, 내려받기, 열어 둔 실시간 로그).
//   묶기(bind)            세션 미들웨어 뒤에서 로그인한 요청을 응답마다 묶는다. 끝 표시는 요청에 둔다(묶음에서 빠져도 핸들러가 아직 돌면 끝난 것으로 본다)
//   응답 감싸기           끝난 요청이거나 사용자가 없는 세션이면 응답을 쓰기 직전에 요청에서 세션을 뗀다: express-session 이 저장하지도 쿠키를 싣지도 않는다
//                        (끝낸 세션을 되살리지 않고, 다시 로그인한 브라우저의 새 쿠키를 옛 쿠키로 덮지 않는다). 끝난 GET 은 답 대신 401
//   끊기                 저장소가 세션 끝을 알리면 곧바로, 알림이 없는 끝(날 SQL 로 지움 등)은 RECHECK_MS 마다 다시 보아.
//                        스트림(SSE)은 끝 이벤트를 쓰고 끝낸 뒤 소켓을 부순다(읽지 않는 클라이언트는 끝내도 닫히지 않는다. 그래서 SSE 는 Connection: close 로 연다).
//                        흘려 보내는 응답, 받는 중인 본문은 소켓을 부순다. 상태를 바꾸는 요청은 바꾸는 자리 바로 앞의 확인(assertSignedIn)이 401 로 멈춘다
//   스트림 열기 앞(admit)  저장소에서 세션이 살아 있는지 본다. 실시간 로그, AI 로그는 열자마자 놓친 줄을 보내니 연 뒤에 보면 늦다

import type { NextFunction, Request, Response } from "express";
import type { Socket } from "node:net";
import { SESSION_MAX_MS, tokenStoreOf, type SqliteSessionStore } from "./session-store.ts";
import { forgetGuilds } from "./user-guilds.ts";
import { problemBody } from "./contract/problem.ts";
import logger from "../infra/log/logger.ts";
import { messageOf } from "../rules/error-kind.ts";
const log = logger.child({ category: "dashboard" });

/** 알림 없는 끝을 다시 보는 간격 */
const RECHECK_MS = 30_000;
/** 끝 이벤트를 쓰고 끝낸 뒤 소켓을 부수기까지(읽는 클라이언트는 그 안에 받고 닫는다) */
const CLOSE_GRACE_MS = 1000;
/** 쌓인 것이 이보다 많으면 끝 이벤트 없이 곧바로 부순다(읽지 않는 클라이언트) */
const LARGE_BACKLOG = 512 * 1024;
/** 다시 보기에서 저장소 읽기가 이만큼의 차례 잇달아 실패하면 그 차례에 확인하지 못한 요청을 끊는다(망가진 DB 가 끝난 세션의 스트림을 살려 두지 않게. DB 오류는 요청마다가 아니라 한꺼번에 온다) */
const FAILURES_TO_CLOSE = 3;

/** 끝을 알리는 SSE 이벤트. 화면이 받으면 닫고, 조금 뒤 로그인이 살아 있는지 확인한다(다시 로그인한 브라우저는 새 쿠키로 다시 연다) */
const ENDED_FRAME = "event: session-ended\ndata: {}\n\n";

// 끝난 GET 의 답을 401 로 바꿀 때 지우는 머리(원래 답의 표현을 싣지 않는다)
const REPRESENTATION = ["Content-Length", "Content-Type", "ETag", "Last-Modified", "Location", "Content-Disposition", "Content-Encoding", "Content-Range", "Accept-Ranges"];
const SAFE = new Set(["GET", "HEAD"]);

/** 바꾸는 자리 앞의 확인(assertSignedIn)이 던진다. 경로의 catch 는 sessionEnded 로 먼저 받는다 */
class SessionEndedError extends Error {
  constructor() {
    super("로그인 세션이 끝났다");
    this.name = "SessionEndedError";
  }
}

/** 묶인 요청. stream: 스트림이면 그 이름(로그), drop: 그 스트림 모듈의 정리 */
type Entry = { req: Request; res: Response; socket: Socket; sid: string; userId: string; name: string; deadline: number; store: SqliteSessionStore; stream: string | null; drop: () => void };

/** 진행 중인 묶인 요청(응답이 닫히면 빠진다) */
const entries = new Map<Response, Entry>();
const entryOf = new WeakMap<Request, Entry>();
/** 끝난 요청(세션이 끝났다) */
const ended = new WeakSet<Request>();
/** 스스로 세션을 끝내는 요청(로그아웃, 다시 로그인). 끝 알림에 멈추지 않는다 */
const released = new WeakSet<Request>();
/** 소켓의 마지막 요청(모든 요청에서 적는다. keep-alive 의 다음 요청을 건드리지 않게) */
const lastOf = new WeakMap<Socket, Request>();
/** sid → 그 세션의 요청이 쓴 소켓들(소켓이 닫히면 뺀다). 한 번에 쓰고 끝낸 큰 답은 응답이 끝나 묶음에서 빠진 뒤에도 바이트가 소켓에 남는다 */
const socketsOf = new Map<string, Set<Socket>>();
const sidsOf = new WeakMap<Socket, Set<string>>();
const heard = new WeakSet<SqliteSessionStore>();
let timer: NodeJS.Timeout | null = null;
let failures = 0;

/** 모든 요청의 맨 앞(정적 파일보다 앞): 소켓의 마지막 요청을 적는다 */
function noteSocket(req: Request, _res: Response, next: NextFunction) {
  lastOf.set(req.socket, req);
  next();
}

/** 세션 미들웨어 뒤: 로그인한 요청을 묶고 응답을 감싼다. 저장소가 세션을 다루지 않으면(시험의 메모리 저장소, 가짜 세션) 그대로 지나간다 */
function bind(req: Request, res: Response, next: NextFunction) {
  const store = tokenStoreOf(req);
  if (!store || !req.session) return next();
  lastOf.set(req.socket, req);
  wrap(req, res);
  const user = req.session.user;
  if (user) {
    const expires = req.session.cookie?.expires ? new Date(req.session.cookie.expires).getTime() : Infinity;
    const entry: Entry = { req, res, socket: req.socket, sid: req.sessionID, userId: user.id, name: user.username || user.id, deadline: Math.min((req.session.loginAt ?? 0) + SESSION_MAX_MS, expires), store, stream: null, drop: () => undefined };
    entries.set(res, entry);
    entryOf.set(req, entry);
    useSocket(entry.sid, req.socket);
    res.once("close", () => {
      if (entries.get(res) === entry) entries.delete(res);
      if (!entries.size) disarm();
    });
    hear(store);
    arm();
  }
  next();
}

// 그 세션이 이 소켓을 썼다. 소켓이 닫히면 잊는다
function useSocket(sid: string, socket: Socket) {
  let sockets = socketsOf.get(sid);
  if (!sockets) socketsOf.set(sid, (sockets = new Set()));
  sockets.add(socket);
  let sids = sidsOf.get(socket);
  if (!sids) {
    sidsOf.set(socket, (sids = new Set()));
    socket.once("close", () => {
      for (const one of sidsOf.get(socket) ?? []) {
        const set = socketsOf.get(one);
        set?.delete(socket);
        if (set && !set.size) socketsOf.delete(one);
      }
    });
  }
  sids.add(sid);
}

function hear(store: SqliteSessionStore) {
  if (heard.has(store)) return;
  heard.add(store);
  store.onEnded(onEnded);
}

// express-session 과 on-headers 보다 나중에 감싸 바깥이라 먼저 돈다. writeHead 만 감싸서는 저장이 막히지 않는다(express-session 은 머리 전에 저장한다)
function wrap(req: Request, res: Response) {
  const end = res.end;
  const writeHead = res.writeHead;
  let replacing = false;
  const detach = () => {
    const session = req.session as Request["session"] | null | undefined;
    if (session && (ended.has(req) || !session.user)) (req as { session: unknown }).session = null;
  };
  // 끝난 GET 이 흘려 보내기로 머리를 쓰려 한다(sendFile, 파이프): 바꿀 수 없으니 부순다
  res.writeHead = function (this: Response, ...args: unknown[]) {
    detach();
    if (!replacing && ended.has(req) && SAFE.has(req.method) && !released.has(req)) {
      req.socket.destroy();
      return this;
    }
    return (writeHead as (...a: unknown[]) => Response).apply(this, args);
  } as Response["writeHead"];
  res.end = function (this: Response, ...args: unknown[]) {
    detach();
    if (!replacing && !this.headersSent && ended.has(req) && SAFE.has(req.method) && !released.has(req)) {
      replacing = true;
      for (const name of REPRESENTATION) this.removeHeader(name);
      const body = JSON.stringify(problemBody("login-required"));
      this.statusCode = 401;
      this.setHeader("Content-Type", "application/problem+json; charset=utf-8");
      this.setHeader("Cache-Control", "no-store");
      this.setHeader("Content-Length", Buffer.byteLength(body));
      const done = args.find((one) => typeof one === "function");
      return (end as (...a: unknown[]) => Response).call(this, req.method === "HEAD" ? undefined : body, "utf8", done);
    }
    return (end as (...a: unknown[]) => Response).apply(this, args);
  } as Response["end"];
}

/** 스스로 이 요청의 세션을 끝낸다(로그아웃, 다시 로그인): 끝 알림에 멈추지 않는다 */
function release(req: Request) {
  released.add(req);
}

/** 바꾸는 자리 바로 앞: 이 요청의 세션이 아직 살아 있나. 끝났으면 SessionEndedError. 저장소를 읽지 않는다(메모리의 끝 표시와 기한) */
function assertSignedIn(req: Request) {
  if (!tokenStoreOf(req)) return;
  const entry = entryOf.get(req);
  if (!entry) {
    // 저장소가 있는데 묶이지 않은 로그인 요청: 묶기 미들웨어를 빠뜨렸다
    if (req.session?.user) throw new Error("로그인한 요청이 세션 묶기(session-requests 의 bind)를 지나지 않았다");
    return;
  }
  if (ended.has(req) || entry.deadline <= Date.now()) throw new SessionEndedError();
}

/** 경로의 catch 맨 앞: 세션이 끝나 멈춘 것이면 401 로 답하고(머리 전이면) true */
function sessionEnded(res: Response, error: unknown): boolean {
  if (!(error instanceof SessionEndedError)) return false;
  if (!res.headersSent && !res.destroyed) res.status(401).type("application/problem+json").json(problemBody("login-required"));
  return true;
}

/** 세션이 끝나 멈춘 요청인가(그 요청의 끊김 로그를 낮춘다) */
function isEnded(req: Request) {
  return ended.has(req);
}

/** 스트림 열기 바로 앞: 이 요청의 로그인 세션이 아직 살아 있나. 저장소가 세션을 다루지 않으면(시험의 메모리 저장소) 참. DB 오류는 던진다 */
function admit(req: Request): boolean {
  const store = tokenStoreOf(req);
  if (!store) return true;
  const user = req.session?.user;
  return !!user && !ended.has(req) && store.liveSession(req.sessionID)?.user?.id === user.id;
}

/**
 * 연 스트림을 그 요청의 묶음에 스트림으로 적고 요청에서 세션을 뗀다. 머리를 보낸 뒤에 부른다. kind: 로그에 적을 스트림 이름,
 * drop: 그 스트림 모듈의 정리(끊을 때 곧바로 부른다. 닫힘을 기다리면 그사이 하트비트가 끝낸 응답에 쓴다)
 */
function track(req: Request, res: Response, kind: string, drop?: () => void) {
  const store = tokenStoreOf(req);
  if (!store || !req.session?.user) return;
  const entry = entryOf.get(req);
  if (!entry) throw new Error("스트림을 연 요청이 세션 묶기(session-requests 의 bind)를 지나지 않았다");
  entry.stream = kind;
  entry.drop = drop ?? (() => undefined);
  keepDevice(store, req);
  (req as { session: unknown }).session = null;
  res.once("error", () => {
    if (entries.get(res) === entry) entries.delete(res);
    if (!entries.size) disarm();
  });
}

// 이 요청이 고친 기기 기록(브라우저, 주소, 마지막 활동)을 떼기 전에 저장한다(떼면 응답이 끝날 때 저장하지 않는다).
// 지금 행에 그것만 쓴다: 열기 앞에서 기다린 사이(멤버 조회) 같은 세션의 다른 요청이 저장한 것(CSRF 토큰 등)을 이 요청의 옛 사본으로 덮지 않게
function keepDevice(store: SqliteSessionStore, req: Request) {
  const device = req.session.device;
  const now = store.liveSession(req.sessionID);
  if (!now || device === undefined || now.device === device) return;
  store.set(req.sessionID, { ...now, device }, (error) => {
    if (error) log.warn(`스트림을 연 기기의 기록을 저장하지 못했습니다: ${messageOf(error)}`);
  });
}

// 저장소가 세션 끝을 알렸다
function onEnded(sid: string) {
  forgetGuilds(sid);
  const live = new Set<Request>();
  for (const entry of [...entries.values()]) {
    if (entry.sid !== sid || released.has(entry.req)) continue;
    live.add(entry.req);
    stop(entry, "세션이 끝남");
  }
  // 이미 끝난 답(한 번에 쓰고 끝낸 큰 답)의 바이트가 남은 소켓: 그 소켓의 마지막 요청이 이 세션의 것이면 부순다
  for (const socket of [...(socketsOf.get(sid) ?? [])]) {
    const last = lastOf.get(socket);
    if (!last || live.has(last) || released.has(last) || entryOf.get(last)?.sid !== sid) continue;
    socket.destroy();
  }
}

// 끝난 요청을 멈춘다. 스트림은 끝 이벤트와 함께 끊고, 흘려 보내는 답과 받는 중인 본문은 소켓을 부수고, 나머지는 표시만(감싸기와 확인이 멈춘다)
function stop(entry: Entry, why: string) {
  const { req, res } = entry;
  ended.add(req);
  if (entry.stream) return closeStream(entry, why);
  if (receiving(req) || (res.headersSent && !res.writableEnded)) {
    if (entries.get(res) === entry) entries.delete(res);
    if (!entries.size) disarm();
    entry.socket.destroy();
    log.debug(`세션이 끝나 진행 중인 요청을 끊었습니다(${why}): ${req.method} ${req.baseUrl}${req.path} | ${entry.name}`);
  }
}

// 본문을 아직 받는 중인가(큰 업로드). 본문 없는 요청은 핸들러가 동기로 도는 동안 complete 가 아직 거짓이라 본문이 있는지부터 본다
function receiving(req: Request) {
  const length = Number(req.headers["content-length"] ?? 0);
  return !req.complete && (length > 0 || req.headers["transfer-encoding"] !== undefined);
}

// 스트림을 끊는다. 묶음에서 곧바로 빼고 모듈 정리를 부른다
function closeStream(entry: Entry, why: string) {
  if (entries.get(entry.res) !== entry) return;
  entries.delete(entry.res);
  if (!entries.size) disarm();
  const { res, socket } = entry;
  const kind = entry.stream ?? "";
  // 쌓인 양은 끝내기 앞에서 잰다(끝낸 뒤에는 0 이다)
  const large = res.writableLength > LARGE_BACKLOG;
  try {
    entry.drop();
  } catch (error) {
    log.debug(`스트림 정리 실패(${kind}): ${messageOf(error)}`);
  }
  if (large || res.writableEnded || res.destroyed) {
    socket.destroy();
  } else {
    res.write(ENDED_FRAME);
    res.end();
    // 끝낸 뒤에는 응답이 소켓에서 떨어져 응답을 부숴도 소켓은 남는다. 소켓을 직접 부순다
    setTimeout(() => socket.destroy(), CLOSE_GRACE_MS).unref();
  }
  // 로그아웃, 다시 로그인마다 탭 수만큼 나온다. 끊은 일 자체(다른 기기 로그아웃 등)는 그 경로가 남긴다
  log.debug(`스트림을 끊었습니다(${why}): ${kind} | ${entry.name}`);
}

/** 묶인 요청의 세션을 다시 본다(RECHECK_MS 마다). 세션마다 저장소를 한 번 읽는다. 절대 기한은 저장소를 읽지 못해도 본다 */
function recheck(now = Date.now()) {
  const unchecked: Entry[] = [];
  let firstError: unknown = null;
  for (const [sid, list] of liveBySid()) {
    const alive = list.filter((entry) => {
      if (entry.deadline > now) return true;
      stop(entry, "로그인 기한이 지남");
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
    for (const entry of alive) if (session?.user?.id !== entry.userId) stop(entry, "세션이 끝남");
  }
  if (!firstError) {
    failures = 0;
    return;
  }
  failures++;
  log.warn(`진행 중인 요청의 로그인 세션을 확인하지 못했습니다(${failures}/${FAILURES_TO_CLOSE}): ${messageOf(firstError)}`);
  if (failures < FAILURES_TO_CLOSE) return;
  for (const entry of unchecked) stop(entry, "세션을 확인하지 못함");
  failures = 0;
}

// 아직 멈추지 않은 묶인 요청을 sid 마다
function liveBySid() {
  const bySid = new Map<string, Entry[]>();
  for (const entry of entries.values()) if (!released.has(entry.req) && !ended.has(entry.req)) bySid.set(entry.sid, [...(bySid.get(entry.sid) ?? []), entry]);
  return bySid;
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
  entries.clear();
  socketsOf.clear();
  disarm();
}

export { noteSocket, bind, release, assertSignedIn, sessionEnded, isEnded, admit, track, recheck, _reset, SessionEndedError, RECHECK_MS, ENDED_FRAME };
