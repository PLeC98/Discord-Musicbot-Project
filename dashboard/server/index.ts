import config from "../../config.ts";
import logger from "../../src/infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import crypto from "crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { Client } from "discord.js";
import session from "express-session";
import cors from "cors";
import path from "path";
import fs from "fs";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";

import { createCorsOptions } from "./cors.ts";
import { bodyLimit } from "./bodyLimit.ts";
import { SqliteSessionStore } from "./sessionStore.ts";
import { issueCsrfToken, requireCsrfToken } from "./middleware/csrf.ts";
import { securityHeaders } from "./middleware/securityHeaders.ts";
import { errorHandler, notFoundJson } from "./middleware/errorHandler.ts";
import { isLoopbackHost, describeBinding } from "./binding.ts";
import { isOwner, isRealOwner } from "./owner.ts";
import { getViewAs } from "./viewAs.ts";
import { createAuthRouter } from "./routes/auth.ts";
import { adminRouter } from "./routes/admin.ts";
import { createGuildsRouter } from "./routes/guilds.ts";
import type { PlayerStream } from "./playerStream.ts";

/** 조립이 넘기는 것. sessionMiddleware 는 시험이 바꿔 넘긴다 */
type AppDeps = { stream: PlayerStream; deployCommands: Express.Locals["deployCommands"]; sessionMiddleware?: RequestHandler };

// 세션 비밀: .env의 SESSION_SECRET이 표준 경로. 미설정이면 랜덤 폴백.
// 보안은 유지되지만(추측 불가) 재시작마다 쿠키 서명이 무효화되어 대시보드 로그인이 풀린다.
function resolveSessionSecret() {
  if (config.dashboard.sessionSecret) {
    if (config.dashboard.sessionSecret.length < 32) {
      log.warn("SESSION_SECRET이 너무 짧습니다 (32자 미만). 64자 이상 랜덤 문자열을 권장합니다.");
    }
    return config.dashboard.sessionSecret;
  }
  log.warn("SESSION_SECRET이 없어 랜덤 값을 사용합니다. 봇을 재시작할 때마다 대시보드 로그인이 전부 풀립니다.");
  return crypto.randomBytes(32).toString("hex");
}

// 평문 접속 감지. 주 방어선이 아니다. 요청이 들어온 시점이면 세션 쿠키는 이미 평문으로
// 오간 뒤라 문구도 사후 조치를 안내한다. 설정을 https로 적어놓고 실제로는 평문인 경우의 그물.
function plaintextAccessWarner(host: string): RequestHandler {
  if (isLoopbackHost(host)) return (_req, _res, next) => next();

  let warned = false;
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!warned && !req.secure) {
      warned = true;
      log.warn("평문 HTTP 연결로 접속됨. 세션 쿠키가 암호화 없이 오갔습니다. HTTPS 설정 후 SESSION_SECRET을 변경해 기존 세션을 무효화하세요.");
    }
    next();
  };
}

// 로그인 세션. SQLite 영속 스토어라 재시작해도 로그인이 유지된다(SESSION_SECRET이 .env에 고정일 때.
// 랜덤 폴백이면 쿠키 서명이 무효화되어 어차피 풀림. resolveSessionSecret 경고 참조)
function createSessionMiddleware() {
  return session({
    secret: resolveSessionSecret(),
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // "auto" 는 Secure 를 실제 연결에 맞춘다. HTTPS 로 서비스하면(믿는 프록시 경유) 붙고,
      // 그냥 http://localhost 면 빠져서 로컬 시험이 그대로 된다.
      secure: "auto",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  });
}

