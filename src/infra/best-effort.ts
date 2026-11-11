// 실패해도 흐름을 멈추지 않는 작업. 실패는 호출한 쪽 로거에 한 줄로 남긴다.
// 로그 레벨은 호출한 쪽이 정한다. 기본 debug는 네 가지 질문(사용자로 인함, 봇에 영향 없음, 그 사용자만, 일시적)이 다 "예"인 실패에만 쓴다.
// 삼켜도 되는 이유가 분명해 남길 것도 없으면 빈 catch에 그 이유를 주석으로 적는다.

import { codeOf, messageOf } from "./error-text.ts";

type Level = "debug" | "warn" | "error";

/** 작업이 끝나기를 기다릴 수 있는 Promise 를 돌려준다. 작업이 실패해도 이 Promise 는 resolve 된다 */
function bestEffort(log: { debug(line: string): unknown }, work: PromiseLike<unknown>, what: string): Promise<void>;
function bestEffort<L extends Level>(log: Record<L, (line: string) => unknown>, work: PromiseLike<unknown>, what: string, level: L): Promise<void>;
function bestEffort(log: Partial<Record<Level, (line: string) => unknown>>, work: PromiseLike<unknown>, what: string, level: Level = "debug"): Promise<void> {
  return Promise.resolve(work).then(
    () => undefined,
    (error: unknown) => {
      const text = messageOf(error);
      const code = codeOf(error);
      // 오류 코드가 있으면 붙인다(디스코드 오류 번호 등. rules/error-kind 의 describeError 와 같은 모양)
      log[level]?.(`${what} 실패: ${code === undefined || text === `오류 코드 ${code}` ? text : `${text} (${code})`}`);
    },
  );
}

export { bestEffort };
