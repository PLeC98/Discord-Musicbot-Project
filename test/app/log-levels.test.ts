// src/app/log-levels.ts: 운영 설정값의 로그 수준을 로거와 터미널에 넣는다(실시간 로그 탭의 설정 창에서 바꾸면 바로)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import config from "../../src/config/index.ts";
import logger from "../../src/infra/log/logger.ts";
import logSink from "../../src/infra/log/sink.ts";
import { LEVELS } from "../../src/infra/log/levels.ts";
import { applyLogLevels } from "../../src/app/log-levels.ts";

const before = { level: logger.level, consoleLevel: logSink.consoleLevel, saved: { ...config.logging } };
after(() => {
  Object.assign(config.logging, before.saved);
  logger.level = before.level;
  logSink.consoleLevel = before.consoleLevel;
});

test("기록 수준은 로거에, 터미널 수준은 터미널에 적용한다. 터미널 수준을 비우면 제한을 풀어 기록 수준과 같아진다", () => {
  Object.assign(config.logging, { level: "debug", consoleLevel: "warn" });
  applyLogLevels();
  assert.deepEqual([logger.level, logSink.consoleLevel], ["debug", LEVELS.warn]);

  Object.assign(config.logging, { level: "info", consoleLevel: "" });
  applyLogLevels();
  assert.deepEqual([logger.level, logSink.consoleLevel], ["info", 0], "이전 터미널 수준이 남지 않는다");
});
