import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });
import crypto from "crypto";
import express, { type Express as App, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { BotContext } from "../app/bot-context.ts";
import session from "express-session";
import cors from "cors";
import path from "path";
import fs from "fs";

import { createCorsOptions } from "./cors.ts";
import { bodyLimit, closeOnUnreadBody, continueBody } from "./body-limit.ts";
import { SqliteSessionStore } from "./session-store.ts";
import { sessionCookieName } from "./cookies.ts";
import * as sessionRequests from "./session-requests.ts";
import { requireSameAccount } from "./middleware/same-account.ts";
import { issueCsrfToken, requireCsrfToken } from "./middleware/csrf.ts";
import { securityHeaders } from "./middleware/security-headers.ts";
import { errorHandler, notFoundJson } from "./middleware/error-handler.ts";
import { isLoopbackHost, listen } from "./binding.ts";
import { callbackUrl, createAuthRouter } from "./routes/auth.ts";
import { clientFreshness, freshnessWarning } from "./client-freshness.ts";
import { withGuildName } from "./routes/ai-log.ts";
import { ADMIN_MOUNTS } from "./routes/admin-mounts.ts";
import { requireOwner } from "./middleware/require-owner.ts";
import * as aiLogStream from "./ai-log-stream.ts";
import * as aiRequests from "../store/ai-requests.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { createGuildsRouter } from "./routes/guilds.ts";
import { identityRouter } from "./routes/identity.ts";
import { appEmojisRouter } from "./routes/app-emojis.ts";
import { createLoginDevicesRouter } from "./routes/login-devices.ts";
import { noteDevice } from "./login-devices.ts";
import * as geoip from "./geoip.ts";
import { publicAppearanceRouter } from "./routes/appearance.ts";
import { publicLoginBackgroundRouter } from "./routes/login-background-public.ts";
import * as loginBackground from "./login-background/runner.ts";
import { startEncoderCheck } from "./login-background/encoders.ts";
import { registerStages } from "./login-background/stages.ts";
import { createInviteRouter } from "./routes/invite.ts";
import { sweepUploads } from "./archive-uploads.ts";
import type { PlayerStream } from "./player-stream.ts";
import { problemsRouter } from "./problem.ts";
import { CSRF_TOKEN_MAX, limiter, signedInLogout, unlimited } from "./rate-limits.ts";
import { startStatus } from "./status/index.ts";
import { countServer } from "../infra/upload-meter.ts";
import { PROJECT } from "../infra/project-paths.ts";
import { precompressed } from "./precompressed.ts";
import { trustProxy } from "./client-ip.ts";
import { browserSide, strictTransport } from "./browser-side.ts";
import { hostCheck } from "./host-check.ts";

/** 조립이 넘기는 것. sessionMiddleware, clientDist(빌드한 화면) 는 테스트가 바꿔 넘긴다 */
type AppDeps = { stream: PlayerStream; deployCommands: Express.Locals["deployCommands"]; restart?: Express.Locals["restart"]; sessionMiddleware?: RequestHandler; clientDist?: string };

// 세션 비밀: .env의 SESSION_SECRET이 표준 경로. 미설정이면 랜덤 폴백.
// 보안은 유지되지만(추측 불가) 다시 시작할 때마다 쿠키 서명이 무효화되어 대시보드 로그인이 풀린다.
function resolveSessionSecret() {
  if (config.dashboard.sessionSecret) {
    if (config.dashboard.sessionSecret.length < 32) {
      log.warn("SESSION_SECRET이 너무 짧습니다 (32자 미만). 64자 이상 랜덤 문자열을 권장합니다.");
    }
    return config.dashboard.sessionSecret;
  }
  log.warn("SESSION_SECRET이 없어 랜덤 값을 사용합니다. 봇을 다시 시작할 때마다 대시보드 로그인이 전부 풀립니다.");
  return crypto.randomBytes(32).toString("hex");
}

// 평문 접속 감지. 주 방어선이 아니다. 요청이 들어온 시점이면 세션 쿠키는 이미 평문으로
// 오간 뒤라 문구도 사후 조치를 안내한다. 설정을 https로 적어놓고 실제로는 평문인 경우의 안전망.
// 대시보드 주소가 https인데 평문으로 보이면 앞단의 프록시를 신뢰하지 않는 상태다(공인 IP의 프록시인데 DASHBOARD_TRUST_PROXY에 없음). 쿠키에 Secure, __Host-가 빠진다
function plaintextAccessWarner(host: string, url: string): RequestHandler {
  if (isLoopbackHost(host)) return (_req, _res, next) => next();

  let warned = false;
  const https = /^https:/i.test(url);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!warned && !req.secure) {
      warned = true;
      if (https) log.warn("DASHBOARD_URL은 https인데 이 연결은 평문으로 보입니다. 앞단의 프록시를 신뢰하지 않으면 X-Forwarded-Proto를 무시해 로그인 쿠키가 Secure, __Host- 없이 나갑니다. 프록시가 공인 IP로 연결되면 그 주소를 .env의 DASHBOARD_TRUST_PROXY에 추가하세요(내부 주소는 자동으로 신뢰합니다).");
      else log.warn("평문 HTTP 연결로 접속됨. 세션 쿠키가 암호화 없이 오갔습니다. HTTPS 설정 후 SESSION_SECRET을 변경해 기존 세션을 무효화하세요.");
    }
    next();
  };
}

