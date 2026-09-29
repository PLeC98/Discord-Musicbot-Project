import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "error" });
import { errorKind, messageOf } from "../rules/errorKind.ts";
import * as errors from "./text/errors.ts";
import config from "../../config.ts";

// 곡을 찾거나 담지 못한 결과. 여기서 읽는 칸만. kind 는 오류로 못 했을 때 그 오류의 종류, skipped 는 받을 수 없어 뺀 곡 수
type AddFailure = { code: string; kind?: string; skipped?: number };
// 오류로 못 한 까닭. 오류 종류를 모르면 unknown 의 문장이다
const THROWN = new Set(["lookup-failed", "play-threw"]);

/** 오류 → 사용자에게 보일 문장. 종류는 rules/errorKind 가 가른다 */
function errorMessage(error: unknown) {
  return errors.forKind(errorKind(error));
}

/** 곡을 찾거나 담지 못한 결과 → 안내문. 까닭의 문장이 없으면 오류 종류로, 오류가 아니면 곡을 틀 수 없다고 */
function addFailureMessage({ code, kind, skipped }: AddFailure) {
  const said = errors.addRefusal(code, { skipped, max: config.bot.maxQueueSize });
  if (said) return said;
  if (kind || THROWN.has(code)) return errors.forKind(kind ?? "unknown");
  return errors.cannotStart();
}

/** 처리하지 못한 오류를 남기고 사용자 문장을 돌려준다(catch 블록에서) */
function reportError(error: unknown, context = "") {
  // context → sub(하위 카테고리), 분류 결과 → kind(구조화 필드, 터미널 배지엔 안 뜸)
  log.error({ sub: context || undefined, kind: errorKind(error) }, messageOf(error));
  return errorMessage(error);
}

export { errorMessage, addFailureMessage, reportError };
