// 재생 조작(usecases/controls)이 거절한 문제(코드와 값)를 디스코드 안내로. 대시보드는 문제 응답(src/dashboard/problem)으로 받는다

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "control" });
import type { BotText } from "./text/index.ts";
import type { Problem } from "../rules/problems.ts";
import { L } from "../infra/log/text.ts";

/** 거절 결과({ ok: false, code, …값 })의 안내. T는 보낼 곳의 독자에 맞는 문구표(ui/language). 코드마다 들어가는 값은 타입으로 맞췄지만 코드가 실행 중에 정해져 그리기 전에 한 번 더 검사한다 */
function controlMessage(T: BotText, { code, ...params }: Problem) {
  return T.errors.noticeFor(code, params, T.errors.PLAIN, (names) => log.warn(L.control.noticeTemplateVarsMissing({ code, names: names.join(", ") })));
}

export { controlMessage };
