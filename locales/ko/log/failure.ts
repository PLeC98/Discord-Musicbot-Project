// 로그 문구: 실패를 남기는 도우미의 로그 줄. 잇단 실패를 한 번으로 묶는 것(infra/repeating-failure), 실패해도 흐름을 멈추지 않는 작업(infra/best-effort). what: 작업 이름, reason: 원인

const failure = {
  /** 실패가 시작됐다(같은 원인이 이어지면 횟수만 센다) */
  started: ({ what, reason }: { what: string; reason: string }) => `${what} 실패: ${reason}`,
  /** 실패 중이던 작업이 복구됐다. count: 그동안 실패한 횟수 */
  recovered: ({ what, count }: { what: string; count: number }) => `${what} 복구(실패 ${count}회)`,
  /** 실패해도 되는 작업이 실패했다(삼키고 한 줄만 남긴다) */
  bestEffortFailed: ({ what, reason }: { what: string; reason: string }) => `${what} 실패: ${reason}`,
  /** 디스코드 응답, 메시지를 지우거나 고치지 못했다(ui/delivery의 unlessGone. 부른 쪽 로거에 남긴다) */
  messageActionFailed: ({ what, reason }: { what: string; reason: string }) => `${what} 실패: ${reason}`,
};

export { failure };
