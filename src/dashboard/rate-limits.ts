// 요청 제한(express-rate-limit). 일반 API · 로그인 · 음량 · 곡 넣기가 같은 모양을 쓰고 한도만 다르다

import type { Request } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import config from "../config/index.ts";
import { tooManyRequests } from "./problem.ts";

// 로그인한 사람으로 센다. 로그인 전에는 IP(trust proxy 가 사설망 한정이라 믿을 수 있다)
const userOrIp = (req: Request) => req.session?.user?.id || ipKeyGenerator(req.ip ?? "");

// 일반 API 한도에서 빼는 경로. 실시간 연결은 오래 붙어 있고, 음량은 끄는 동안 잇달아 와서 재생 경로가 따로 센다
const UNLIMITED = [/^\/api\/admin\/logs\/stream$/, /^\/api\/guilds\/events$/, /^\/api\/guilds\/[^/]+\/player\/(?:events|volume)$/];

/** 일반 API 한도에서 빼는 요청인가(주소의 경로로 본다) */
const unlimited = (req: Pick<Request, "originalUrl">) => UNLIMITED.some((re) => re.test(req.originalUrl.split("?")[0]));

/** 한도 하나. 기본은 로그인한 사람마다 API 창으로 센다. byIp 면 IP 로(로그인 전 경로) */
function limiter(limit: number, { windowMs, byIp = false, skip }: { windowMs?: number; byIp?: boolean; skip?: (req: Request) => boolean } = {}) {
  return rateLimit({
    windowMs: windowMs ?? config.dashboard.rateLimit.windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    ...(byIp ? {} : { keyGenerator: userOrIp }),
    handler: tooManyRequests,
    skip,
  });
}

export { limiter, unlimited };
