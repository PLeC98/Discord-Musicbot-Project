// 사람마다 한 번에 하나, 마지막 것만. 앞 작업이 끝나기 전에 온 새 작업은 앞 것을 기다리고, 그사이 더 새 작업이 왔으면 하지 않는다(null).
// 곡 추가 칸의 검색이 쓴다: 치는 대로 오는 검색이 봇 전체가 함께 쓰는 유튜브 검색 자리(동시 넷)를 한 사람이 여럿 차지하지 않게.
// 화면이 지난 요청을 취소해도 서버에서 시작한 검색은 멈추지 않는다

/** key 마다 한 줄. run(key, work) 은 그 줄의 마지막 작업이면 work 의 결과, 아니면 null. 도는 작업이 없으면 곧바로 시작한다 */
function latestOnly() {
  const lines = new Map<string, { last: number; tail: Promise<unknown> }>();
  return async function run<T>(key: string, work: () => Promise<T>): Promise<T | null> {
    const busy = lines.get(key);
    const line = busy ?? { last: 0, tail: Promise.resolve() };
    lines.set(key, line);
    const mine = ++line.last;
    const turn = busy ? line.tail.then(() => (line.last === mine ? work() : null)) : work();
    // 다음 작업은 이 작업이 끝나면(실패해도) 시작한다. 실패는 부른 쪽이 받는다
    line.tail = turn.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await turn;
    } finally {
      // 마지막 작업이 끝났으면 줄을 치운다(그 뒤에 온 것이 없다)
      if (line.last === mine && lines.get(key) === line) lines.delete(key);
    }
  };
}

export { latestOnly };