// 미들웨어 등록만 하고 listen은 하지 않는다. 등록 순서 자체가 회귀 대상이라(정적 자산이
// 세션보다 앞, 오류 핸들러가 맨 뒤) 테스트가 실제 앱을 임의 포트에 띄워 검증한다.
// sessionMiddleware: 로그인 세션. 기본은 SQLite 세션이고, 테스트가 저장소가 죽은 상태를 넘긴다
// deployCommands: 슬래시 명령 등록(운영자의 재등록 버튼). 조립이 넘긴다
function createApp(client: Client, { stream, deployCommands, sessionMiddleware = createSessionMiddleware() }: AppDeps) {
  const app = express();
  const { host, url } = config.dashboard;

  // X-Forwarded-* 는 사설망 프록시가 보낸 것만 믿는다(같은 기기나 LAN 의 Caddy).
  // 공인 주소에서 바로 온 헤더는 무시하므로 클라이언트가 값을 꾸며낼 수 없다.
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
  app.disable("x-powered-by"); // 서버 스택을 광고하지 않는다

  app.use(securityHeaders);
  app.use(plaintextAccessWarner(host));

  // 정적 자산과 SPA 폴백은 세션보다 앞에 둔다. 세션 스토어(SQLite)가 죽어도 앱 껍데기는 떠서
  // 오류를 화면에 표시할 수 있어야 한다. 세션 뒤에 두면 CSS/JS까지 500이라 백지가 된다.
  const clientDist = path.join(import.meta.dirname, "../client/dist");
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

  app.use(bodyLimit());
  app.use(cors(createCorsOptions(url, { allowDevOrigin: config.dashboard.devOrigin })));
  app.use(sessionMiddleware);
  app.get("/api/csrf-token", issueCsrfToken);
  app.use(requireCsrfToken);

  // 라우트에서 디스코드 클라이언트를 쓸 수 있게
  app.locals.discordClient = client;
  app.locals.deployCommands = deployCommands;

  // ── API 요청 제한 (express-rate-limit). 라우트 마운트보다 먼저 등록 ──
  const rl = config.dashboard.rateLimit;
  const apiKey = (req: Request) => req.session?.user?.id || ipKeyGenerator(req.ip ?? "");

  // 일반 인증 API. 정상 사용(폴링 12/분, 플레이리스트 1요청)을 넉넉히 넘는 값. SSE(장수명 연결) 경로는 제외.
  app.use(
    "/api",
    rateLimit({
      windowMs: rl.windowMs,
      limit: rl.apiMax,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      keyGenerator: apiKey,
      message: { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요" },
      // 음량은 재생 경로가 따로 센다(끄는 동안 잇달아 온다)
      skip: (req) => req.originalUrl.startsWith("/api/admin/logs/stream") || req.originalUrl.includes("/player/events") || req.originalUrl.startsWith("/api/guilds/events") || /\/player\/volume(\?|$)/.test(req.originalUrl),
    }),
  );

  // 로그인/OAuth. 세션 전이라 IP 키 (trust proxy가 사설망 한정이라 신뢰 가능)
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

  // 로그인 관련(/auth/login · /auth/callback · /auth/logout)
  app.use("/auth", createAuthRouter());

  // API 라우트
  app.use("/api/admin", adminRouter);
  app.use("/api/guilds", createGuildsRouter({ stream }));

  // 지금 로그인한 사람
  // isOwner는 세션에 저장하지 않고 여기서 파생한다. UI 표시용이고 권한 판정은 서버가 매번 다시 한다.
  // isOwner는 권한 수준 오버라이드가 반영된 값(UI가 그 계층으로 보이게), isRealOwner는 해제 수단을
  // 계속 노출하기 위한 원래 값이다.
  app.get("/api/me", (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "로그인이 필요합니다." });
    res.json({ ...req.session.user, isOwner: isOwner(req), isRealOwner: isRealOwner(req), viewAs: getViewAs(req) });
  });

  // 로그인 전 화면이 쓰는 공개 정보
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

function startDashboard(client: Client, { stream, deployCommands }: AppDeps) {
  const app = createApp(client, { stream, deployCommands });

  const { port, host, url } = config.dashboard;
  const { line, warnings } = describeBinding(host, port, url);
  app.listen(port, host, () => {
    log.info(line);
    for (const w of warnings) log.warn(w);
    // 평상시 실행과 다른 상태로 떠 있다는 것은 드러나 있어야 한다
    if (config.dashboard.devOrigin) log.warn("개발 모드. Vite 개발 서버(http://localhost:5173)의 요청을 허용합니다.");
  });

  return app;
}

export { startDashboard, createApp };
