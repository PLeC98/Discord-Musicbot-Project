// 규칙 문구의 진입점. 아래층(rules, config, store)이 내는 코드의 문장(rules/rule-problem). 언어 폴더(rules/text/<언어>/)를 밖에서 직접 부르지 않는다.
// 아래층은 로그와 예외를 로그 언어로만 그린다(logRuleLine). 화면은 이 진입점을 부르지 않고 같은 언어의 폴더를 화면 번들로 받는다

import * as ko from "./ko/index.ts";
import { LOG_LANGUAGE, type TextLanguage } from "../languages.ts";
import { bundles } from "../text-bundle.ts";
import { ruleLine, type RuleProblem } from "../rule-problem.ts";
import type { RuleSource } from "./shape.ts";

const SOURCES: Readonly<Record<TextLanguage, RuleSource>> = { ko };

const { textFor: ruleTextFor, missingText: missingRuleText } = bundles(SOURCES, (text: RuleSource) => text);

/** 문제 하나를 로그 언어의 문장으로(로그, 예외, 터미널) */
const logRuleLine = (problem: RuleProblem) => ruleLine(ruleTextFor(LOG_LANGUAGE).problems, problem);

/** 소스 종류의 이름(로그 언어). 모르는 종류면 종류 이름 그대로 */
const logSourceLabel = (type: string) => ruleTextFor(LOG_LANGUAGE).sources[type]?.label ?? type;

export { ruleTextFor, missingRuleText, logRuleLine, logSourceLabel };
export type { RuleSource };
