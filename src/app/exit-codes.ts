// 봇이 끝날 때의 종료 코드. 다시 켜 주는 쪽(사람 · 런처 · systemd)이 이것을 보고 다시 켤지 정한다.
//   stopped       운영자가 껐다(Ctrl+C · 신호). 다시 켜지 않는다
//   restart       운영자가 대시보드에서 다시 시작했다. 세션은 저장했다. 실행기(app/launcher)가 곧바로 다시 띄운다
//   globalFlood   서버를 가리지 않는 오류가 쏟아져 내렸다. 세션은 저장했다. 다시 켜도 된다
//   transient     기동이 일시적인 까닭(디스코드 5xx · 네트워크)으로 실패했다. 잠시 뒤 다시 켜면 된다
//   badSetup      설정 · 토큰 · 설치물(ffmpeg · DB 버전)이 틀려 기동하지 못했다. 고치기 전에는 다시 켜도 같다
import { codeOf } from "../rules/error-kind.ts";

const EXIT = { stopped: 0, globalFlood: 3, restart: 4, transient: 75, badSetup: 78 } as const;

// 실행기가 봇에 넘기는 환경 변수. 있으면 다시 띄워 줄 쪽이 있다는 뜻이라 대시보드의 다시 시작 단추를 연다
const LAUNCHER_ENV = "MUSICBOT_LAUNCHER";

type ExitCode = (typeof EXIT)[keyof typeof EXIT];

// 로그인이 이것으로 실패하면 다시 켜도 같다(토큰 · 개발자 포털의 인텐트 설정)
const SETUP_LOGIN_CODES = new Set<unknown>(["TokenInvalid", "DisallowedIntents"]);

/** 기동 실패의 종료 코드. stopped: 기동 전 확인(설정 파일 · ffmpeg · DB 버전 · 모듈 읽기)이 멈췄다 */
function failedStartCode(error: unknown, stopped: boolean): ExitCode {
  return stopped || SETUP_LOGIN_CODES.has(codeOf(error)) ? EXIT.badSetup : EXIT.transient;
}

export { EXIT, LAUNCHER_ENV, failedStartCode };
export type { ExitCode };
