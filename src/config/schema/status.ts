// 봇 활동 문구 설정("status" 문서)의 스키마.

import { NUMERIC_NAME } from "./genres.ts";
import { z, ALWAYS, coded, present, plain, problemsOf } from "./problems.ts";
import { rule, type RuleProblem } from "../../rules/rule-problem.ts";

const ACTIVITY_TYPES = ["Playing", "Listening", "Watching", "Competing", "Custom"] as const;
type ActivityType = (typeof ACTIVITY_TYPES)[number];
const isActivityType = (v: unknown): v is ActivityType => ACTIVITY_TYPES.some((type) => type === v);

const MAX_TEXT = 128; // 디스코드 활동 문구 길이 상한

// 문구를 바꾸는 간격(초). 비우면 기본값(기본 설정 문서와 같다), 그보다 짧게는 돌리지 않는다
const INTERVAL_DEFAULT = 60;
const INTERVAL_MIN = 10;

// "MM-DD ~ MM-DD" / "HH:MM ~ HH:MM". 비교가 문자열 비교라 두 자리로 적지 않으면
// 형식이 틀린 게 아니라 "엉뚱한 날에 걸린다". 그래서 모양까지 본다.
type RangeKind = "date" | "lunar" | "time";

function rangeProblem(value: unknown, kind: RangeKind): RuleProblem | null {
  if (typeof value !== "string") return rule("range-not-text");
  const parts = value.split("~");
  if (parts.length !== 2) return rule("range-split", { example: kind === "time" ? "22:00 ~ 06:00" : "12-24 ~ 12-26" });

  const shape = kind === "time" ? /^([01][0-9]|2[0-3]):[0-5][0-9]$/ : /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  for (const part of parts.map((p) => p.trim())) {
    if (!shape.test(part)) return rule("range-part", { part, shape: kind === "time" ? "HH:MM" : "MM-DD" });
  }
  return null;
}

const range = (kind: RangeKind) =>
  z
    .unknown()
    .superRefine((value, ctx) => {
      if (value == null) return;
      const problem = rangeProblem(value, kind);
      if (problem) ctx.addIssue({ code: "custom", message: coded("status-range", { kind }, problem) });
    })
    .optional();

// 문구 하나. 글자로 적거나 { text, type }으로 풀어 적는다
const message = z.preprocess(
  // 배열은 빈 표로 본다
  (item) => (typeof item === "string" ? { text: item } : Array.isArray(item) ? {} : item),
  z.object(
    {
      text: z
        .string({ error: "status-empty-text" })
        .refine((text) => text.trim(), { error: "status-empty-text" })
        // 빈 문구면 길이는 따지지 않는다(한 문구에 하나만 알린다)
        .refine((text) => !text.trim() || text.length <= MAX_TEXT, { error: (issue) => coded("status-long-text", { max: MAX_TEXT, head: String(issue.input).slice(0, 20) }) }),
      // 종류를 잘못 적으면 조용히 "듣는 중"이 된다. 오타가 말을 안 해 주는 종류라 여기서 잡는다
      type: present(
        (type) => isActivityType(type),
        (issue) => coded("status-type", { type: JSON.stringify(issue.input), types: ACTIVITY_TYPES.join(", ") }),
      ),
    },
    { error: "status-message-shape" },
  ),
);

const messages = z.array(message, { error: "status-no-messages" }).min(1, { error: "status-no-messages" });

const entry = z
  .object({ date: range("date"), lunar: range("lunar"), time: range("time"), messages }, { error: "status-entry-empty" })
  // 조건이 하나도 없으면 항상 맞아서 아래 항목이 전부 죽는다. 손으로 고치다 범위만 지우면 밟는다
  .superRefine((one, ctx) => {
    if (!one || typeof one !== "object" || Array.isArray(one)) return; // 표가 아니면 위에서 이미 알렸다
    if (!(["date", "lunar", "time"] as const).some((k) => one[k] != null)) ctx.addIssue({ code: "custom", message: "status-entry-no-when" });
  }, ALWAYS);

const special = z
  .record(z.string(), entry, { error: "status-special-shape" })
  .superRefine((all, ctx) => {
    if (!all || typeof all !== "object" || Array.isArray(all)) return; // 표가 아니면 위에서 이미 알렸다
    for (const name of Object.keys(all)) {
      if (!name.trim()) ctx.addIssue({ code: "custom", message: "status-name-empty" });
      if (NUMERIC_NAME.test(name)) ctx.addIssue({ code: "custom", message: coded("status-name-numeric", { name }) });
    }
  }, ALWAYS)
  .nullish();

const statusFile = z.preprocess(
  plain,
  z.object({
    interval: present((v) => Number(v) >= INTERVAL_MIN, coded("status-interval", { min: INTERVAL_MIN })),
    messages,
    special,
  }),
);

/** 상태 설정의 문제 목록. 없으면 빈 배열. 위치 값은 special 아래 문구의 이름(name, 평소 문구면 없다) */
function statusProblems(data: unknown): RuleProblem[] {
  return problemsOf(statusFile, data, (path) => ({ name: path[0] === "special" && path[1] !== undefined ? String(path[1]) : undefined }));
}

export { statusProblems, ACTIVITY_TYPES, MAX_TEXT, INTERVAL_DEFAULT, INTERVAL_MIN, isActivityType };
export type { ActivityType };
