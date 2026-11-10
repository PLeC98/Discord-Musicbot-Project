// 종료 시작 여부. 종료 처리(app/shutdown)가 켜고 다시 끄지 않는다.
// 새 음성 연결을 만드는 곳(player/voice-link, infra/voice-adapter)이 막고, 새 작업을 받는 곳(명령, 대시보드, 기동 복원, 남은 채널 이어받기, 서버 하나 다시 시작, 상주 모드)이 받지 않는다.
// 이미 붙어 있는 연결은 종료 처리에서 세션을 저장한 뒤 정리한다. 그때까지 라이브러리가 참가 요청 없이 음성 서버에 다시 붙는 것은 막지 않는다

let stopping = false;

/** 종료 시작 상태로 바꾼다. 되돌리지 않는다 */
function beginShutdown() {
  stopping = true;
}

/** 종료 시작 여부 */
function isShuttingDown() {
  return stopping;
}

/** 테스트: 처음 상태로 되돌린다 */
function _resetShutdown() {
  stopping = false;
}

export { beginShutdown, isShuttingDown, _resetShutdown };
