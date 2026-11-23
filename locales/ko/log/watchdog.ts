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
  bufferingTransition: ({ status, track, seconds }: { status: string; track: string; seconds: string }) => `상태 전이: buffering → ${status} | ${track} | 버퍼링 ${seconds}s`,
  startFailed: () => `시작 못 함`,
  gaplessNotReady: () => `전환할 수 있는 상태가 아님`,
  gaplessTrackChanged: () => `이미 다른 곡으로 넘어감`,
  gaplessAudioChanged: () => `곡의 음원이 바뀌어 트는 음원의 파일이 없음`,
  gaplessNoCacheFile: () => `쓸 수 있는 캐시 파일이 없음`,
  trackEndPhase: ({ reason }: { reason: string }) => `곡 끝(${reason})`,
  longPause: () => `장시간 일시정지`,
  /** slips: 스플라이서가 전환 지점을 고친 횟수 */
  gaplessSwitchDetail: ({ seconds, slips }: { seconds: string; slips: number }) => `갭리스 전환 상세: ${seconds}초 지점${slips ? ` | 지점 조정 ${slips}회` : ""}`,
  /** dropped: 끊김(아니면 끝). why: 판정 이유 */
  endVerdict: ({ dropped, why, playedSeconds, length }: { dropped: boolean; why: string; playedSeconds: string; length: string }) => `트랙 종료 판정: ${dropped ? "끊김" : "끝"}(${why}) | 재생 ${playedSeconds}초 / 길이 ${length}`,
};

export { watchdog };