/** 신뢰하는 프록시를 설정한다(dashboard/client-ip). 내부 주소는 자동으로, 공인 IP의 원격 프록시는 DASHBOARD_TRUST_PROXY로 신뢰한다. 거부한 값과 필요 없는 값은 기동 로그용으로 돌려준다 */
function applyTrustProxy(app: App, value: string) {
  const { trust, accepted, inside, rejected } = trustProxy(value);
  app.set("trust proxy", (addr: string) => trust(addr));
  return { accepted, inside, rejected };
}

/** 신뢰하는 프록시 설정 결과의 기동 로그 */
function logTrustProxy({ accepted, inside, rejected }: Pick<ReturnType<typeof trustProxy>, "accepted" | "inside" | "rejected">) {
  if (rejected.length) log.warn(`DASHBOARD_TRUST_PROXY에서 유효하지 않은 값을 제외했습니다: ${rejected.join(", ")}. 공인 IP의 프록시만 IP나 CIDR로 지정하세요(모든 주소를 신뢰하는 값은 허용하지 않습니다).`);
  if (inside.length) log.info(`기본으로 신뢰하는 내부 주소는 DASHBOARD_TRUST_PROXY에서 생략해도 됩니다(loopback, 사설망, 이 기기의 주소): ${inside.join(", ")}`);
  if (accepted.length) log.info(`신뢰하는 원격 프록시: ${accepted.join(", ")}`);
}

// 로그인 세션. SQLite 영속 스토어라 다시 시작해도 로그인이 유지된다(SESSION_SECRET이 .env에 고정일 때.
// 랜덤 폴백이면 쿠키 서명이 무효화되어 어차피 풀림. resolveSessionSecret 경고 참조).
// 쿠키 이름은 요청마다 다르다: HTTPS면 __Host- 이름을 쓴다(dashboard/cookies). express-session은 미들웨어당 이름을 하나만 받으므로 같은 저장소를 공유하는 미들웨어 둘을 만들어 선택한다.
// 두 미들웨어의 설정은 이름 외에는 같아야 한다: express-session은 생성할 때마다 저장소의 세션 생성 함수(generate)를 덮어쓰므로 나중에 만든 쪽의 쿠키 설정이 모든 요청에 적용된다.
// 세션을 만들 때 쿠키의 Secure와 createdOverHttps를 브라우저 쪽 판정(req.secure, dashboard/browser-side)으로 정한다. 쿠키 이름과 같은 판정이다
// (express-session의 "auto"는 소켓이 TLS면 신뢰하는 프록시가 http라고 알려도 Secure를 붙여, 평문으로 접속한 브라우저가 쿠키를 받지 않는다).
// 다른 쪽 이름으로 온 세션은 받지 않는다: 평문에서 가로챈 세션 id를 __Host- 이름으로 HTTPS 요청에 보내지 못한다.
// 받지 않은 세션은 저장소에서 삭제하고 새 세션으로 바꾼다(가로챈 id라면 원래 브라우저의 로그인도 끝난다). 이 값이 없는 세션은 평문으로 만든 것으로 본다
// store, secret은 테스트에서 넘긴다(임시 DB). 생략하면 로그인 세션 DB와 설정의 비밀값을 쓴다
function createSessionMiddleware({ store = new SqliteSessionStore(), secret = resolveSessionSecret() }: { store?: SqliteSessionStore; secret?: string } = {}): RequestHandler {
  const options = {
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // 세션을 만들 때 브라우저 쪽 판정으로 덮어쓴다(아래 generate). http://localhost 같은 평문에서는 Secure가 빠져서 로컬 테스트가 그대로 된다
      secure: "auto" as const,
      sameSite: "lax" as const,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  };
  const secure = session({ ...options, name: sessionCookieName(true) });
  const plain = session({ ...options, name: sessionCookieName(false) });
  const generate = store.generate;
  store.generate = (req) => {
    generate.call(store, req);
    req.session.cookie.secure = req.secure;
    req.session.createdOverHttps = req.secure;
  };
  return (req, res, next) =>
    (req.secure ? secure : plain)(req, res, (err?: unknown) => {
      if (err || !req.session || (req.session.createdOverHttps === true) === req.secure) return next(err);
      const how = req.secure ? "평문에서 만든 세션이 HTTPS 요청으로" : "HTTPS에서 만든 세션이 평문 요청으로";
      log.info(`${how} 와서 받지 않고 삭제했습니다(사용자 ${req.session.user?.id ?? "없음"}).`);
      req.session.regenerate((e) => next(e));
    });
}

