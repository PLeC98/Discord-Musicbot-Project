// 재생 조작(usecases/controls)이 거절한 까닭(code)을 사람이 읽을 문장으로. 디스코드는 문장 그대로,
// 대시보드는 ❌ 를 뗀 문장과 HTTP 상태 코드로 쓴다. 권한 거절은 권한 판정이 막은 까닭(permission)의 문장이다.

import * as errors from "./text/errors.ts";
import type { Refusal } from "./text/errors.ts";

// 대시보드의 HTTP 상태. 입력이 틀린 것은 400, 권한은 403, 지금 상태로는 못 하는 것은 409
const STATUS: Record<string, number> = { "no-permission": 403, "beyond-end": 400, "bad-volume": 400, "bad-loop-mode": 400, "bad-position": 400, "same-position": 400, "unknown-genre": 400 };

/** 거절 결과({ ok: false, code, … })를 디스코드에 보일 문장으로 */
function controlMessage(result: Refusal) {
  if (result.code === "no-permission" && result.permission) return errors.permission(result.permission);
  return errors.refusal(result);
}

/** 거절 결과를 대시보드 응답으로 { status, error } */
function controlApiError(result: Refusal) {
  return { status: STATUS[result.code] ?? 409, error: errors.withoutErrorMark(controlMessage(result)) };
}

export { controlMessage, controlApiError };
export type { Refusal };
