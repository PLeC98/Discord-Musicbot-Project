// 요청 제한(express-rate-limit). 일반 API · 로그인 · 볼륨 · 곡 넣기가 같은 모양을 쓰고 한도만 다르다

import type { Request, RequestHandler } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import config from "../config/index.ts";
import { onTunablesChanged } from "../config/tunables-changed.ts";
import { tooManyRequests } from "./problem.ts";

// 로그인한 사람으로 센다. 로그인 전에는 IP(trust proxy 가 사설망 한정이라 믿을 수 있다)
const userOrIp = (req: Request) => req.session?.user?.id || ipKeyGenerator(req.ip ?? "");

// 일반 API 한도에서 빼는 경로. 실시간 연결은 오래 붙어 있고, 볼륨은 끄는 동안 잇달아 와서 재생 경로가 따로 센다
const UNLIMITED = [/^\/api\/admin\/logs\/stream$/, /^\/api\/guilds\/events$/, /^\/api\/guilds\/[^/]+\/player\/(?:events|volume)$/];

/** 일반 API 한도에서 빼는 요청인가(주소의 경로로 본다) */
const unlimited = (req: Pick<Request, "originalUrl">) => UNLIMITED.some((re) => re.test(req.originalUrl.split("?")[0]));

/**
 * 한도 하나. 기본은 로그인한 사람마다 API 창으로 센다. byIp 면 IP 로(로그인 전 경로).
 * limitOf · windowOf 는 지금 설정을 읽는다. 한도는 요청마다 읽고, 창 길이는 만들 때 정해져 바뀌면 새로 만든다(그동안 센 수는 처음부터)
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

export { limiter, unlimited };