// 빌드한 화면 파일(assets/ 아래)은 이름이나 경로에 내용 해시, 판이 붙어 바뀌면 이름도 바뀐다. 한 해 동안 묻지 않고 쓰게 한다(글꼴, 스크립트, 스타일, 이모지 그림).
// index.html 처럼 이름이 고정된 파일은 매번 바뀌었는지 묻는다(그래야 새 빌드의 새 이름을 받는다)
const ASSETS = /[\\/]assets[\\/]/;
// 공개 요청 제한에서 건너뛰는 경로(아래에서 따로 센다)와, 그중 세션 미들웨어 앞에서 응답하는 공개 경로. Express처럼 대소문자와 끝의 /를 가리지 않는다
const COUNTED_LATER = /^\/(?:api|auth)(?:\/|$)/i;
const PUBLIC_API = /^\/api\/login-background\/?$/i;
function cacheAssets(res: Response, file: string) {
  res.setHeader("Cache-Control", ASSETS.test(file) ? "public, max-age=31536000, immutable" : "no-cache");
}

// 미들웨어 등록만 하고 listen은 하지 않는다. 등록 순서 자체를 지켜야 해서(정적 자산이
// 세션보다 앞, 오류 핸들러가 맨 뒤) 테스트가 실제 앱을 임의 포트에 열어 검증한다.
// sessionMiddleware: 로그인 세션. 기본은 SQLite 세션이고, 테스트가 저장소가 죽은 상태를 넘긴다
// deployCommands: 슬래시 명령 등록(운영자의 재등록 버튼), restart: 봇 다시 시작(실행기로 켰을 때만). 조립이 넘긴다
function createApp(bot: BotContext, { stream, deployCommands, restart = null, sessionMiddleware = createSessionMiddleware(), clientDist = PROJECT.dashboardDist }: AppDeps) {
  const app = express();
  const { host, url } = config.dashboard;

  // X-Forwarded-*는 신뢰하는 홉이 보낸 것만 읽는다(내부 주소, DASHBOARD_TRUST_PROXY). 사용자 IP는 dashboard/client-ip의 clientIp
  applyTrustProxy(app, config.dashboard.trustProxy);
  // req.secure, req.protocol을 브라우저 쪽 판정으로 바꾼다. 이것을 읽는 쿠키, 세션, 평문 경고보다 앞에 둔다
  app.use(browserSide(url));
  app.disable("x-powered-by"); // 서버 스택을 광고하지 않는다

  // 본문을 다 받지 않은 채 응답하면 연결을 닫는다(응답 헤더를 쓸 때 판단하므로 맨 앞에 둔다)
  app.use(closeOnUnreadBody);
  // 소켓의 마지막 요청을 기록한다(세션이 끝나 소켓을 닫을 때 keep-alive의 다음 요청을 건드리지 않게 한다). 정적 파일 미들웨어보다 앞에 둔다
  app.use(sessionRequests.noteSocket);
  app.use(securityHeaders);
  app.use(strictTransport(url));
  // 허용하지 않은 호스트로 온 요청(DNS 리바인딩)을 막는다. 정적 파일, 세션보다 앞에 둔다
  app.use(hostCheck(url));
  app.use(plaintextAccessWarner(host, url));
  // 로그인 없이 받는 경로(오류 설명, 파비콘, 로그인 배경, 화면 폴백)의 요청 제한. 세션 전이라 IP로 센다. /api, /auth는 아래에서 따로 센다
  // (세션 앞에서 응답하는 /api의 공개 경로와, 아래 CORS가 집계 전에 응답하는 OPTIONS는 여기서 센다). 빌드한 화면 파일(assets/)은 세지 않는다. 브라우저가 한 번 캐시하면 재요청하지 않고, 이모지 선택기는 이미지 1900여 장을 한 장씩 받는다
  app.use(limiter(() => config.dashboard.rateLimit.publicMax, { byIp: true, skip: (req) => (COUNTED_LATER.test(req.path) && !PUBLIC_API.test(req.path) && req.method !== "OPTIONS") || ASSETS.test(req.path) }));

  // 오류 코드의 설명(type 의 주소). 화면(SPA) 폴백보다 앞에
  app.use(problemsRouter);
  // 파비콘, 매니페스트(로그인 없이). 화면 폴백보다 앞에
  app.use(publicAppearanceRouter);
  // 로그인 배경의 배경 정보, 파일(로그인 없이). 화면 폴백보다 앞에
  app.use(publicLoginBackgroundRouter);

  // 정적 자산과 SPA 폴백은 세션보다 앞에 둔다. 세션 스토어(SQLite)가 죽어도 앱 껍데기는 떠서
  // 오류를 화면에 표시할 수 있어야 한다. 세션 뒤에 두면 CSS/JS까지 500이라 백지가 된다.
  // 빌드가 있는지는 요청 때 본다. 봇을 켠 뒤 빌드해도 다시 시작하지 않고 보인다
  const indexHtml = path.join(clientDist, "index.html");
  // 빌드할 때 만들어 둔 압축본(.br, .gz)을 먼저, 없거나 받을 수 없으면 원본
  app.use(precompressed(clientDist, cacheAssets));
  app.use(express.static(clientDist, { setHeaders: cacheAssets }));
  app.get("/{*path}", (req, res, next) => {
    if (COUNTED_LATER.test(req.path)) return next();
    if (!fs.existsSync(indexHtml)) return res.send("<h2>대시보드 화면이 빌드되지 않았어요.<br>봇 폴더에서 <code>pnpm run build:dashboard</code> 를 실행한 뒤 새로고침하세요.</h2>");
    res.sendFile(indexHtml, { headers: { "Cache-Control": "no-cache" } });
  });

  app.use(cors(createCorsOptions(url, { allowDevOrigin: config.dashboard.devOrigin })));
  app.use(sessionMiddleware);
  // 로그인한 요청을 그 세션에 묶는다(세션이 끝나면 진행 중인 요청을 멈춘다, 끝난 세션과 로그인하지 않은 세션은 저장하지 않는다)
  app.use(sessionRequests.bind);

  // ── 요청 제한. 사용자별로 세기 위해 세션 뒤에 두고, 기기 기록, CSRF 검사, 본문 읽기보다는 앞에 둔다(제한에 걸린 요청은 뒤쪽 처리를 하지 않는다) ──
  const rl = config.dashboard.rateLimit;
  // 일반 API. 정상 사용(폴링 12/분, 플레이리스트 1요청)을 넉넉히 넘는 값. 로그인한 요청의 SSE 연결, 볼륨, 곡 추가 입력란의 검색, 앨범아트, CSRF 토큰 발급은 뺀다(rate-limits)
  app.use(
    "/api",
    limiter(() => rl.apiMax, { skip: unlimited }),
  );
  // CSRF 토큰 발급은 따로 센다(일반 한도가 차도 발급하되 무제한은 아니게 한다)
  app.use(
    "/api/csrf-token",
    limiter(() => CSRF_TOKEN_MAX),
  );
  // 로그인/OAuth. IP로 센다. 로그인한 사용자의 로그아웃은 뺀다
  app.use(
    "/auth",
    limiter(() => rl.authMax, { windowOf: () => rl.authWindowMs, byIp: true, skip: signedInLogout }),
  );

  // 로그인한 기기 기록(마지막 활동, IP). 몇 분마다만 세션을 다시 쓴다
  app.use(noteDevice);
  // 탭이 알고 있는 사용자와 세션의 사용자가 다르면 409를 반환한다(다른 탭에서 다른 계정으로 로그인한 경우). CSRF 검사보다 앞에 둔다
  app.use(requireSameAccount);
  app.get("/api/csrf-token", issueCsrfToken);
  app.use(requireCsrfToken);
  // 운영자 패널 공통 권한 검사. 하위 라우터마다 운영자 검사를 하지만, 누락된 라우터가 없도록 여기서도 한 번 막는다. 본문을 읽기 전에 둔다(큰 본문 경로는 모두 운영자 패널이다)
  app.use("/api/admin", requireOwner);
  // 앱 이모지 쓰기(GET이 아닌 요청)도 운영자 전용이므로 본문을 읽기 전에 검사한다(라우트의 검사는 그대로 유지한다)
  app.use("/api/app-emojis", (req, res, next) => (["GET", "HEAD", "OPTIONS"].includes(req.method) ? next() : requireOwner(req, res, next)));
  // 검사를 모두 통과한 요청만 본문을 받는다: 100-continue를 기다리면 이제 100을 보내고, JSON을 파싱한다
  app.use(continueBody);
  app.use(bodyLimit());

  // 라우트에서 디스코드 클라이언트, 플레이어, 패널을 쓸 수 있게
  app.locals.bot = bot;
  app.locals.deployCommands = deployCommands;
  app.locals.stream = stream;
  app.locals.restart = restart;

  // 로그인 관련(/auth/login, /auth/callback, /auth/logout)
  app.use("/auth", createAuthRouter());

  // API 라우트. 운영자 패널은 ADMIN_MOUNTS 목록대로 마운트한다
  for (const [at, router] of ADMIN_MOUNTS) app.use(at, router);
  app.use("/api/guilds", createGuildsRouter({ stream }));
  app.use("/api/invite", createInviteRouter());
  app.use("/api/app-emojis", appEmojisRouter);

  // 지금 로그인한 사용자(/api/me), 로그인 전 화면이 쓰는 봇의 공개 정보(/api/bot)
  app.use("/api/me/devices", createLoginDevicesRouter({ places: geoip }));
  app.use("/api", identityRouter);

  app.use(notFoundJson);
  app.use(errorHandler);

  return app;
}

