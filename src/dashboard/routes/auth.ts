import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import crypto from "crypto";
import config from "../../config/index.ts";
import type { SessionUser } from "../express-slots.d.ts";
import { loginFailed, type LoginError, type Tier } from "../contract/identity.ts";
import { tokenStoreOf, type SqliteSessionStore } from "../session-store.ts";
import { DISCORD_API, discordHttp, type DiscordHttp } from "../discord-api.ts";
import { bestEffort } from "../../infra/best-effort.ts";
import { forgetGuilds } from "../user-guilds.ts";
import { recordDevice } from "../login-devices.ts";
import { release } from "../session-requests.ts";
import { LOGIN_COOKIE_MS, clearSessionCookie, setLoginCookie, takeLoginCookie } from "../cookies.ts";
import * as secrets from "../../store/secrets.ts";
import { sendProblem } from "../problem.ts";
import { messageOf } from "../../rules/error-kind.ts";

/** 여기서 읽는 필드만 */
type TokenReply = { access_token: string; token_type: string };
type UserReply = { id: string; username: string; global_name: string | null; avatar: string | null };

// 요청 실패에서 읽는 필드. 응답이 있으면 상태와 본문, 없으면(시간 초과, 연결 실패) 이름과 문장
type Failure = { response?: { status?: number; data?: unknown }; name?: string; message?: string; cause?: { code?: string } };
const failureOf = (error: unknown): Failure => (typeof error === "object" && error !== null ? error : {});
/** 디스코드가 봇의 앱 자격(클라이언트 ID, 시크릿)을 거절한 응답인가 */
const isBadClient = (response: Failure["response"]) => (response?.data as { error?: unknown } | undefined)?.error === "invalid_client";

/** 콜백에서 디스코드를 부르다 실패했다. 까닭을 남기고 로그인 화면에 보일 까닭을 선택한다 */
function callbackFailure(error: unknown, redirectUri: string): LoginError {
  const { response, name, message, cause } = failureOf(error);
  // 디스코드가 봇의 앱 자격을 거절했다(RFC 6749 5.2 invalid_client): 사용자가 다시 해도 안 되고 운영자가 고칠 일이다
  if (isBadClient(response)) {
    log.error({ status: response?.status }, "OAuth 토큰 교환 거절됨: CLIENT_SECRET이 디스코드 개발자 포털(OAuth2)의 클라이언트 시크릿과 다름");
    return "bad_client";
  }
  // 응답 없는 실패(시간 초과, 연결 실패)도 읽히게
  const what = response ? `상태 코드 ${response.status ?? "없음"}` : name === "TimeoutError" ? "응답 시간 초과" : cause?.code || message;
  log.error({ status: response?.status, body: JSON.stringify(response?.data), redirectUri }, `OAuth 콜백 오류: ${what ?? "없음"}`);
  return "auth_failed";
}

