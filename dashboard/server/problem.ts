// 대시보드 HTTP 오류 응답(RFC 9457 problem details). 코드는 문제 목록(rules/problems)의 것이고, 사람이 읽을 문장은 클라이언트가 코드로 만든다.
// type 은 /problems/<코드>(대시보드 주소로 풀린다), code 는 같은 코드(한 함수가 둘을 만든다). 문장에 드는 값은 맨 위의 확장 칸에 싣는다.
// GET /problems/<코드> 는 그 코드의 설명이다(RFC 9457: 열 수 있는 type 은 사람이 읽을 설명을 준다)

import express, { type Request, type Response } from "express";
import type { RateLimitInfo } from "express-rate-limit";
import { PROBLEMS, isCode, type Code, type Params, type Problem, type ProblemSpec } from "../../src/rules/problems.ts";

const PROBLEM_PATH = "/problems/";

/** 입력 칸 하나의 문제. pointer 는 요청 본문의 JSON Pointer, detail 은 운영자용 원문 */
type FieldProblem = { pointer?: string; code: Code; detail?: string } & Params;
/** 이번 일의 것. detail 은 개발자 · 운영자용 설명, errors 는 칸별 문제, 그 밖은 확장 칸(errorId · discordCode 등) */
type Extra = { detail?: string; errors?: FieldProblem[]; [member: string]: unknown };

/** 응답 본문. 값은 그 코드가 목록에 적은 것만 싣는다 */
function problemBody(code: Code, params: Params = {}, extra: Extra = {}): { type: string; code: Code; status: number; title: string; [member: string]: unknown } {
  const spec: ProblemSpec = PROBLEMS[code];
  const values = Object.fromEntries((spec.params ?? []).filter((name) => params[name] !== undefined).map((name) => [name, params[name]]));
  return { type: `${PROBLEM_PATH}${code}`, code, status: spec.status, title: spec.title, ...values, ...extra };
}

/** 문제로 답한다. 상태는 목록의 것 */
function sendProblem(res: Response, code: Code, params?: Params, extra?: Extra) {
  const body = problemBody(code, params, extra);
  return res.status(body.status).type("application/problem+json").json(body);
}

/** 거절 결과(코드와 값)로 답한다 */
function refuseWith(res: Response, { code, ...params }: Problem, extra?: Extra) {
  return sendProblem(res, code, params, extra);
}

/** 요청 제한(express-rate-limit)에 걸렸다. 다시 보낼 수 있을 때까지의 초를 Retry-After 에 */
function tooManyRequests(req: Request & { rateLimit?: RateLimitInfo }, res: Response) {
  const reset = req.rateLimit?.resetTime;
  if (reset) res.set("Retry-After", String(Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000))));
  return sendProblem(res, "too-many-requests");
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** GET /problems/:code 코드의 설명. 없는 코드는 route-not-found */
const problemsRouter = express.Router();
problemsRouter.get(`${PROBLEM_PATH}:code`, (req, res) => {
  const code = req.params.code;
  if (!isCode(code)) return sendProblem(res, "route-not-found");
  const spec = PROBLEMS[code];
  const params = "params" in spec ? spec.params : [];
  const rows = [`<dt>status</dt><dd>${spec.status}</dd>`, `<dt>title</dt><dd>${escapeHtml(spec.title)}</dd>`, ...(params.length ? [`<dt>params</dt><dd>${params.join(", ")}</dd>`] : [])];
  res.type("html").send(`<!doctype html><meta charset="utf-8"><title>${code}</title><h1>${code}</h1><dl>${rows.join("")}</dl>`);
});

export { problemBody, sendProblem, refuseWith, tooManyRequests, problemsRouter, PROBLEM_PATH };
export type { FieldProblem, Extra };
