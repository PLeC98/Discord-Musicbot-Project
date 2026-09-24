import express from "express";
import logger from "../../../src/infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import axios, { type AxiosInstance } from "axios";
import crypto from "crypto";
import config from "../../../config.ts";

const DISCORD_API = "https://discord.com/api/v10";

// 요청 실패에서 읽는 칸. 응답이 있으면 상태와 본문, 없으면(타임아웃 등) 코드나 문장
type Failure = { response?: { status?: number; data?: unknown }; code?: string; message?: string };
const failureOf = (error: unknown): Failure => (typeof error === "object" && error !== null ? error : {});

/**
 * 디스코드 OAuth 로그인 · 로그아웃.
 * http: 디스코드를 부르는 HTTP 클라이언트(axios 모양). 생략하면 진짜
 */
function createAuthRouter({ http = axios.create({ timeout: 10000 }) }: { http?: Pick<AxiosInstance, "get" | "post"> } = {}) {
  // 응답 없는 요청이 로그인 콜백을 붙잡지 않도록 제한 시간을 둔 클라이언트로 부른다.
  const router = express.Router();
  const CLIENT_ID = config.discord.clientId;
  const CLIENT_SECRET = config.discord.clientSecret;
  const REDIRECT_URI = `${config.dashboard.url.replace(/\/$/, "")}/auth/callback`;

  // 리다이렉트 불일치 디버깅용 REDIRECT_URI만.
  // CLIENT_ID는 config에서 필수 검증되므로(없으면 기동 실패) 출력 불필요하고,
  // 운영자 ID는 봇 운영자의 신원이라 원시 ID를 로그(=운영자 SSE 로그 스트림)에 남기지 않는다.
  log.debug({ sub: "auth" }, `리디렉션 URI: ${REDIRECT_URI}`);
  log.debug({ sub: "auth" }, `운영자 ID: ${config.dashboard.ownerId ? "설정됨" : "미설정"}`);

  // 디스코드 OAuth 로 보낸다
  router.get("/login", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    req.session.oauthState = state;
    req.session.save(() => {
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "identify guilds",
        state,
      });
      res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
    });
  });

  // OAuth2 콜백
  router.get("/callback", async (req, res) => {
    const { code, state } = req.query;
    if (typeof code !== "string" || !code) return res.redirect("/?error=no_code");

    // 로그인 CSRF 를 막으려고 state 를 맞춰 본다(RFC 6749)
    const expectedState = req.session.oauthState;
    delete req.session.oauthState;
    if (!state || !expectedState || state !== expectedState) {
      return res.redirect("/?error=auth_failed");
    }

    try {
      // 코드를 접근 토큰으로 바꾼다
      const tokenRes = await http.post(
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

      // 사용자 및 길드 정보를 병렬로 Fetch
      const opts = { headers: { Authorization: authHeader } };
      const [userRes, guildsRes] = await Promise.all([http.get(`${DISCORD_API}/users/@me`, opts), http.get(`${DISCORD_API}/users/@me/guilds`, opts)]);

      const user = userRes.data;

      const sessionUser = {
        id: user.id,
        username: user.username,
        globalName: user.global_name || user.username,
        avatar: user.avatar,
        guilds: guildsRes.data,
      };

      // 로그인 성공 시 세션 ID 재발급. session fixation 방어.
      // 로그인 전 세션(oauthState 등)은 폐기, 새 sid로 사용자 정보만
      req.session.regenerate((err) => {
        if (err) {
          log.error("세션 재생성 실패:", err);
          return res.redirect("/?error=auth_failed");
        }
        req.session.user = sessionUser;
        req.session.save(() => res.redirect("/dashboard"));
      });
    } catch (error) {
      const { response, code, message } = failureOf(error);
      const what = response ? `상태 코드 ${response.status}` : code || message; // 응답 없는 실패(타임아웃 등)도 읽히게
      log.error({ status: response?.status, body: JSON.stringify(response?.data), redirectUri: REDIRECT_URI }, `OAuth 콜백 오류: ${what}`);
      res.redirect("/?error=auth_failed");
    }
  });

  // 로그아웃은 상태를 바꾸므로 전역 CSRF 미들웨어가 지킨다.
  router.post("/logout", (req, res) => {
    req.session.destroy(() => res.status(204).end());
  });

  return router;
}

export { createAuthRouter };
