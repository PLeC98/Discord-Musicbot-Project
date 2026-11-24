// 대시보드 경로 테스트 헬퍼. 로그인한 사용자를 세션에 꽂고, 경로에 JSON으로 요청한다.

import type { NextFunction, Request, Response } from "express";
import { fake } from "./fake.ts";
import type { RuleProblem } from "../../src/rules/rule-problem.ts";
import { logRuleLine } from "../../src/rules/text/index.ts";

/** 세션에 사용자를 꽂는 미들웨어. 요청마다 user()를 읽는다(테스트가 도중에 바꾼다). null이면 로그인 전. 로그인 시각은 방금(위험한 조작도 받는다) */
function signedInAs(user: () => object | null) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.session = fake<Request["session"]>({ user: user(), loginAt: Date.now() });
    next();
  };
}

/**
 * 경로에 JSON으로 요청한다. 받은 본문(json)은 호출부가 읽는 형식(T)으로 본다. 읽을 때 JSON이 아니면 예외를 던진다
 * (상태만 보는 테스트는 본문이 JSON이 아니어도 된다). timeoutMs를 주면 응답이 없을 때 기다리지 않고 실패한다
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
        throw new Error(`JSON이 아닌 응답(${res.status}): ${text.slice(0, 80)}`);
      }
    },
  };
}

/** 문제 응답(RFC 9457)에서 테스트가 읽는 필드 */
type ProblemReply = { type?: string; code?: string; status?: number; title?: string; detail?: string; errors?: Array<{ pointer?: string; code: string; rule?: RuleProblem; detail?: string }> };

/** 문제 응답의 운영자용 원문(detail과 필드별 detail, 필드별 규칙 문제는 로그 언어로 그린 것)을 줄로 이은 글 */
const detailsOf = (json: ProblemReply) => [json.detail, ...(json.errors ?? []).map((one) => (one.rule ? logRuleLine(one.rule) : one.detail))].filter(Boolean).join("\n");

export { signedInAs, requestJson, detailsOf };
export type { ProblemReply };
