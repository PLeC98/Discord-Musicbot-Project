// 로그 문구: 재생 감시(watchdog 분류). 멈춤, 끊김 판정과 트랙 종료

const watchdog = {
  phaseChanged: ({ from, to, detail }: { from: string; to: string; detail: string }) => `재생 단계: ${from} → ${to}${detail}`,
  phaseChangeUnexpected: ({ from, to, detail }: { from: string; to: string; detail: string }) => `예상하지 못한 재생 단계 전이: ${from} → ${to}${detail}`,
  overflowStopped: ({ overSeconds, track, positionSeconds, lengthSeconds }: { overSeconds: number; track: string; positionSeconds: string; lengthSeconds: string }) => `곡 길이를 ${overSeconds}초 넘겨 재생을 멈춤: ${track} | 위치 ${positionSeconds}초 / 길이 ${lengthSeconds}초`,
  bufferingStallRetry: ({ track, bufferingSeconds, quietSeconds }: { track: string; bufferingSeconds: string; quietSeconds: string }) => `재생이 시작되지 않아 다시 시도: ${track} | 버퍼링 ${bufferingSeconds}초, 입력 없음 ${quietSeconds}초`,
  idleStuckEnded: ({ seconds, track }: { seconds: number; track: string }) => `곡이 있는데 오디오가 ${seconds}초 넘게 멈춰 있어 곡을 끝냄: ${track}`,
  stuckSkipFailed: () => `멈춘 곡 스킵 처리 실패:`,
  bufferingSlow: ({ transition }: { transition: string }) => `${transition} 오래 걸림`,
  playerStateChanged: ({ from, to, track }: { from: string; to: string; track: string }) => `재생 상태 전이: ${from} → ${to} | ${track}`,
  gaplessSwitchAbandoned: ({ track, reason }: { track: string; reason: string }) => `갭리스 전환 포기: ${track} | ${reason}`,
};

export { watchdog };
