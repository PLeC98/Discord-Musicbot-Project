// 로그인 창(다시 로그인)을 기다리는 동안 받은 401을 모아 둔다.
// 로그인 창에서 로그인을 마치면 서버가 이 브라우저의 이전 세션을 종료하므로(세션 고정 공격 방어) 그때 진행 중이던 요청이 401이 된다.
// 곧바로 세션 만료로 처리하면 방금 로그인한 사용자에게 세션 만료 대화상자가 표시된다. 그래서 로그인이 끝났거나 취소되면 한 번 확인하고(check),
// 그때도 로그인이 유효하지 않으면 세션 만료로 처리한다(end). 창을 연 지 오래됐으면(WAIT_MS) 기다리지 않는다.
// 로그인 창이 닫힌 뒤에도 이전 세션으로 보냈던 오래 걸리는 요청(곡 추가, 긴 운영자 작업)의 401이 뒤늦게 올 수 있다. 그래서 종료 후 GRACE_MS 동안 받은 401은
// 곧바로 세션 만료로 처리하지 않고 한 번 확인한다. 다른 탭이 로그인을 마쳤거나 세션 id를 바꿨을 때(다른 기기 로그아웃)도 그 뒤 GRACE_MS 동안 같다

/** 로그인 창을 이만큼까지만 기다린다(디스코드 승인 화면, 로그인 쿠키의 수명) */
const WAIT_MS = 10 * 60_000;
/** 로그인 창이 닫힌 뒤 늦게 도착한 401을 바로 만료 처리하지 않고 재확인하는 유예 시간이다(공통 요청 모듈의 긴 타임아웃인 utils/request의 LIMIT.long) */
const GRACE_MS = 120_000;

type LoginWaitOptions = {
  /** 세션 만료 상태로 전환한다 */
  end: () => void;
  /** 로그인이 유효한지 조용히 확인한다 */
  check: () => Promise<boolean>;
  now?: () => number;
};

export function loginWait({ end, check, now = () => Date.now() }: LoginWaitOptions) {
  let since: number | null = null;
  let settledAt: number | null = null;
  let held = false;
  let checking: Promise<void> | null = null;
  let again = false;
  const waiting = () => since !== null && now() - since < WAIT_MS;
  const lately = () => settledAt !== null && now() - settledAt < GRACE_MS;

  // 세션이 유효한지 확인한다. 서버에 연결하지 못하면(예외 발생) 유효하지 않은 것으로 본다(fail-closed). 확인 요청이 진행 중인 동안 들어온 401은 그 확인이 끝난 뒤 한 번 더 확인한다
  // (먼저 보낸 확인 요청의 응답은 그 401보다 이전 상태일 수 있다)
  function confirm(): Promise<void> {
    if (checking) {
      again = true;
      return checking;
    }
    checking = check()
      .catch(() => false)
      .then((alive) => {
        if (!alive) end();
      })
      .finally(() => {
        checking = null;
        if (again) {
          again = false;
          void confirm();
        }
      });
    return checking;
  }

  // 로그인 창 대기가 끝났다(로그인 완료, 취소, 다른 경로로 로그인 확인). 모아 둔 401이 있으면 한 번 확인한다
  async function settle() {
    const was = held;
    if (since !== null) settledAt = now();
    since = null;
    held = false;
    if (was) await confirm();
  }

  return {
    /** 로그인 창을 열었다 */
    opened() {
      since = now();
    },
    /** 요청이 401을 받았다. 로그인 창을 기다리는 중이면 모아 두고, 아니면 곧바로 세션 만료로 처리한다 */
    sessionEnded() {
      if (waiting()) held = true;
      else if (lately()) void confirm();
      else end();
    },
    /** 로그인 창에서 로그인을 마쳤다 */
    signedIn: settle,
    /** 재로그인을 취소했다(대화상자를 닫음) */
    abandoned: settle,
    /** 다른 탭이 로그인을 마쳤거나 세션 id를 바꿨다. 이 탭이 이전 세션으로 보낸 요청의 401이 뒤늦게 와도 확인한다 */
    elsewhere() {
      settledAt = now();
    },
  };
}
