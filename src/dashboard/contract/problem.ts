// 서버와 화면이 주고받는 모양: HTTP 오류 응답(RFC 9457 problem details). 코드는 문제 목록(rules/problems)의 것이고, 사람이 읽을 문장은 화면이 코드로 만든다.
// type 은 /problems/<코드>(대시보드 주소로 풀린다), code 는 같은 코드(한 함수가 둘을 만든다). 문장에 드는 값은 맨 위의 확장 필드에 싣는다

import { PROBLEMS, type Code, type Params, type ProblemSpec } from "../../rules/problems.ts";

const PROBLEM_PATH = "/problems/";

/** 입력란 하나의 문제. pointer 는 요청 본문의 JSON Pointer, detail 은 운영자용 원문 */
type FieldProblem = { pointer?: string; code: Code; detail?: string } & Params;
/** 이번 일의 것. detail 은 개발자 · 운영자용 설명, errors 는 입력란별 문제, 그 밖은 확장 필드(errorId · discordCode 등) */
type Extra = { detail?: string; errors?: FieldProblem[]; [member: string]: unknown };
/** 응답 본문 */
type ProblemBody = { type: string; code: Code; status: number; title: string; detail?: string; errors?: FieldProblem[]; [member: string]: unknown };

/** 응답 본문. 값은 그 코드가 목록에 적은 것만 싣는다 */
function problemBody(code: Code, params: Params = {}, extra: Extra = {}): ProblemBody {
  const spec: ProblemSpec = PROBLEMS[code];
  const values = Object.fromEntries((spec.params ?? []).filter((name) => params[name] !== undefined).map((name) => [name, params[name]]));
  return { type: `${PROBLEM_PATH}${code}`, code, status: spec.status, title: spec.title, ...values, ...extra };
}

/** 본문에서 그 코드의 값만 다시 꺼낸다(problemBody 의 역). 화면이 문장을 만들 때 쓴다 */
function paramsOf(body: Pick<ProblemBody, "code"> & Record<string, unknown>): Params {
  const spec: ProblemSpec = PROBLEMS[body.code];
  const names: readonly string[] = spec.params ?? [];
  return Object.fromEntries(names.filter((name) => body[name] !== undefined).map((name) => [name, body[name]])) as Params;
}

export { PROBLEM_PATH, problemBody, paramsOf };
export type { FieldProblem, Extra, ProblemBody };
