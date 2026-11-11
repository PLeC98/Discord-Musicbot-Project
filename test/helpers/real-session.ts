// 실제 로그인 세션(임시 DB의 SqliteSessionStore, express-session, 세션 묶기)으로 경로를 거치는 앱이다. 가짜 세션(signedInAs)은 저장소가 없어 변경 직전의 확인이 늘 통과하므로,
// 확인을 넘기는 연결은 이 앱으로 테스트한다. 경로 테스트에서 진행 중인 요청의 세션을 다른 기기에서 끝낼 수 있다.
// 저장소는 파일마다 하나(임시 폴더의 sessions.db)이고 close가 닫는다. 실제 database/는 열지 않는다
//
//   const real = await realSessionApp("prefix-", (app) => app.use("/api/x", express.json(), router));
//   after(() => real.close());
//   const who = await real.signedIn("owner");
//   real.end(who); // 다른 기기 로그아웃

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import session from "express-session";
import { SqliteSessionStore } from "../../src/dashboard/session-store.ts";
import * as sessionRequests from "../../src/dashboard/session-requests.ts";
import { errorHandler } from "../../src/dashboard/middleware/error-handler.ts";
import * as secrets from "../../src/store/secrets.ts";
import { newSecretsKey } from "../../src/rules/secrets-key.ts";
import { listenForFetch, baseUrl } from "./listen.ts";
import { cookieJar } from "./cookie-jar.ts";

/** 경로 테스트가 읽는 응답 */
type Reply<T> = { status: number; json: T };

/**
 * 실제 세션 앱을 연다. mount는 테스트할 라우터(와 본문 파서)를 붙인다. 세션 미들웨어와 묶기 뒤, 오류 핸들러 앞이다.
 * /login?u=아이디는 그 사용자로 방금 로그인한 세션을 만든다(최근 로그인을 확인하는 경로도 통과한다)
 */
async function realSessionApp(prefix: string, mount: (app: express.Express) => void) {
  secrets._useKey(newSecretsKey());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new SqliteSessionStore({ dbPath: path.join(dir, "sessions.db") });
  const app = express();
  app.use(sessionRequests.noteSocket);
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false, store, cookie: { maxAge: 7 * 24 * 60 * 60_000 } }));
  app.use(sessionRequests.bind);
  app.post("/login", (req, res) => {
    const id = String(req.query.u);
    req.session.user = { id, username: id, globalName: id, avatar: null };
    req.session.loginAt = Date.now();
    req.session.save(() => res.status(204).end());
  });
  mount(app);
  app.use(errorHandler);
  const server = await listenForFetch(app);
  const base = baseUrl(server);

  // 쿠키 하나 = 기기 하나
  function device() {
    const jar = cookieJar();
    const go = async (urlPath: string, init: RequestInit & { headers?: Record<string, string> } = {}) => {
      const res = await fetch(base + urlPath, { redirect: "manual", ...init, headers: { cookie: jar.header(), ...init.headers }, signal: AbortSignal.timeout(5000) });
      jar.take(res);
      return res;
    };
    /** JSON으로 요청하고 응답을 읽는다. 본문이 없거나 JSON이 아니면 json은 null */
    const call = async <T = { code?: string }>(method: string, urlPath: string, body?: unknown): Promise<Reply<T>> => {
      const res = await go(urlPath, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      const parsed = () => {
        try {
          return text ? (JSON.parse(text) as T) : null;
        } catch {
          return null;
        }
      };
      return { status: res.status, json: parsed() as T };
    };
    const sid = () =>
      decodeURIComponent(jar.get("connect.sid") ?? "")
        .replace(/^s:/, "")
        .split(".")[0];
    return { go, call, sid };
  }

  /** 그 사용자로 로그인한 기기 */
  async function signedIn(userId: string) {
    const who = device();
    const res = await who.go(`/login?u=${encodeURIComponent(userId)}`, { method: "POST" });
    if (res.status !== 204 || !who.sid()) throw new Error(`테스트용 로그인 실패(${res.status})`);
    return who;
  }

  return {
    app,
    store,
    base,
    signedIn,
    /** 다른 기기에서 그 기기의 세션을 끝낸다(저장소에서 삭제, 끝 알림) */
    end: (who: { sid(): string }) => store.destroy(who.sid()),
    close() {
      sessionRequests._reset();
      server.closeAllConnections();
      server.close();
      store.close();
      secrets._useKey();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

type RealSession = Awaited<ReturnType<typeof realSessionApp>>;
type Device = Awaited<ReturnType<RealSession["signedIn"]>>;

/** 한 번만 도는 끝내기. 가짜가 여러 번 불려도(멤버 조회, 채널 찾기) 처음 한 번만 끝낸다. fired로 돌았는지 본다 */
function endOnce() {
  let run: (() => void) | null = null;
  let fired = false;
  return {
    /** 다음에 부를 때 끝낼 것 */
    arm(fn: () => void) {
      run = fn;
      fired = false;
    },
    /** 가짜 안에서 부른다 */
    now() {
      const fn = run;
      run = null;
      if (!fn) return;
      fired = true;
      fn();
    },
    get fired() {
      return fired;
    },
    reset() {
      run = null;
      fired = false;
    },
  };
}

export { realSessionApp, endOnce };
export type { RealSession, Device, Reply };
