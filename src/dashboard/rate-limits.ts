// 요청 제한(express-rate-limit). 일반 API, 로그인, 볼륨, 곡 넣기가 같은 모양을 쓰고 한도만 다르다

import type { Request, RequestHandler } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import config from "../config/index.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { tooManyRequests } from "./problem.ts";
import { isEnded } from "./session-requests.ts";

// 로그인한 사용자로 센다. 로그인 전에는 IP(trust proxy 가 사설망 한정이라 믿을 수 있다)
const userOrIp = (req: Request) => req.session?.user?.id || ipKeyGenerator(req.ip ?? "");

// 일반 API 한도에서 빼는 경로와 메서드: SSE 연결(오래 붙어 있다), 볼륨(드래그하는 동안 잇달아 온다), 곡 추가 칸의 검색(치는 대로 온다), 앨범아트(대기열의 것이 한꺼번에 불린다),
// 앱 이모지 이미지와 글꼴(선택기를 열면 한꺼번에 불린다), CSRF 토큰 받기(일반 한도가 차도 받아 로그아웃할 수 있게).
// 볼륨, 검색, 앨범아트, 앱 이모지, 토큰 받기는 따로 센다
const UNLIMITED: Array<[string, RegExp]> = [
  ["GET", /^\/api\/admin\/logs\/stream$/],
  ["GET", /^\/api\/admin\/ai\/logs\/stream$/],
  ["GET", /^\/api\/guilds\/events$/],
  ["GET", /^\/api\/guilds\/[^/]+\/player\/(?:events|search)$/],
  ["POST", /^\/api\/guilds\/[^/]+\/player\/volume$/],
  ["GET", /^\/api\/guilds\/[^/]+\/art\/[^/]+$/],
  ["GET", /^\/api\/app-emojis\/[^/]+$/],
  ["GET", /^\/api\/csrf-token$/],
];

/** 로그인했고 끝나지 않은 세션의 요청인가. 한도에서 빼 주는 것은 이런 요청만이다(그 경로들은 로그인 없이 쓰는 일이 없다) */
const signedInLive = (req: Request) => Boolean(req.session?.user) && !isEnded(req);
const pathOf = (req: Pick<Request, "originalUrl">) => req.originalUrl.split("?")[0];
// GET 경로는 HEAD 도 받는다
const methodIs = (req: Request, method: string) => req.method === method || (method === "GET" && req.method === "HEAD");

/** 일반 API 한도에서 빼는 요청인가 */
const unlimited = (req: Request) => signedInLive(req) && UNLIMITED.some(([method, re]) => methodIs(req, method) && re.test(pathOf(req)));

/** 로그인 한도에서 빼는 요청: 로그인한 사람의 로그아웃(그 한도가 차도 로그아웃은 된다) */
const signedInLogout = (req: Request) => signedInLive(req) && req.method === "POST" && /^\/auth\/logout\/?$/i.test(pathOf(req));

/** CSRF 토큰 받기의 한도(일반 한도 구간마다). 화면은 처음 열 때와 토큰이 끝났을 때만 받는다 */
const CSRF_TOKEN_MAX = 30;

/**
 * 한도 하나. 기본은 로그인한 사용자마다 API 창으로 센다. byIp 면 IP 로(로그인 전 경로).
 * limitOf, windowOf 는 지금 설정을 읽는다. 한도는 요청마다 읽고, 창 길이는 만들 때 정해져 바뀌면 새로 만든다(그동안 센 수는 처음부터)
 */
function limiter(limitOf: () => number, { windowOf = () => config.dashboard.rateLimit.windowMs, byIp = false, skip }: { windowOf?: () => number; byIp?: boolean; skip?: (req: Request) => boolean } = {}): RequestHandler {
  const build = (windowMs: number, rebuilt = false) =>
    rateLimit({
      windowMs,
      limit: () => limitOf(),
      standardHeaders: "draft-7",
      legacyHeaders: false,
      ...(byIp ? {} : { keyGenerator: userOrIp }),
      handler: tooManyRequests,
      skip,
      // 다시 만드는 것은 저장 요청을 처리하는 중이다. 요청마다 새로 만드는 실수를 잡는 검사라 여기서는 끈다
      validate: { creationStack: !rebuilt },
    });
  let windowMs = windowOf();
  let current = build(windowMs);
  onTunablesChanged(() => {
    if (windowOf() === windowMs) return;
    windowMs = windowOf();
    current = build(windowMs, true);
  });
  return (req, res, next) => current(req, res, next);
}

export { limiter, unlimited, signedInLogout, CSRF_TOKEN_MAX };
