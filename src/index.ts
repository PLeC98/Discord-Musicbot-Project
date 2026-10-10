// 기동. 설정 문제를 먼저 보고, 문제가 없을 때만 본체(src/app/main.ts)를 불러온다.
// 본체를 맨 위에서 불러오지 않는 이유: 불러올 때 일하는 모듈이 생겨도 설정 검사가 구조적으로 먼저 돈다.

import "./app/env-bootstrap.ts"; // 설정을 읽기 전에 .env 가 없으면 만든다(pnpm install 이 그 단계를 건너뛰었을 수 있다)
import "./infra/log/sink.ts"; // 그다음 콘솔을 가로챈다
import * as loadedConfig from "./config/index.ts"; // 설정 값과 함께 문제 · 경고 목록
import * as configCheck from "./app/config-check.ts";
import logger from "./infra/log/logger.ts";
import { EXIT } from "./app/exit-codes.ts";

configCheck.stopOnConfigProblems(loadedConfig, logger.child({ category: "config" }));

// 본체를 불러오다 던지면(명령 · 이벤트 파일이 깨졌다) 로그인하지 않고 멈춘다. 고치기 전에는 다시 켜도 같은 실패다
let main: () => void;
try {
  ({ main } = await import("./app/main.ts"));
} catch (error) {
  logger.child({ category: "core" }).error("본체를 불러오지 못해 기동을 멈춥니다:", error);
  process.exit(EXIT.badSetup);
}
main();
