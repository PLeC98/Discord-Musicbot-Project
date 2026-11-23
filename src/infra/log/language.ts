// 로그 언어: 로그, 터미널 출력, 예외 메시지에 쓰는 언어. 진입 파일이 기동 때 한 번 정하고(infra/log/choose-language) 그 뒤로는 바꾸지 않는다.
// 아무 모듈도 부르지 않는다. 화면 코드도 부르는 rules/languages가 이것을 다시 내보내고, 진입 파일이 .env를 읽기 전에 평가되므로 설정, 로거를 끌어오면 안 된다

/** 로그 언어로 고를 수 있는 언어. 로그, 규칙, 봇 문구가 모두 있는 언어와 같아야 하고 맨 앞이 기준 언어다(테스트가 본다) */
const LOG_LANGUAGES = ["ko"] as const;
type LogLanguage = (typeof LOG_LANGUAGES)[number];

let current: LogLanguage = LOG_LANGUAGES[0];

/** 지금 로그 언어. 정하기 전에는 기준 언어 */
const logLanguage = (): LogLanguage => current;

/** 로그 언어를 정한다. 진입 파일의 첫 줄(choose-language)과 테스트만 부른다 */
function setLogLanguage(language: LogLanguage): void {
  current = language;
}

export { LOG_LANGUAGES, logLanguage, setLogLanguage };
export type { LogLanguage };
