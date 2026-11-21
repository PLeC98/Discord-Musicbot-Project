// 설정 문서 스키마가 같이 쓰는 헬퍼. 스키마는 문제 목록(규칙 문제, rules/rule-problem)만 낸다. 예외를 던질지 경고할지는 호출부가 정한다.

import { z } from "zod";
import { isRuleCode, rule, unmoved, type RuleCode, type RuleParams, type RuleProblem } from "../../rules/rule-problem.ts";

// 문제. 코드(coded)를 그대로 쓰거나 검사한 값을 받아 만든다
type Message = NonNullable<z.core.$ZodCustomParams["error"]>;
// 오류가 난 곳(path) → 위치 값(장르 식별자, 몇 번째 소스 등). 값이 없는 이름은 빠진다
type Fill = (path: PropertyKey[]) => Record<string, string | number | undefined>;

/** zod 메시지에 적는 규칙 문제. 값이 없으면 코드만, 있으면 JSON(problemsOf가 푼다) */
const coded = (code: RuleCode, params?: RuleParams, cause?: RuleProblem) => (params || cause ? JSON.stringify(rule(code, params, cause)) : code);

const ALWAYS = { when: () => true }; // 필드 하나가 틀려도 교차 검사를 돌린다. 문제를 한 번에 다 알린다

// 있으면(null, undefined가 아니면) 조건을 본다
const present = (ok: (v: unknown) => boolean, message: Message) =>
  z
    .unknown()
    .refine((v) => v == null || ok(v), { error: message })
    .optional();

// 무엇이 오든 Object.keys의 키 → 값 표로
const keyed = (v: unknown): Record<string, unknown> => Object.fromEntries(Object.keys(v || {}).map((k) => [k, (v as Record<string, unknown>)[k]]));

// 표가 아니면 빈 표로(값이 없던 것과 같게 읽는다)
const plain = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// zod 메시지 → 규칙 문제. 코드로 적지 않은 메시지(zod가 스스로 낸 것)는 글 그대로 싣는다
function readCoded(message: string): RuleProblem {
  if (isRuleCode(message)) return rule(message);
  if (message.startsWith("{")) {
    try {
      const found = JSON.parse(message) as RuleProblem;
      if (isRuleCode(found.code)) return found;
    } catch {
      // 코드로 적은 메시지가 아니다. 아래에서 글 그대로 싣는다
    }
  }
  return unmoved(message);
}

/** 검사 결과 → 문제 목록. 위치 값은 fill이 오류가 난 곳으로 채우고, 메시지가 실어 온 값이 우선한다 */
function problemsOf(schema: z.ZodType, data: unknown, fill: Fill = () => ({})): RuleProblem[] {
  const result = schema.safeParse(data);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const found = readCoded(issue.message);
    const place = Object.fromEntries(Object.entries(fill(issue.path)).filter((entry): entry is [string, string | number] => entry[1] !== undefined));
    const params = { ...place, ...found.params };
    return { ...found, ...(Object.keys(params).length ? { params } : {}) };
  });
}

export { z, ALWAYS, coded, present, keyed, plain, problemsOf };
export type { Fill };
