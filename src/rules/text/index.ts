// 규칙 문구의 진입점. 아래층(rules, config, store)이 내는 코드의 문장(rules/rule-problem). 언어 폴더(rules/text/<언어>/)를 밖에서 직접 부르지 않는다.
// 아래층은 로그와 예외를 로그 언어로만 그린다(logRuleLine). 화면은 이 진입점을 부르지 않고 같은 언어의 폴더를 화면 번들로 받는다

import * as ko from "./ko/index.ts";
import { LOG_LANGUAGE, type TextLanguage } from "../languages.ts";
import { bundles } from "../text-bundle.ts";
import { ruleLine, type RuleProblem, type RuleSentences } from "../rule-problem.ts";

/** 언어 모듈 번들이 맞출 모양 */
type RuleSource = { problems: RuleSentences };

const SOURCES: Readonly<Record<TextLanguage, RuleSource>> = { ko };

const { textFor: ruleTextFor, missingText: missingRuleText } = bundles(SOURCES, (text: RuleSource) => text);

/** 문제 하나를 로그 언어의 문장으로(로그, 예외, 터미널) */
const logRuleLine = (problem: RuleProblem) => ruleLine(ruleTextFor(LOG_LANGUAGE).problems, problem);

export { ruleTextFor, missingRuleText, logRuleLine };
export type { RuleSource };
