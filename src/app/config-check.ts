// 설정 문제를 찍고, 있으면 멈춘다. config는 불러와도 멈추지 않고 목록만 내므로, 기동과 명령 배포 스크립트가
// 첫 줄에서 이것을 부른다. out: warn, error를 가진 것(로거나 console). exit: 멈추는 법(테스트가 넘긴다)
// 진입 파일이 로거보다 먼저 로그 언어를 고르며 남긴 알림(infra/log/choose-language)도 여기서 찍는다. 설정 문제로 멈추기 전이라 .env를 고친 직후에도 보인다
import { EXIT } from "./exit-codes.ts";
import { takeLogLanguageNotice } from "../infra/log/choose-language.ts";
import { L } from "../infra/log/text.ts";
import { logLanguage } from "../rules/languages.ts";
import type { LogText } from "../infra/log/log-text.ts";

type Checked = { warnings: LogText[]; problems: LogText[] };
type Out = { warn(line: LogText): unknown; error(line: LogText): unknown };

function stopOnConfigProblems(config: Checked, out: Out, exit: (code: number) => void = (code) => process.exit(code)) {
  const notice = takeLogLanguageNotice();
  if (notice) out.warn(L.config.logLanguageIgnored({ value: notice.value, malformed: notice.kind === "malformed", language: logLanguage() }));
  config.warnings.forEach((line) => out.warn(line));
  if (config.problems.length === 0) return;
  config.problems.forEach((line) => out.error(line));
  exit(EXIT.badSetup);
}

export { stopOnConfigProblems };
