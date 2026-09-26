// 주기마다 도는 일이 같은 까닭으로 잇달아 실패할 때, 로그가 사건 수와 맞게 남긴다.
// 처음 한 번은 error, 이어지는 같은 실패는 세기만 하고, 풀리면 몇 번 실패했는지 한 줄.

type FailureLog = { error(line: string): unknown; info(line: string): unknown };

function repeatingFailure(log: FailureLog, what: string) {
  let failing: string | null = null;
  let count = 0;
  return {
    /**
     * 실패. 까닭(글)이 바뀌면 새 사건으로 다시 남긴다.
     * detail 은 처음 남길 때 덧붙이는 글. 같은 사건인지는 보지 않는다(요청 id · 남은 초처럼 매번 달라지는 것)
     */
    fail(reason: string, detail?: string) {
      if (failing === reason) {
        count++;
        return;
      }
      failing = reason;
      count = 1;
      log.error(`${what} 실패: ${reason}${detail ? ` (${detail})` : ""}`);
    },
    /** 성공. 실패 중이었으면 풀렸다고 한 줄 */
    ok() {
      if (failing === null) return;
      log.info(`${what}: 다시 됩니다(잇단 실패 ${count}회 뒤)`);
      failing = null;
      count = 0;
    },
  };
}

export { repeatingFailure };
export type { FailureLog };
