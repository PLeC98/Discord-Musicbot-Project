// 로그 수준(운영 설정값 LOG_LEVEL, LOG_CONSOLE_LEVEL, 실시간 로그 탭의 설정 창)을 로거와 터미널에 적용한다.
// 기동이 로그를 준비할 때(설정 DB를 열기 전이라 기본값), 운영 설정값을 불러온 뒤, 운영 설정값이 바뀔 때마다 부른다(다시 시작하지 않는다)

import config from "../config/index.ts";
import logger from "../infra/log/logger.ts";
import logSink from "../infra/log/sink.ts";

/** 지금 설정의 로그 수준을 적용한다. 터미널 수준이 빈 값이면 제한을 풀어 기록 수준과 같게 한다(이전 값이 남지 않게 매번 다시 적용한다) */
function applyLogLevels() {
  logger.level = config.logging.level;
  logSink.setConsoleLevel(config.logging.consoleLevel);
}

export { applyLogLevels };
