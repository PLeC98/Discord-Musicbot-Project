// 테스트 프로세스마다 먼저 불러오는 도우미(package.json의 test, test:coverage가 --import로 건다. node --test는 파일마다 프로세스를 따로 띄운다).
// 로그 언어(기준 언어)와 로그 수준을 고정하고(셸이나 .env의 값, OS 언어와 상관없이. 테스트가 띄우는 자식 프로세스도 이 환경을 받는다),
// 테스트마다 로그 문구 그리기에 실패한 것이 있으면 그 테스트를 실패시킨다(일부러 실패시키는 테스트는 takeRenderFailures로 꺼내 비운다).
// 설정, 로거를 부르지 않는다(테스트 파일이 환경 변수를 정한 뒤에 부르는 것이 많다). 워커 스레드에서는 아무것도 하지 않는다.
// 테스트가 실행 플래그째(execArgv) 띄운 자식 프로세스에도 실리므로, 검사는 테스트 파일을 실행하는 프로세스에서만 건다(검사를 건 프로세스는 node:test 보고를 표준 출력에 낸다)

import { afterEach } from "node:test";
import { isMainThread } from "node:worker_threads";
import { LOG_LANGUAGES } from "../../src/infra/log/language.ts";
import { takeRenderFailures } from "../../src/infra/log/log-text.ts";

if (isMainThread) {
  process.env.LOG_LANGUAGE = LOG_LANGUAGES[0];
  // 로그 문구는 설정한 수준 이상인 줄만 그리므로 모든 수준을 기록해야 debug, trace 줄의 그리기 실패도 잡힌다. 터미널은 info부터 찍는다
  process.env.LOG_LEVEL = "trace";
  process.env.LOG_CONSOLE_LEVEL = "info";
  if (/\.test\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
    afterEach(() => {
      const failed = takeRenderFailures();
      if (failed.length) throw new Error(`로그 문구 그리기 실패: ${failed.join(", ")}`);
    });
  }
}
