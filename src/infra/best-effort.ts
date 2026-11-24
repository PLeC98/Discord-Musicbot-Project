// 실패해도 흐름을 멈추지 않는 작업. 실패는 호출한 쪽 로거에 한 줄로 남긴다.
// 로그 레벨은 호출한 쪽이 정한다. 기본 debug는 네 가지 질문(사용자로 인함, 봇에 영향 없음, 그 사용자만, 일시적)이 다 "예"인 실패에만 쓴다.
// 삼켜도 되는 이유가 분명해 남길 것도 없으면 빈 catch에 그 이유를 주석으로 적는다.

import { messageWithCode } from "./error-text.ts";
import type { LogText } from "./log/log-text.ts";
import { L } from "./log/text.ts";

type Level = "debug" | "warn" | "error";
/** 실패 한 줄을 받는 로그 함수(로거의 수준 함수) */
type Line = (line: LogText) => unknown;

/** 작업이 끝나기를 기다릴 수 있는 Promise를 돌려준다. 작업이 실패해도 이 Promise는 resolve 된다 */
function bestEffort(log: { debug: Line }, work: PromiseLike<unknown>, what: LogText): Promise<void>;
function bestEffort<V extends Level>(log: Record<V, Line>, work: PromiseLike<unknown>, what: LogText, level: V): Promise<void>;
function bestEffort(log: Partial<Record<Level, Line>>, work: PromiseLike<unknown>, what: LogText, level: Level = "debug"): Promise<void> {
  return Promise.resolve(work).then(
    () => undefined,
    (error: unknown) => {
      log[level]?.(L.failure.bestEffortFailed({ what, reason: messageWithCode(error) }));
    },
  );
}

export { bestEffort };
