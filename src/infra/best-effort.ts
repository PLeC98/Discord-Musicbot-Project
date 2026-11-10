// 실패해도 흐름을 멈추지 않는 작업. 실패는 부른 쪽 로거에 debug 한 줄로 남긴다(알아 두면 좋은 실패).
// 삼켜도 되는 까닭이 분명해 남길 것도 없으면 빈 catch 에 그 까닭을 주석으로 적는다.

import { messageOf } from "./error-text.ts";

/** 작업이 끝나기를 기다릴 수 있는 Promise 를 돌려준다. 작업이 실패해도 이 Promise 는 resolve 된다 */
function bestEffort(log: { debug(line: string): unknown }, work: PromiseLike<unknown>, what: string): Promise<void> {
  return Promise.resolve(work).then(
    () => undefined,
    (error: unknown) => {
      log.debug(`${what} 실패: ${messageOf(error)}`);
    },
  );
}

export { bestEffort };
