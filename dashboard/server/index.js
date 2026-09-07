const config = require("../../config");
const log = require("../../src/logger").child({ category: "dashboard" });
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const chalk = require("chalk");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const { createCorsOptions } = require("./cors");
const SqliteSessionStore = require("./sessionStore");
const { issueCsrfToken, requireCsrfToken } = require("./middleware/csrf");
const { securityHeaders } = require("./middleware/securityHeaders");
const { errorHandler, notFoundJson } = require("./middleware/errorHandler");
const { isLoopbackHost, describeBinding } = require("./binding");
const { isOwner } = require("./owner");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const guildsRoutes = require("./routes/guilds");

const PORT = config.dashboard.port;
const HOST = config.dashboard.host;
const DASHBOARD_URL = config.dashboard.url;

// 세션 비밀: .env의 SESSION_SECRET이 표준 경로. 미설정이면 랜덤 폴백 —
// 보안은 유지되지만(추측 불가) 재시작마다 쿠키 서명이 무효화되어 대시보드 로그인이 풀린다.
function resolveSessionSecret() {
  if (config.dashboard.sessionSecret) {
    if (config.dashboard.sessionSecret.length < 32) {
      log.warn(chalk.yellow("⚠️  SESSION_SECRET이 너무 짧습니다 (32자 미만) — 64자 이상 랜덤 문자열을 권장합니다."));
    }
    return config.dashboard.sessionSecret;
  }
  log.warn(chalk.yellow("⚠️  .env에 SESSION_SECRET이 없어 임시 랜덤 비밀로 대체합니다."));
  log.warn(chalk.yellow("   → 봇을 재시작할 때마다 대시보드 로그인이 전부 풀립니다."));
  log.warn(chalk.yellow("   → 생성 예: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\" 결과를 SESSION_SECRET=에 넣으세요."));
  return crypto.randomBytes(32).toString("hex");
}

// 평문 접속 감지 — 주 방어선이 아니다. 요청이 들어온 시점이면 세션 쿠키는 이미 평문으로
// 오간 뒤라 문구도 사후 조치를 안내한다. 설정을 https로 적어놓고 실제로는 평문인 경우의 그물.
function plaintextAccessWarner(host) {
  if (isLoopbackHost(host)) return (req, res, next) => next();

  let warned = false;
  return (req, res, next) => {
    if (!warned && !req.secure) {
      warned = true;
      log.warn(chalk.yellow("⚠️  [dashboard] 평문 HTTP 연결로 접속됨 — 세션 쿠키가 암호화 없이 오갔습니다."));
      log.warn(chalk.yellow("   HTTPS 설정 후 SESSION_SECRET을 변경해 기존 세션을 무효화하세요."));
    }
    next();
  };
}

// 미들웨어 등록만 하고 listen은 하지 않는다 — 등록 순서 자체가 회귀 대상이라(정적 자산이
// 세션보다 앞, 오류 핸들러가 맨 뒤) 테스트가 실제 앱을 임의 포트에 띄워 검증한다.
function createApp(client) {
  const app = express();
  const SESSION_SECRET = resolveSessionSecret();

  // Trust X-Forwarded-* headers only from private-network proxies
  // (Caddy on the same machine or on the LAN). Headers arriving directly
  // from public addresses are ignored, so clients cannot spoof them.
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
  app.disable("x-powered-by"); // 서버 스택을 광고하지 않는다

  app.use(securityHeaders);
  app.use(plaintextAccessWarner(HOST));

  // 정적 자산과 SPA 폴백은 세션보다 앞에 둔다. 세션 스토어(SQLite)가 죽어도 앱 껍데기는 떠서
  // 오류를 화면에 표시할 수 있어야 한다 — 세션 뒤에 두면 CSS/JS까지 500이라 백지가 된다.
  const clientDist = path.join(__dirname, "../client/dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("/{*path}", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/auth")) return next();
      res.sendFile(path.join(clientDist, "index.html"));
    });
  } else {
    app.get("/", (req, res) => {
      res.send("<h2>Dashboard client not built yet.<br>Run: <code>cd dashboard/client && pnpm install && pnpm build</code></h2>");
    });
  }

  app.use(express.json());
  app.use(cors(createCorsOptions(DASHBOARD_URL)));
  app.use(
    session({
      secret: SESSION_SECRET,
      // SQLite 영속 스토어 — 재시작해도 로그인 유지 (SESSION_SECRET이 .env에 고정일 때.
      // 랜덤 폴백이면 쿠키 서명이 무효화되어 어차피 풀림 — resolveSessionSecret 경고 참조)
      store: new SqliteSessionStore(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // 'auto': Secure attribute follows the actual connection —
        // set when served over HTTPS (via trusted proxy), omitted on
        // plain http://localhost so local testing keeps working
        secure: "auto",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.get("/api/csrf-token", issueCsrfToken);
  app.use(requireCsrfToken);

  // Make Discord client available to routes
  app.locals.discordClient = client;

  // ── API 요청 제한 (express-rate-limit) — 라우트 마운트보다 먼저 등록 ──
  const rl = config.dashboard.rateLimit;
  const apiKey = (req) => req.session?.user?.id || ipKeyGenerator(req.ip);

  // 일반 인증 API — 정상 사용(폴링 12/분, 플레이리스트 1요청)을 넉넉히 넘는 값. SSE(장수명 연결) 경로는 제외.
  app.use(
    "/api",
    rateLimit({
      windowMs: rl.windowMs,
      limit: rl.apiMax,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      keyGenerator: apiKey,
      message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요" },
      skip: (req) => req.originalUrl.startsWith("/api/admin/logs/stream") || req.originalUrl.includes("/player/events") || req.originalUrl.startsWith("/api/guilds/events"),
    }),
  );

  // 로그인/OAuth — 세션 전이라 IP 키 (trust proxy가 사설망 한정이라 신뢰 가능)
  app.use(
    "/auth",
    rateLimit({
      windowMs: rl.authWindowMs,
      limit: rl.authMax,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요" },
    }),
  );

  // Auth routes (/auth/login, /auth/callback, /auth/logout)
  app.use("/auth", authRoutes);

  // API routes
  app.use("/api/admin", adminRoutes);
  app.use("/api/guilds", guildsRoutes);

  // Current user endpoint
  // isOwner는 세션에 저장하지 않고 여기서 파생한다 — UI 표시용이고 권한 판정은 서버가 매번 다시 한다
  app.get("/api/me", (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "로그인이 필요합니다." });
    res.json({ ...req.session.user, isOwner: isOwner(req) });
  });

  // Public bot info (used on login page before auth)
  app.get("/api/bot", (req, res) => {
    const botUser = client?.user;
    if (!botUser) return res.status(503).json({ error: "봇이 아직 준비되지 않았습니다." });
    res.json({
      name: botUser.username,
      avatarUrl: botUser.avatarURL({ size: 256, extension: "webp" }) || null,
      sourceRepo: config.bot.sourceRepo, // AGPL 소스 공개 (개조본 = SOURCE_REPO_URL, 미설정 시 projectRepo)
      projectRepo: config.bot.projectRepo, // 원본 프로젝트 저장소
    });
  });

  app.use(notFoundJson);
  app.use(errorHandler);

  return app;
}

function startDashboard(client) {
  const app = createApp(client);

  const { line, warnings } = describeBinding(HOST, PORT, DASHBOARD_URL);
  app.listen(PORT, HOST, () => {
    log.info(chalk.green(line));
    for (const w of warnings) log.warn(chalk.yellow(w));
  });

  return app;
}

module.exports = { startDashboard, createApp };
