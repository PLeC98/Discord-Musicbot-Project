// 로그인 창(다시 로그인)을 기다리는 동안 받은 401 을 모아 둔다.
// 로그인 창이 로그인을 마치면 서버가 이 브라우저의 옛 세션을 끝내(세션 고정 방어) 그때 진행 중이던 요청이 401 이 된다.
// 곧바로 세션 끝으로 돌리면 방금 로그인한 사람에게 세션 끝 대화상자가 뜬다. 그래서 창이 마쳤거나 그만두면 한 번 확인하고(check),
// 그때도 로그인이 살아 있지 않으면 세션 끝으로 간다(end). 창을 연 지 오래됐으면(WAIT_MS) 기다리지 않는다

/** 로그인 창을 이만큼까지만 기다린다(디스코드 승인 화면, 로그인 쿠키의 수명) */
const WAIT_MS = 10 * 60_000;

type LoginWaitOptions = {
  /** 세션 끝으로 돌린다 */
  end: () => void;
  /** 로그인이 살아 있나(조용히 확인한다) */
  check: () => Promise<boolean>;
  now?: () => number;
};

export function loginWait({ end, check, now = () => Date.now() }: LoginWaitOptions) {
  let since: number | null = null;
  let held = false;
  const waiting = () => since !== null && now() - since < WAIT_MS;

  // 창이 끝났다(마침, 그만둠). 모아 둔 401 이 있으면 한 번 확인한다
  async function settle() {
    const was = held;
    since = null;
    held = false;
    if (!was) return;
    // 닿지 못하면(던짐) 살아 있다고 보지 않는다(닫힌 쪽)
    const alive = await check().catch(() => false);
    if (!alive) end();
  }

  return {
    /** 로그인 창을 열었다 */
    opened() {
      since = now();
    },
    /** 요청이 401 을 받았다. 창을 기다리는 중이면 모아 두고, 아니면 곧바로 세션 끝 */
    sessionEnded() {
      if (waiting()) held = true;
      else end();
    },
    /** 로그인 창이 로그인을 마쳤다 */
    signedIn: settle,
    /** 로그인 창을 그만뒀다(대화상자를 닫음) */
    abandoned: settle,
  };
}
