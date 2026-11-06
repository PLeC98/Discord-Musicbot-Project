// AI 리퀘스트 로그 화면의 SSE 연결을 열고 닫는 차례(composables/ai-log). Vue 없이 부르는 쪽이 조건과 일을 넘긴다(시험이 그대로 부른다).
// 화면이 보이고(active), 탭이 보이고 세션이 살아 있을 때만 연다(canStream, 다른 두 스트림과 같다). 읽기를 기다리는 사이 바뀌었거나 화면이 사라졌으면 열지 않는다.
// 다시 읽기는 처음 열 때, 화면을 떠났다 올 때, 세션이 끝났거나 계정이 바뀐 뒤(blocked), 지난 읽기가 실패했을 때만.
// 탭을 숨겼다 보이는 것은 이어 받기로 충분하다(펼친 줄, 더 읽은 줄을 지킨다)

type AiLogSyncDeps = {
  /** 화면이 보이는가 */
  active: () => boolean;
  /** 탭이 보이고 세션이 살아 있고 계정이 바뀌지 않았나(composables/session 의 live) */
  canStream: () => boolean;
  /** 세션이 끝났거나 계정이 바뀌었나 */
  blocked: () => boolean;
  /** 목록을 다시 읽는다. 끝난 뒤 loadFailed 로 읽지 못했는지 본다 */
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
