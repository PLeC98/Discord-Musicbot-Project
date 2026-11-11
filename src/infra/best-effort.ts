// 실패해도 흐름을 멈추지 않는 작업. 실패는 부른 쪽 로거에 한 줄로 남긴다.
// 수준은 부른 쪽이 정한다. 기본 debug 는 네 물음(사용자로 인해, 봇에 영향 없음, 그 사용자만, 일시적)이 다 "예"인 실패에만 쓴다.
// 삼켜도 되는 까닭이 분명해 남길 것도 없으면 빈 catch 에 그 까닭을 주석으로 적는다.

import { messageOf } from "./error-text.ts";

type Level = "debug" | "warn" | "error";

/** 작업이 끝나기를 기다릴 수 있는 Promise 를 돌려준다. 작업이 실패해도 이 Promise 는 resolve 된다 */
function bestEffort(log: { debug(line: string): unknown }, work: PromiseLike<unknown>, what: string): Promise<void>;
function bestEffort<L extends Level>(log: Record<L, (line: string) => unknown>, work: PromiseLike<unknown>, what: string, level: L): Promise<void>;
function bestEffort(log: Partial<Record<Level, (line: string) => unknown>>, work: PromiseLike<unknown>, what: string, level: Level = "debug"): Promise<void> {
  return Promise.resolve(work).then(
    () => undefined,
    (error: unknown) => {
      log[level]?.(`${what} 실패: ${messageOf(error)}`);
    },
  );
}

export { bestEffort };
