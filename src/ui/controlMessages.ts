// 재생 조작(usecases/controls)이 거절한 문제(코드와 값)를 안내로. 디스코드는 응답 틀(ui/frame)로 그리고,
// 대시보드는 머리 줄 · 본문의 글자와 문제 목록(rules/problems)의 HTTP 상태로 쓴다

import { plainText } from "./frame.ts";
import * as errors from "./text/ko/errors.ts";
import { PROBLEMS, type Problem } from "../rules/problems.ts";

/** 거절 결과({ ok: false, code, …값 })의 안내 */
const controlMessage = (result: Problem) => errors.notice(result.code, result);

/** 거절 결과를 대시보드 응답으로 { status, error } */
function controlApiError(result: Problem) {
  return { status: PROBLEMS[result.code].status, error: plainText(controlMessage(result)) };
}

export { controlMessage, controlApiError };
