// 규칙 문구의 진입점. 아래층(rules, config, store)이 내는 코드의 문장(rules/rule-problem). 언어 폴더(locales/<언어>/rules/)를 밖에서 직접 부르지 않는다.
// 아래층은 로그와 예외를 로그 언어로만 그린다(logRuleLine). 화면은 이 진입점을 부르지 않고 같은 언어의 폴더를 화면 번들로 받는다

import * as ko from "../../../locales/ko/rules/index.ts";
import { BASE_LANGUAGE, TEST_LANGUAGE, logLanguage, type TextLanguage } from "../languages.ts";
import { bundles } from "../../infra/text-bundle.ts";
import { ruleLine, type RuleProblem } from "../rule-problem.ts";
import { logText, type LogText } from "../../infra/log/log-text.ts";
import type { RuleSource } from "./shape.ts";

const SOURCES: Readonly<Record<TextLanguage, RuleSource>> = { ko };

const { textFor: ruleTextFor, missingText: missingRuleText } = bundles(SOURCES, (text: RuleSource) => text, { base: BASE_LANGUAGE, test: TEST_LANGUAGE });

/** 문제 하나를 로그 언어의 문장으로(로그, 예외, 터미널) */
const logRuleLine = (problem: RuleProblem) => ruleLine(ruleTextFor(logLanguage()).problems, problem);

/** 문제 하나를 로그 문구 서술자로: 문구 코드 rule.<코드>, 값은 문제의 값, 감싼 이유는 값 안의 서술자(cause)로 넣는다. 로거가 그릴 때 로그 언어의 문장이 된다 */
function ruleLogText(problem: RuleProblem): LogText {
  return logText(`rule.${problem.code}`, { ...problem.params, ...(problem.cause ? { cause: ruleLogText(problem.cause) } : {}) }, () => logRuleLine(problem));
}

/** 소스 종류의 이름(로그 언어). 모르는 종류면 종류 이름 그대로 */
const logSourceLabel = (type: string) => ruleTextFor(logLanguage()).sources[type]?.label ?? type;

export { ruleTextFor, missingRuleText, logRuleLine, ruleLogText, logSourceLabel };
export type { RuleSource };
