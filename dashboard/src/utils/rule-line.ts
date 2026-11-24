// 규칙 문제(rules/rule-problem: 설정 검사, 불러오기 미리 보기)를 화면 언어로 그린다. 문장은 text.rules(locales/<언어>/rules).
// 운영 설정값은 이름 대신 화면 라벨, 불러오기 항목은 화면의 항목 이름을 붙인다

import { ruleLine as sentenceOf, type RuleProblem } from "../../../src/rules/rule-problem.ts";
import { isArchiveItem } from "../../../src/dashboard/contract/settings-archive.ts";
import { text } from "../text/index.ts";

/** 문제 하나를 화면 언어의 한 줄로 */
export function ruleLine(problem: RuleProblem): string {
  const params = problem.params ?? {};
  const cause = problem.cause ? ruleLine(problem.cause) : "";
  if (problem.code === "tune-value") {
    const key = String(params.key);
    return text.tunables.problemLine(text.tunables.fields[key]?.label ?? key, String(params.value), cause);
  }
  const item = String(params.item);
  if (problem.code === "archive-item" && isArchiveItem(item)) return text.archive.itemProblem(text.archive.items[item], cause);
  return sentenceOf(text.rules.problems, problem, ruleLine);
}
