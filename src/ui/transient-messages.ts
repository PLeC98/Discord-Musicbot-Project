// 잠시 표시됐다가 스스로 삭제될 봇 메시지. 현재 재생 메시지가 "묻혔는지" 셀 때 빼기 위해 기억한다.
// 삭제하기로 한 시각이 지나면 잊는다(삭제가 실패해 남았다면 그때부터는 보통 메시지로 센다).

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "player" });
import { errorKind, messageOf } from "../rules/error-kind.ts";

const SLACK_MS = 5000;
const until = new Map<string, number>(); // messageId → 잊을 시각

function prune(now: number) {
  for (const [id, t] of until) if (t <= now) until.delete(id);
}

/** ms 뒤 삭제될 메시지로 표시한다. 다시 부르면 기한을 새로 잡는다. */
function markTransient(messageId: string | null | undefined, ms: number, now = Date.now()) {
  if (!messageId) return;
  prune(now);
  until.set(String(messageId), now + ms + SLACK_MS);
}

function isTransient(messageId: string, now = Date.now()) {
  const t = until.get(String(messageId));
  if (t === undefined) return false;
  if (t > now) return true;
  until.delete(String(messageId));
  return false;
}

const AUTO_DELETE_MS = 10000;

// 삭제할 수 있는 메시지나 응답. 여기서 읽고 부르는 필드만
type Deletable = { id: string; delete?: () => Promise<unknown> };

// 네트워크가 끊겨 삭제하지 못했으면 이 간격으로 다시 삭제한다(끊김이 길어도 몇 분 안에는 치운다)
const RETRY_AFTER_MS = [10_000, 30_000, 60_000, 120_000, 300_000];

// 안내 메시지는 채널에 쌓이지 않게 잠시 뒤 삭제한다. 이미 삭제됐거나 권한이 없으면 그대로 둔다
function scheduleDelete(message: Deletable | null | undefined, ms = AUTO_DELETE_MS, tries = 0) {
  const remove = message?.delete;
  if (!message || typeof remove !== "function") return;
  markTransient(message.id, ms);
  const timer = setTimeout(() => {
    // 삭제하는 함수가 바로 던져도 여기서 받는다(타이머 밖으로 새면 프로세스 수준 예외가 된다)
    Promise.resolve()
      .then(() => remove.call(message))
      .catch((error: unknown) => {
        const retryMs = errorKind(error) === "network-error" ? RETRY_AFTER_MS[tries] : undefined;
        if (retryMs === undefined) return log.debug(`잠깐 보이는 메시지를 삭제하지 못함: ${messageOf(error)}`);
        log.debug(`잠깐 보이는 메시지를 네트워크 오류로 삭제하지 못해 ${retryMs / 1000}초 뒤 다시 삭제합니다: ${messageOf(error)}`);
        scheduleDelete(message, retryMs, tries + 1);
      });
  }, ms);
  timer.unref?.();
}

export { markTransient, isTransient, scheduleDelete, AUTO_DELETE_MS, RETRY_AFTER_MS };
