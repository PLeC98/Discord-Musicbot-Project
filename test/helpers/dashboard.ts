// 대시보드 경로 시험. 로그인한 사용자를 세션에 꽂고, 경로에 JSON 으로 묻는다.

import type { NextFunction, Request, Response } from "express";
import { fake } from "./fake.ts";

/** 세션에 사용자를 꽂는 미들웨어. 요청마다 user() 를 읽는다(시험이 도중에 바꾼다). null 이면 로그인 전 */
function signedInAs(user: () => object | null) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.session = fake<Request["session"]>({ user: user() });
    next();
  };
}

/**
 * 경로에 JSON 으로 묻는다. 받은 본문(json)은 부르는 쪽이 읽는 모양(T)으로 본다. 읽을 때 JSON 이 아니면 던진다
 * (상태만 보는 시험은 본문이 JSON 이 아니어도 된다). timeoutMs 를 주면 응답이 없을 때 기다리지 않고 실패한다
 */
async function requestJson<T>(base: string, method: string, urlPath: string, body?: unknown, { timeoutMs }: { timeoutMs?: number } = {}): Promise<{ status: number; json: T }> {
  const res = await fetch(base + urlPath, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return {
    status: res.status,
    get json(): T {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`JSON 이 아닌 답(${res.status}): ${text.slice(0, 80)}`);
      }
    },
  };
}

export { signedInAs, requestJson };
