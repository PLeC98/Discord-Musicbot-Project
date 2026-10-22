import express from "express";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import crypto from "crypto";
import config from "../../config/index.ts";
import type { SessionUser } from "../express-slots.d.ts";
import { loginFailed, type LoginError } from "../contract/identity.ts";
import { tokenStoreOf } from "../session-store.ts";
import { DISCORD_API, discordHttp, type DiscordHttp } from "../discord-api.ts";
import { bestEffort } from "../../infra/best-effort.ts";
import { forgetGuilds } from "../invite.ts";
import { recordLogin } from "../login-devices.ts";

/** 여기서 읽는 필드만 */
type TokenReply = { access_token: string; token_type: string };
type UserReply = { id: string; username: string; global_name: string | null; avatar: string | null };

// 요청 실패에서 읽는 필드. 응답이 있으면 상태와 본문, 없으면(시간 초과 · 연결 실패) 이름과 문장
type Failure = { response?: { status?: number; data?: unknown }; name?: string; message?: string; cause?: { code?: string } };
const failureOf = (error: unknown): Failure => (typeof error === "object" && error !== null ? error : {});
/** 디스코드가 봇의 앱 자격(클라이언트 ID · 시크릿)을 거절한 응답인가 */
const isBadClient = (response: Failure["response"]) => (response?.data as { error?: unknown } | undefined)?.error === "invalid_client";

/** 콜백에서 디스코드를 부르다 실패했다. 까닭을 남기고 로그인 화면에 보일 까닭을 선택한다 */
function callbackFailure(error: unknown, redirectUri: string): LoginError {
  const { response, name, message, cause } = failureOf(error);
  // 디스코드가 봇의 앱 자격을 거절했다(RFC 6749 5.2 invalid_client): 사용자가 다시 해도 안 되고 운영자가 고칠 일이다
  if (isBadClient(response)) {
    log.error({ status: response?.status }, "OAuth 토큰 교환 거절: CLIENT_SECRET 이 디스코드 개발자 포털(OAuth2)의 클라이언트 시크릿과 다릅니다");
    return "bad_client";
  }
  // 응답 없는 실패(시간 초과 · 연결 실패)도 읽히게
  const what = response ? `상태 코드 ${response.status ?? "없음"}` : name === "TimeoutError" ? "응답 시간 초과" : cause?.code || message;
  log.error({ status: response?.status, body: JSON.stringify(response?.data), redirectUri }, `OAuth 콜백 오류: ${what ?? "없음"}`);
  return "auth_failed";
}

/** 디스코드에 접근 토큰 폐기를 요청한다(RFC 7009). 로그아웃 · 다른 기기 로그아웃 */
function revokeToken(http: DiscordHttp, token: string) {
  return http.post(`${DISCORD_API}/oauth2/token/revoke`, new URLSearchParams({ client_id: config.discord.clientId, client_secret: config.discord.clientSecret ?? "", token, token_type_hint: "access_token" }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
}

/** 디스코드 개발자 포털 OAuth2 Redirects 에 등록할 콜백 주소 */
const callbackUrl = () => `${config.dashboard.url.replace(/\/$/, "")}/auth/callback`;

/**
 * 디스코드 OAuth 로그인 · 로그아웃.
 * http: 디스코드를 부르는 HTTP 클라이언트. 생략하면 진짜(fetch)
 */
function createAuthRouter({ http = discordHttp }: { http?: DiscordHttp } = {}) {
  const router = express.Router();
  const CLIENT_ID = config.discord.clientId;
  const CLIENT_SECRET = config.discord.clientSecret ?? ""; // 비면 기동이 멈춘다(config)
  const REDIRECT_URI = callbackUrl();

  // 디스코드 OAuth 로 보낸다. popup=1: 화면이 연 로그인 창이다(다시 로그인). 끝나면 창을 닫는 화면(/login-done)으로 보낸다
  router.get("/login", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    req.session.oauthState = state;
    if (req.query.popup === "1") req.session.oauthPopup = true;
    else delete req.session.oauthPopup;
    req.session.save(() => {
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "identify guilds",
        state,
      });
      res.redirect(`${DISCORD_API}/oauth2/authorize?${params.toString()}`);
    });
  });

  // OAuth2 콜백
  router.get("/callback", async (req, res) => {
    const { code, state } = req.query;
    // 디스코드 승인 화면에서 취소했다(RFC 6749 4.1.2.1)
    if (req.query.error === "access_denied") return res.redirect(loginFailed("denied"));
    if (typeof code !== "string" || !code) return res.redirect(loginFailed("no_code"));

    // 로그인 CSRF 를 막으려고 state 를 맞춰 본다(RFC 6749)
    const expectedState = req.session.oauthState;
    delete req.session.oauthState;
    const popup = req.session.oauthPopup === true;
    delete req.session.oauthPopup;
    if (!state || !expectedState || state !== expectedState) {
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

      // 로그인 성공 시 세션 ID 재발급. session fixation 방어.
      // 로그인 전 세션(oauthState 등)은 폐기, 새 sid로 사용자 정보만
      req.session.regenerate((err) => {
        if (err) {
          log.error("세션 재생성 실패:", err);
          return res.redirect(loginFailed("auth_failed"));
        }
        req.session.user = sessionUser;
        req.session.loginAt = Date.now();
        recordLogin(req, req.session.loginAt);
        req.session.save(() => {
          // 토큰은 세션 행에 암호문으로(세션 JSON 밖). 7일이라 로그인 쿠키와 같이 끝난다. 리프레시 토큰은 두지 않는다
          tokenStoreOf(req)?.saveDiscordToken(req.sessionID, access_token);
          res.redirect(popup ? "/login-done" : "/dashboard");
        });
      });
    } catch (error) {
      res.redirect(loginFailed(callbackFailure(error, REDIRECT_URI)));
    }
  });

  // 로그아웃은 상태를 바꾸므로 전역 CSRF 미들웨어가 지킨다. 디스코드 토큰은 세션 행과 함께 지워지고, 디스코드에도 폐기를 요청한다
  router.post("/logout", (req, res) => {
    const token = tokenStoreOf(req)?.readDiscordToken(req.sessionID) ?? null;
    if (token) bestEffort(log, revokeToken(http, token), "디스코드 토큰 폐기");
    forgetGuilds(req.sessionID);
    req.session.destroy(() => res.status(204).end());
  });

  return router;
}

export { createAuthRouter, callbackUrl, revokeToken };
