// 로그 언어: 로그, 터미널 출력, 예외 메시지에 쓰는 언어. 진입 파일이 기동 때 한 번 정하고(infra/log/choose-language) 그 뒤로는 바꾸지 않는다.
// 아무 모듈도 부르지 않는다. 화면 코드도 부르는 rules/languages가 이것을 다시 내보내고, 진입 파일이 .env를 읽기 전에 평가되므로 설정, 로거를 끌어오면 안 된다

/** 로그 언어로 고를 수 있는 언어. 지원 언어 안에 있고 로그, 규칙, 봇 문구가 모두 갖춰진 언어만 넣는다. 맨 앞이 기준 언어다(테스트가 본다) */
const LOG_LANGUAGES = ["ko"] as const;
type LogLanguage = (typeof LOG_LANGUAGES)[number];
/** 테스트 언어. rules/languages의 TEST_LANGUAGE와 같은 태그다(테스트가 본다). 운영에서는 고르지 않고 테스트에서만 켠다 */
const LOG_TEST_LANGUAGE = "qps-ploc";

let current: LogLanguage | typeof LOG_TEST_LANGUAGE = LOG_LANGUAGES[0];

/** 지금 로그 언어. 정하기 전에는 기준 언어 */
const logLanguage = (): LogLanguage | typeof LOG_TEST_LANGUAGE => current;

/** 로그 언어를 정한다. 진입 파일의 첫 줄(choose-language)과 테스트만 부른다 */
function setLogLanguage(language: LogLanguage): void {
  current = language;
}

/** 테스트 전용: 로그 언어를 테스트 언어로(on), 또는 기준 언어로 되돌린다 */
function useTestLogLanguage(on: boolean): void {
  current = on ? LOG_TEST_LANGUAGE : LOG_LANGUAGES[0];
}

export { LOG_LANGUAGES, LOG_TEST_LANGUAGE, logLanguage, setLogLanguage, useTestLogLanguage };
export type { LogLanguage };
