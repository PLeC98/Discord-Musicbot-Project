// 재생 조작(usecases/controls)이 거절한 까닭(code)을 안내로. 디스코드는 응답 틀(ui/frame)로 그리고,
// 대시보드는 머리 줄 · 본문의 글자와 HTTP 상태 코드로 쓴다. 권한 거절은 권한 판정이 막은 까닭(permission)의 안내다.

import { plainText } from "./frame.ts";
import * as errors from "./text/ko/errors.ts";
import type { Refusal } from "./text/ko/errors.ts";

// 대시보드의 HTTP 상태. 입력이 틀린 것은 400, 권한은 403, 지금 상태로는 못 하는 것은 409
const STATUS: Record<string, number> = { "no-permission": 403, "beyond-end": 400, "bad-volume": 400, "bad-loop-mode": 400, "bad-position": 400, "same-position": 400, "unknown-genre": 400 };

/** 거절 결과({ ok: false, code, … })의 안내 */
function controlMessage(result: Refusal) {
  if (result.code === "no-permission" && result.permission) return errors.permission(result.permission);
  return errors.refusal(result);
}

/** 거절 결과를 대시보드 응답으로 { status, error } */
function controlApiError(result: Refusal) {
  return { status: STATUS[result.code] ?? 409, error: plainText(controlMessage(result)) };
}

export { controlMessage, controlApiError };
export type { Refusal };
