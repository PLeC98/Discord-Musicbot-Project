// 로그 문구: 잇단 실패를 한 번으로 묶어 남기는 도우미(infra/repeating-failure)의 로그 줄. what: 작업 이름, reason: 원인

const failure = {
  /** 실패가 시작됐다(같은 원인이 이어지면 횟수만 센다) */
  started: ({ what, reason }: { what: string; reason: string }) => `${what} 실패: ${reason}`,
  /** 실패 중이던 작업이 복구됐다. count: 그동안 실패한 횟수 */
  recovered: ({ what, count }: { what: string; count: number }) => `${what} 복구(실패 ${count}회)`,
};

export { failure };
