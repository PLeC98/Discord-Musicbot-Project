// 실시간 연결(EventSource)이 닫혔을 때 다시 열기까지 기다리는 시간. 닫힐 때마다 늘린다(2 · 5 · 15 · 30 · 60초).
// 200 이 아닌 답(상한 429 · 준비 전 503 · 세션 끝 401)을 받은 EventSource 는 스스로 다시 붙지 않아 화면이 다시 연다.
// 여러 탭이 같은 때에 다시 붙지 않게 ±20% 흔든다

const STEPS_MS = [2000, 5000, 15000, 30000, 60000];

/** attempt: 연달아 닫힌 횟수(0부터). random 은 시험이 넘긴다 */
function reopenDelay(attempt: number, random: () => number = Math.random): number {
  const base = STEPS_MS[Math.min(Math.max(0, attempt), STEPS_MS.length - 1)];
  return Math.round(base * (0.8 + 0.4 * random()));
}

export { reopenDelay };
