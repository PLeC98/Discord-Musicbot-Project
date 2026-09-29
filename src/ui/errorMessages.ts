import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "error" });
import { errorKind, messageOf } from "../rules/errorKind.ts";
import * as errors from "./text/errors.ts";

// 실패 결과. 여기서 읽는 칸만
type Failure = { code?: string; error?: unknown; message?: string } | null | undefined;

/** 오류 → 사용자에게 보일 문장. 종류는 rules/errorKind 가 가른다 */
function errorMessage(error: unknown) {
  return errors.forKind(errorKind(error));
}

/** play() 의 실패 결과({ ok: false, code, error })를 사용자 문장으로 */
function playFailureMessage(result: Failure) {
  return errors.playFailure(result?.code) || (result?.error ? errorMessage(result.error) : errors.cannotStart());
}

/** 곡 찾기 실패({ code, error? } 또는 곡 찾기가 정한 문장 message) → 안내문 */
function lookupFailureMessage(result: Failure) {
  if (result?.message) return result.message;
  return result?.code === "no-result" ? errors.noResult() : errorMessage(result?.error);
}

/** 처리하지 못한 오류를 남기고 사용자 문장을 돌려준다(catch 블록에서) */
function reportError(error: unknown, context = "") {
  // context → sub(하위 카테고리), 분류 결과 → kind(구조화 필드, 터미널 배지엔 안 뜸)
  log.error({ sub: context || undefined, kind: errorKind(error) }, messageOf(error));
  return errorMessage(error);
}

export { errorMessage, playFailureMessage, lookupFailureMessage, reportError };
