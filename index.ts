// 기동. 설정 문제를 먼저 보고, 문제가 없을 때만 본체(src/app/main.ts)를 불러온다.
// 본체를 맨 위에서 불러오지 않는 이유: 불러올 때 일하는 모듈이 생겨도 설정 검사가 구조적으로 먼저 돈다.

import "./src/infra/log/sink.ts"; // 다른 무엇보다 먼저 콘솔을 가로챈다
import * as loadedConfig from "./config.ts"; // 설정 값과 함께 문제 · 경고 목록
import * as configCheck from "./src/app/configCheck.ts";
import logger from "./src/infra/log/logger.ts";

configCheck.stopOnConfigProblems(loadedConfig, logger.child({ category: "config" }));

const { main } = await import("./src/app/main.ts");
main();
