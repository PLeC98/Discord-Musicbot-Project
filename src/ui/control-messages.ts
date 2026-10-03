// 재생 조작(usecases/controls)이 거절한 문제(코드와 값)를 디스코드 안내로. 대시보드는 문제 응답(src/dashboard/problem)으로 받는다

import * as errors from "./text/ko/errors.ts";
import type { Problem } from "../rules/problems.ts";

/** 거절 결과({ ok: false, code, …값 })의 안내 */
const controlMessage = (result: Problem) => errors.notice(result.code, result);

export { controlMessage };
