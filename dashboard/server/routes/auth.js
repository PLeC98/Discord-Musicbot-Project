const express = require("express");
const log = require("../../../src/logger").child({ category: "dashboard" });
const axios = require("axios");
const crypto = require("crypto");
const router = express.Router();
const config = require("../../../config");

const CLIENT_ID = config.discord.clientId;
const CLIENT_SECRET = config.discord.clientSecret;
const DASHBOARD_URL = config.dashboard.url.replace(/\/$/, "");
const REDIRECT_URI = `${DASHBOARD_URL}/auth/callback`;
const OWNER_ID = config.dashboard.ownerId;

const DISCORD_API = "https://discord.com/api/v10";

// Log OAuth config at startup — 리다이렉트 불일치 디버깅용 REDIRECT_URI만.
// CLIENT_ID는 config에서 필수 검증되므로(없으면 기동 실패) 출력 불필요하고,
// OWNER_ID는 소유자 신원이라 원시 ID를 로그(=admin SSE 로그 스트림)에 남기지 않는다.
log.info({ sub: "auth" }, `REDIRECT_URI: ${REDIRECT_URI}`);
log.info({ sub: "auth" }, `OWNER_ID: ${OWNER_ID ? "(set)" : "(not set)"}`);

// Redirect to Discord OAuth
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

// OAuth2 callback
router.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect("/?error=no_code");

  // Validate OAuth state to prevent Login CSRF (RFC 6749)
  const expectedState = req.session.oauthState;
  delete req.session.oauthState;
  if (!state || !expectedState || state !== expectedState) {
    return res.redirect("/?error=auth_failed");
  }

  try {
    // Exchange code for access token
    const tokenRes = await axios.post(
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

    // Fetch user + guilds in parallel
    const [userRes, guildsRes] = await Promise.all([axios.get(`${DISCORD_API}/users/@me`, { headers: { Authorization: authHeader } }), axios.get(`${DISCORD_API}/users/@me/guilds`, { headers: { Authorization: authHeader } })]);

    const user = userRes.data;

    const sessionUser = {
      id: user.id,
      username: user.username,
      globalName: user.global_name || user.username,
      avatar: user.avatar,
      isAdmin: user.id === OWNER_ID,
      guilds: guildsRes.data,
    };

    // 로그인 성공 시 세션 ID 재발급 — session fixation 방어.
    // 로그인 전 세션(oauthState 등)은 폐기, 새 sid로 사용자 정보만
    req.session.regenerate((err) => {
      if (err) {
        log.error("❌ Session regenerate error:", err);
        return res.redirect("/?error=auth_failed");
      }
      req.session.user = sessionUser;
      req.session.save(() => res.redirect("/dashboard"));
    });
  } catch (error) {
    const discordErr = error.response?.data;
    log.error("❌ OAuth callback error:");
    log.error("  Status:", error.response?.status);
    log.error("  Body:", JSON.stringify(discordErr));
    log.error("  REDIRECT_URI used:", REDIRECT_URI);
    res.redirect("/?error=auth_failed");
  }
});

// Logout is state-changing and is protected by the global CSRF middleware.
router.post("/logout", (req, res) => {
  req.session.destroy(() => res.status(204).end());
});

module.exports = router;
