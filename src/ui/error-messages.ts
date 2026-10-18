import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "error" });
import { errorKind, messageOf } from "../rules/error-kind.ts";
import * as errors from "./text/ko/errors.ts";
import config from "../config/index.ts";
import { isCode, type Code, type Problem } from "../rules/problems.ts";

// 곡을 찾거나 담지 못한 결과. 여기서 읽는 필드만. code 는 문제 목록의 코드이거나 흐름의 코드(lookup-failed · play-failed · play-threw 등),
// kind 는 오류로 못 했을 때 그 오류의 종류, skipped 는 받을 수 없어 뺀 곡 수
type AddFailure = { code: string; kind?: Code; skipped?: number };
// 오류로 못 한 까닭. 오류 종류를 모르면 unknown-error 의 안내다
const THROWN = new Set(["lookup-failed", "play-threw"]);

/** 오류 → 사용자에게 보일 안내. 종류는 rules/error-kind 가 구분한다 */
function errorMessage(error: unknown) {
  return errors.notice(errorKind(error));
}

/** 곡을 찾거나 담지 못한 결과 → 문제. 목록의 코드면 그 코드, 오류로 못 했으면 오류 종류, 아니면 곡을 틀 수 없다고 */
function addFailure({ code, kind, skipped }: AddFailure): Problem {
  if (isCode(code)) return { code, skipped, max: config.bot.maxQueueSize };
  if (kind || THROWN.has(code)) return { code: kind ?? "unknown-error" };
  return { code: "cannot-start" };
}

/** 곡을 찾거나 담지 못한 결과 → 안내 */
function addFailureMessage(result: AddFailure) {
  const { code, ...params } = addFailure(result);
  return errors.notice(code, params);
}

/** 처리하지 못한 오류를 남기고 사용자 안내를 돌려준다(catch 블록에서) */
function reportError(error: unknown, context = "") {
  // context → sub(하위 카테고리), 분류 결과 → kind(구조화 필드, 터미널 배지엔 안 뜸)
  log.error({ sub: context || undefined, kind: errorKind(error) }, messageOf(error));
  return errorMessage(error);
}

export { errorMessage, addFailure, addFailureMessage, reportError };