function startDashboard(bot: BotContext, { stream, deployCommands, restart }: AppDeps) {
  const app = createApp(bot, { stream, deployCommands, restart });
  // 봇 상태 탭의 측정, 최근 15분, 게이트웨이 재연결은 화면을 열기 전부터 모은다
  startStatus(bot);
  // 로그인 배경: 쓸 수 있는 인코더를 뒤에서 테스트하고, 봇이 꺼질 때 하던 단계, 남은 단계를 이어서 한다
  startEncoderCheck();
  registerStages();
  loginBackground.resume();
  // 백업 불러오기: 꺼지기 전에 올려 두고 불러오지 않은 파일을 치운다
  sweepUploads();
  // AI 리퀘스트 로그: 새 기록을 SSE 연결로 보낸다(서버 이름을 붙여). 저장 용량을 줄이면 곧바로 맞춘다
  aiLogStream.start(withGuildName((id) => bot.client.guilds.cache.get(id)?.name ?? id));
  // IP 위치 DB: 자동 업데이트면 새 버전을 다운로드한다(로그인한 기기의 위치)
  geoip.start();
  onTunablesChanged(() => {
    aiLogStream.syncHeartbeat();
    if (aiRequests.isOpen()) aiRequests.rotate(config.aiLog.maxBytes);
  });

  logTrustProxy(trustProxy(config.dashboard.trustProxy));
  const server = listen(app, config.dashboard, () => {
    // 로그인이 디스코드 승인 화면에서 막히면(콜백 주소 미등록) 봇은 알 길이 없다. 등록할 주소를 늘 보인다
    log.info(`디스코드 개발자 포털 OAuth2 → Redirects에 등록할 주소: ${callbackUrl()}`);
    // 업데이트 뒤 화면을 다시 빌드하지 않으면 옛 화면이 새 서버와 어긋난다(pnpm install 은 의존성이 그대로면 빌드를 건너뛴다)
    const stale = freshnessWarning(clientFreshness(PROJECT.dashboardDist, PROJECT.root));
    if (stale) log.warn(stale);
    // 평상시 실행과 다른 상태로 떠 있다는 것은 드러나 있어야 한다
    if (config.dashboard.devOrigin) log.warn("개발 모드. Vite 개발 서버(http://localhost:5173)의 요청을 허용합니다.");
  });
  // 봇 상태 탭의 업로드에 대시보드가 보낸 양을 넣는다
  countServer(server);

  return app;
}

export { startDashboard, createApp, createSessionMiddleware };
