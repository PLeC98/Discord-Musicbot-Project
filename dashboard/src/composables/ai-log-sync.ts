// AI 리퀘스트 로그 화면의 SSE 연결을 여닫는 로직(composables/ai-log). Vue 의존성 없이 호출하는 쪽에서 조건과 동작을 넘긴다(테스트에서 그대로 호출한다).
// 화면이 활성 상태이고(active), 탭이 보이고 세션이 살아 있을 때만 연다(canStream, 다른 두 스트림과 같다). 목록을 불러오는 동안 조건이 바뀌었거나 화면이 사라졌으면 열지 않는다.
// 다시 읽기는 처음 열 때, 화면을 떠났다가 돌아올 때, 세션이 만료됐거나 계정이 바뀐 뒤(blocked), 이전 읽기가 실패했을 때만 한다.
// 탭을 숨겼다가 다시 보일 때는 이어받기로 충분하다(펼친 줄, 더 불러온 줄을 유지한다)

type AiLogSyncDeps = {
  /** 화면이 보이는지 반환한다 */
  active: () => boolean;
  /** 탭이 보이고 세션이 살아 있으며 계정이 바뀌지 않았는지 반환한다(composables/session의 live) */
  canStream: () => boolean;
  /** 세션이 만료됐거나 계정이 바뀌었는지 반환한다 */
  blocked: () => boolean;
  /** 목록을 다시 읽는다. 끝난 뒤 loadFailed로 실패 여부를 확인한다 */
  reload: () => Promise<void>;
  loadFailed: () => boolean;
  start: () => void;
  stop: () => void;
};

export function aiLogSync({ active, canStream, blocked, reload, loadFailed, start, stop }: AiLogSyncDeps) {
  let disposed = false;
  let turn = 0;
  let stale = true;
  const wanted = () => !disposed && active() && canStream();

  async function sync() {
    const mine = ++turn;
    if (!active() || blocked()) stale = true;
    if (!wanted()) return stop();
    if (stale) {
      await reload();
      if (mine !== turn || !wanted()) return;
      // 읽지 못했으면 다음에 다시 읽는다
      stale = loadFailed();
    }
    start();
  }

  return {
    sync,
    /** 화면이 사라졌다. 기다리던 읽기가 끝나도 열지 않는다 */
    dispose() {
      disposed = true;
      turn++;
      stop();
    },
  };
}
