// 재생 조작(usecases/controls)이 거절한 문제(코드와 값)를 디스코드 안내로. 대시보드는 문제 응답(src/dashboard/problem)으로 받는다

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "control" });
import * as errors from "./text/ko/errors.ts";
import type { Problem } from "../rules/problems.ts";

/** 거절 결과({ ok: false, code, …값 })의 안내. 코드마다 드는 값은 타입이 맞췄지만 코드가 실행 중에 정해져 그리기 전에 한 번 더 견준다 */
function controlMessage({ code, ...params }: Problem) {
  return errors.noticeFor(code, params, errors.PLAIN, (names) => log.warn(`안내 문구 템플릿 변수가 누락되어 기본 오류 메시지로 대체합니다: ${code} (${names.join(", ")})`));
}

export { controlMessage };