/** 디스코드에 접근 토큰 폐기를 요청한다(RFC 7009). 로그아웃, 다른 기기 로그아웃 */
function revokeToken(http: DiscordHttp, token: string) {
  return http.post(`${DISCORD_API}/oauth2/token/revoke`, new URLSearchParams({ client_id: config.discord.clientId, client_secret: config.discord.clientSecret ?? "", token, token_type_hint: "access_token" }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
}

/** 디스코드 개발자 포털 OAuth2 Redirects 에 등록할 콜백 주소 */
const callbackUrl = () => `${config.dashboard.url.replace(/\/$/, "")}/auth/callback`;

/** 브라우저가 연 주소의 origin이 공개 주소와 다르면 공개 주소의 로그인 주소(popup은 그대로, moved=1). 같거나 이미 리다이렉트했으면 null */
function publicLogin(req: express.Request): string | null {
  if (req.query.moved === "1") return null;
  const target = new URL(config.dashboard.url);
  let here: string;
  try {
    here = new URL(`${req.protocol}://${req.host}`).origin;
  } catch {
    // Host 헤더는 신뢰할 수 없는 입력이다. 읽지 못하면 공개 로그인 주소로 보낸다
    here = "";
  }
  if (here === target.origin) return null;
  target.pathname = "/auth/login";
  target.search = new URLSearchParams({ ...(req.query.popup === "1" ? { popup: "1" } : {}), moved: "1" }).toString();
  return target.toString();
}

// OAuth 로그인 요청(state, PKCE verifier, 팝업 여부, 생성 시각)은 세션이 아니라 쿠키 하나에 암호화해 둔다(Grafana의 oauth_state, Auth.js의 state 쿠키와 같다).
// 세션에 두면 로그인 전에도 세션 행이 생기고, 팝업 재로그인이 기록한 state를 동시에 처리된 다른 요청이 이전 세션 사본으로 덮어써 지우게 된다
type LoginRequest = { state: string; verifier: string; popup: boolean; at: number };
const LOGIN_PURPOSE = "oauth-login";
// 잠근 값을 이 대시보드에 묶는다(다른 봇의 쿠키로 바꿔 넣어도 열리지 않는다)
const loginBound = () => `${config.discord.clientId}|${config.dashboard.url}`;

function sealLogin(login: LoginRequest) {
  return secrets.sealBlob(LOGIN_PURPOSE, JSON.stringify(login), loginBound()).toString("base64url");
}

/** 쿠키에 담긴 로그인 요청을 복호화한다. 없거나, 위조됐거나, 다른 키로 암호화됐거나, 형식이 다르면 null을 반환한다 */
function openLogin(value: string | null): LoginRequest | null {
  if (!value) return null;
  const json = secrets.openBlob(LOGIN_PURPOSE, Buffer.from(value, "base64url"), loginBound());
  if (!json) return null;
  try {
    const login = JSON.parse(json) as Partial<LoginRequest>;
    return typeof login.state === "string" && typeof login.verifier === "string" && typeof login.popup === "boolean" && typeof login.at === "number" ? (login as LoginRequest) : null;
  } catch {
    return null;
  }
}

/** 두 문자열의 길이가 같을 때 상수 시간(constant-time)으로 비교한다 */
function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** 사용한 state를 기록해 두는 최대 개수다(넘으면 오래된 것부터 비우며, 비워진 것도 쿠키 수명이 지나면 생성 시각 검사에서 거절된다) */
const USED_MAX = 10_000;

/** 새 세션 id로 여는 세션에 담을 값. token: 디스코드 토큰(없으면 적지 않는다), signedInAt: 기기 기록의 로그인 시각, failure: 실패 로그의 앞부분 */
type Fresh = { user: SessionUser; loginAt: number; viewAs?: Tier; token: string | null; signedInAt: number; failure: string };

// 이 요청의 세션을 끝내고 새 세션 id로 연다(로그인, 다른 기기 로그아웃). 사용자 정보를 담아 저장하고 같은 행에 디스코드 토큰과 기기 기록을 적는다.
// 이전 세션 삭제나 새 세션 저장에 실패하면 요청에서 세션을 분리하고 false를 반환한다:
// 세션을 분리하지 않으면 응답이 끝날 때 express-session이 사용자 정보가 담긴 세션을 저장하고 쿠키를 실어, 실패로 응답해도 로그인 상태가 된다.
// release부터 regenerate까지는 기다림 없이 이어서 한다. 같은 쿠키로 동시에 온 요청은 이전 세션이 이미 끝나 401이 된다
async function startSession(req: express.Request, fresh: Fresh) {
  const step = (run: (done: (err?: unknown) => void) => void) => new Promise<void>((ok, fail) => run((err) => (err ? fail(err) : ok())));
  // 이 요청이 기존 세션을 끝내므로, 세션 종료 알림 때문에 이 요청 자체가 중단되지 않게 한다
  release(req);
  try {
    await step((done) => req.session.regenerate(done));
    req.session.user = fresh.user;
    req.session.loginAt = fresh.loginAt;
    if (fresh.viewAs) req.session.viewAs = fresh.viewAs;
    await step((done) => req.session.save(done));
    // 토큰은 암호화해 세션 행에 별도로 저장하고(세션 JSON 밖), 세션 행과 함께 삭제한다. 디스코드 토큰의 수명(7일)이 세션보다 먼저 만료되면 서버 목록을 다시 불러올 때 재로그인을 안내한다. 리프레시 토큰은 저장하지 않는다
    const store = tokenStoreOf(req);
    if (store && fresh.token && !store.saveDiscordToken(req.sessionID, fresh.token)) throw new Error("저장된 세션 행 없음");
    if (store) recordFirstDevice(req, store, fresh.signedInAt);
    return true;
  } catch (error) {
    log.error(`${fresh.failure}: ${messageOf(error)}`);
    const sid = req.sessionID;
    (req as { session: unknown }).session = null;
    tokenStoreOf(req)?.destroy(sid, () => undefined);
    return false;
  }
}

function signIn(req: express.Request, user: SessionUser, token: string) {
  const now = Date.now();
  return startSession(req, { user, loginAt: now, token, signedInAt: now, failure: "로그인 세션 저장 실패(로그인 실패로 처리)" });
}

// 로그인한 기기의 첫 기록. 적지 못해도 로그인은 그대로 유지된다(다음 요청에서 noteDevice가 적는다)
function recordFirstDevice(req: express.Request, store: SqliteSessionStore, signedInAt: number) {
  try {
    recordDevice(req, store, signedInAt);
  } catch (error) {
    log.warn(`로그인 기기 첫 기록 실패(다음 요청에서 다시 기록): ${messageOf(error)}`);
  }
}

/**
 * 디스코드 OAuth 로그인, 로그아웃.
 * http: 디스코드를 부르는 HTTP 클라이언트. 생략하면 진짜(fetch)
 */
function createAuthRouter({ http = discordHttp }: { http?: DiscordHttp } = {}) {
  const router = express.Router();
  const CLIENT_ID = config.discord.clientId;
  const CLIENT_SECRET = config.discord.clientSecret ?? ""; // 비면 기동이 멈춘다(config)
  const REDIRECT_URI = callbackUrl();
  // 사용한 state → 만료 시각. 쿠키 삭제를 무시하는 클라이언트가 있어 쿠키만으로는 재사용을 막을 수 없다. 다시 시작하면 초기화되지만 쿠키 수명이 남아 있는 동안의 재사용은 막는다
  const used = new Map<string, number>();

  // 이 state를 처음 사용하면 기록하고 true를 반환한다. 이미 사용했으면 false를 반환한다
  function firstUse(state: string, now: number) {
    for (const [one, until] of used) if (until <= now) used.delete(one);
    if (used.has(state)) return false;
    if (used.size >= USED_MAX) used.delete(used.keys().next().value as string);
    used.set(state, now + LOGIN_COOKIE_MS);
    return true;
  }

  // 디스코드 OAuth로 보낸다. popup=1: 화면이 연 재로그인 창이다. 끝나면 창을 닫는 화면(/login-done)으로 보낸다. 세션은 건드리지 않는다
  // PKCE(RFC 7636, S256): 가로챈 인가 코드는 이 브라우저의 verifier 없이 토큰으로 교환하지 못한다. RFC 9700 2.1.1은 confidential client에도 권고한다
  router.get("/login", (req, res) => {
    // 로그인은 늘 공개 주소에서 시작한다: state 쿠키와 콜백이 공개 주소에 묶인다. 다른 이름(localhost, IP 등)으로 연 화면에서 오면 공개 주소의 로그인으로 보낸다.
    // 리다이렉트한 요청에는 moved=1을 붙여 다시 리다이렉트하지 않는다(Host를 127.0.0.1로 바꾸는 프록시 뒤에서는 공개 주소로 와도 다른 이름으로 보인다)
    const target = publicLogin(req);
    if (target) return res.redirect(target);
    const state = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    setLoginCookie(req, res, sealLogin({ state, verifier, popup: req.query.popup === "1", at: Date.now() }));
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "identify guilds",
      state,
      code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    res.redirect(`${DISCORD_API}/oauth2/authorize?${params.toString()}`);
  });

  // OAuth2 콜백이다. 로그인 쿠키는 모든 분기에서 삭제한다
  router.get("/callback", async (req, res) => {
    const login = openLogin(takeLoginCookie(req, res));
    const { code, state } = req.query;
    // 디스코드 승인 화면에서 취소했다(RFC 6749 4.1.2.1)
    if (req.query.error === "access_denied") return res.redirect(loginFailed("denied"));
    if (typeof code !== "string" || !code) return res.redirect(loginFailed("no_code"));

    // 로그인 CSRF를 막으려고 state를 이 브라우저의 쿠키와 대조한다(RFC 6749 10.12). 쿠키의 수명 안에서 한 번만 허용한다
    const now = Date.now();
    if (!login || typeof state !== "string" || !sameText(state, login.state) || now - login.at > LOGIN_COOKIE_MS || !firstUse(login.state, now)) {
      return res.redirect(loginFailed("auth_failed"));
    }

    try {
      // 코드를 접근 토큰으로 바꾼다
      const tokenRes = await http.post<TokenReply>(
        `${DISCORD_API}/oauth2/token`,
        new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: login.verifier,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );

      const { access_token, token_type } = tokenRes.data;
      const authHeader = `${token_type} ${access_token}`;

      // 사용자. 서버 목록은 초대 화면이 열 때 이 토큰으로 받는다(routes/invite)
      const userRes = await http.get<UserReply>(`${DISCORD_API}/users/@me`, { headers: { Authorization: authHeader } });
      const user = userRes.data;

      const sessionUser: SessionUser = {
        id: user.id,
        username: user.username,
        globalName: user.global_name || user.username,
        avatar: user.avatar,
      };

      // 로그인 성공 시 세션 ID를 재발급한다(session fixation 방어). 이 브라우저의 기존 세션(재로그인이면 이전 로그인 세션)은 종료된다
      if (!(await signIn(req, sessionUser, access_token))) return res.redirect(loginFailed("auth_failed"));
      res.redirect(login.popup ? "/login-done" : "/dashboard");
    } catch (error) {
      res.redirect(loginFailed(callbackFailure(error, REDIRECT_URI)));
    }
  });

  // 로그아웃은 상태를 바꾸므로 전역 CSRF 미들웨어가 지킨다. 디스코드 토큰은 세션 행과 함께 삭제되고, 디스코드에도 폐기를 요청한다.
  // 결과와 상관없이 이 브라우저의 쿠키를 삭제한다(세션 행을 삭제하지 못한 채 다시 시작해도 이 브라우저의 세션은 되살아나지 않는다). 삭제하지 못했으면 성공으로 답하지 않는다
  router.post("/logout", (req, res) => {
    clearSessionCookie(req, res);
    if (!req.session?.user) return res.status(204).end();
    try {
      const token = tokenStoreOf(req)?.readDiscordToken(req.sessionID) ?? null;
      if (token) bestEffort(log, revokeToken(http, token), "디스코드 토큰 폐기", "warn");
    } catch (error) {
      log.warn(`디스코드 토큰 읽기 실패(폐기 요청 생략, 로그아웃은 진행): ${messageOf(error)}`);
    }
    forgetGuilds(req.sessionID);
    release(req);
    const done = (error?: unknown) => (error ? sendProblem(res, "sign-out-unsaved") : res.status(204).end());
    const store = tokenStoreOf(req);
    if (!store) return req.session.destroy(done);
    // 저장소에 사용자 ID를 함께 넘긴다(삭제하지 못하면 같은 사용자의 다른 기기 로그아웃 때 함께 삭제한다). express-session의 destroy와 같게 요청에서 세션을 뗀다
    const { sessionID: sid } = req;
    const userId = req.session.user.id;
    (req as { session: unknown }).session = null;
    store.destroy(sid, done, userId);
  });

  return router;
}

export { createAuthRouter, callbackUrl, revokeToken, startSession };
