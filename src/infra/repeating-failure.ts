// 주기마다 도는 작업이 같은 이유로 잇달아 실패할 때, 로그가 사건 수와 맞게 남긴다.
// 처음 한 번은 error, 이어지는 같은 실패는 세기만 하고, 풀리면 몇 번 실패했는지 한 줄.
// 로그 줄은 로그 문구(서술자)로 넘긴다. 작업 이름과 원인은 글이나 다른 서술자다

import { L } from "./log/text.ts";
import { isLogText, recordArgs, type LogText } from "./log/log-text.ts";

type FailureLog = { error(line: LogText): unknown; info(line: LogText): unknown };

/** 원인이 같은지 비교하는 키. 서술자는 객체라 같은 실패라도 매번 새로 만들어지므로 문구 코드와 값으로 비교한다 */
const reasonKey = (reason: string | LogText) => (isLogText(reason) ? JSON.stringify({ event: reason.event, args: recordArgs(reason.args) }) : reason);

function repeatingFailure(log: FailureLog, what: string | LogText) {
  let failing: string | null = null;
  let count = 0;
  return {
    /** 실패. 원인이 바뀌면 새 사건으로 다시 남긴다 */
    fail(reason: string | LogText) {
      const key = reasonKey(reason);
      if (failing === key) {
        count++;
        return;
      }
      failing = key;
      count = 1;
      log.error(L.failure.started({ what, reason }));
    },
    /** 성공. 실패 중이었으면 풀렸다고 한 줄 */
    ok() {
      if (failing === null) return;
      log.info(L.failure.recovered({ what, count }));
      failing = null;
      count = 0;
    },
  };
}

export { repeatingFailure, reasonKey };
export type { FailureLog };
