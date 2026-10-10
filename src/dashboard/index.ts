import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import crypto from "crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { BotContext } from "../app/bot-context.ts";
import session from "express-session";
import cors from "cors";
import path from "path";
import fs from "fs";

import { createCorsOptions } from "./cors.ts";
import { bodyLimit } from "./body-limit.ts";
import { SqliteSessionStore } from "./session-store.ts";
import { issueCsrfToken, requireCsrfToken } from "./middleware/csrf.ts";
import { securityHeaders } from "./middleware/security-headers.ts";
import { errorHandler, notFoundJson } from "./middleware/error-handler.ts";
import { isLoopbackHost, listen } from "./binding.ts";
import { callbackUrl, createAuthRouter } from "./routes/auth.ts";
import { clientFreshness, freshnessWarning } from "./client-freshness.ts";
import { adminRouter } from "./routes/admin.ts";
import { createGuildsRouter } from "./routes/guilds.ts";
import { identityRouter } from "./routes/identity.ts";
import { appearanceRouter, publicAppearanceRouter } from "./routes/appearance.ts";
import { serviceKeysRouter } from "./routes/service-keys.ts";
import { tunablesRouter } from "./routes/tunables.ts";
import type { PlayerStream } from "./player-stream.ts";
import { problemsRouter } from "./problem.ts";
import { limiter, unlimited } from "./rate-limits.ts";
import { startStatus } from "./status/index.ts";
import { PROJECT } from "../infra/project-paths.ts";

/** 조립이 넘기는 것. sessionMiddleware · clientDist(빌드한 화면) 는 시험이 바꿔 넘긴다 */
type AppDeps = { stream: PlayerStream; deployCommands: Express.Locals["deployCommands"]; sessionMiddleware?: RequestHandler; clientDist?: string };

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
function createApp(bot: BotContext, { stream, deployCommands, sessionMiddleware = createSessionMiddleware(), clientDist = PROJECT.dashboardDist }: AppDeps) {
  const app = express();
  const { host, url } = config.dashboard;

  // X-Forwarded-* 는 사설망 프록시가 보낸 것만 믿는다(같은 기기나 LAN 의 Caddy).
  // 공인 주소에서 바로 온 헤더는 무시하므로 클라이언트가 값을 꾸며낼 수 없다.
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
  app.disable("x-powered-by"); // 서버 스택을 광고하지 않는다

  app.use(securityHeaders);
  app.use(plaintextAccessWarner(host));

  // 오류 코드의 설명(type 의 주소). 화면(SPA) 폴백보다 앞에
  app.use(problemsRouter);
  // 파비콘 · 매니페스트(로그인 없이). 화면 폴백보다 앞에
  app.use(publicAppearanceRouter);

  // 정적 자산과 SPA 폴백은 세션보다 앞에 둔다. 세션 스토어(SQLite)가 죽어도 앱 껍데기는 떠서
  // 오류를 화면에 표시할 수 있어야 한다. 세션 뒤에 두면 CSS/JS까지 500이라 백지가 된다.
  // 빌드가 있는지는 요청 때 본다. 봇을 켠 뒤 빌드해도 다시 켜지 않고 보인다
  const indexHtml = path.join(clientDist, "index.html");
  app.use(express.static(clientDist));
  app.get("/{*path}", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/auth")) return next();
    if (!fs.existsSync(indexHtml)) return res.send("<h2>대시보드 화면이 빌드되지 않았어요.<br>봇 폴더에서 <code>pnpm run build:dashboard</code> 를 실행한 뒤 새로고침하세요.</h2>");
    res.sendFile(indexHtml);
  });

  app.use(bodyLimit());
  app.use(cors(createCorsOptions(url, { allowDevOrigin: config.dashboard.devOrigin })));
  app.use(sessionMiddleware);
  app.get("/api/csrf-token", issueCsrfToken);
  app.use(requireCsrfToken);

  // 라우트에서 디스코드 클라이언트 · 플레이어 · 패널을 쓸 수 있게
  app.locals.bot = bot;
  app.locals.deployCommands = deployCommands;
  app.locals.stream = stream;

  // ── API 요청 제한. 라우트 마운트보다 먼저 등록 ──
  const rl = config.dashboard.rateLimit;
  // 일반 인증 API. 정상 사용(폴링 12/분, 플레이리스트 1요청)을 넉넉히 넘는 값. 실시간 연결 · 음량은 뺀다(rate-limits)
  app.use(
    "/api",
    limiter(() => rl.apiMax, { skip: unlimited }),
  );
  // 로그인/OAuth. 세션 전이라 IP 로 센다
  app.use(
    "/auth",
    limiter(() => rl.authMax, { windowOf: () => rl.authWindowMs, byIp: true }),
  );

  // 로그인 관련(/auth/login · /auth/callback · /auth/logout)
  app.use("/auth", createAuthRouter());

  // API 라우트
  app.use("/api/admin/appearance", appearanceRouter);
  app.use("/api/admin/service-keys", serviceKeysRouter);
  app.use("/api/admin/tunables", tunablesRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/guilds", createGuildsRouter({ stream }));

  // 지금 로그인한 사람(/api/me) · 로그인 전 화면이 쓰는 봇의 공개 정보(/api/bot)
  app.use("/api", identityRouter);

  app.use(notFoundJson);
  app.use(errorHandler);

  return app;
}

function startDashboard(bot: BotContext, { stream, deployCommands }: AppDeps) {
  const app = createApp(bot, { stream, deployCommands });
  // 봇 상태 탭의 측정 · 최근 15분 · 게이트웨이 재수립은 화면을 열기 전부터 모은다
  startStatus(bot);

  listen(app, config.dashboard, () => {
    // 로그인이 디스코드 승인 화면에서 막히면(콜백 주소 미등록) 봇은 알 길이 없다. 등록할 주소를 늘 보인다
    log.info(`디스코드 개발자 포털 OAuth2 → Redirects 에 등록할 주소: ${callbackUrl()}`);
    // 업데이트 뒤 화면을 다시 빌드하지 않으면 옛 화면이 새 서버와 어긋난다(pnpm install 은 의존성이 그대로면 빌드를 건너뛴다)
    const stale = freshnessWarning(clientFreshness(PROJECT.dashboardDist, PROJECT.root));
    if (stale) log.warn(stale);
    // 평상시 실행과 다른 상태로 떠 있다는 것은 드러나 있어야 한다
    if (config.dashboard.devOrigin) log.warn("개발 모드. Vite 개발 서버(http://localhost:5173)의 요청을 허용합니다.");
  });

  return app;
}

export { startDashboard, createApp };
