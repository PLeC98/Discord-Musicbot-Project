// 봇 활동 문구 설정(status.yaml)의 스키마.

import genres from "./genres.js";
const { NUMERIC_NAME } = genres;
import problems from "./problems.js";
const { z, ALWAYS, present, plain, problemsOf } = problems;

const ACTIVITY_TYPES = ["Playing", "Listening", "Watching", "Competing", "Custom"];

const MAX_TEXT = 128; // 디스코드 활동 문구 길이 상한

// "MM-DD ~ MM-DD" / "HH:MM ~ HH:MM". 비교가 문자열 비교라 두 자리로 적지 않으면
// 형식이 틀린 게 아니라 "엉뚱한 날에 걸린다". 그래서 모양까지 본다.
function rangeProblem(value, kind) {
  if (typeof value !== "string") return "글자로 적어야 합니다";
  const parts = value.split("~");
  if (parts.length !== 2) return `"${kind === "time" ? "22:00 ~ 06:00" : "12-24 ~ 12-26"}"처럼 ~ 로 나눠 적어야 합니다`;

  const shape = kind === "time" ? /^([01][0-9]|2[0-3]):[0-5][0-9]$/ : /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
  for (const part of parts.map((p) => p.trim())) {
    if (!shape.test(part)) return `"${part}"는 ${kind === "time" ? "HH:MM" : "MM-DD"} 두 자리로 적어야 합니다`;
  }
  return null;
}

const range = (kind) =>
  z
    .unknown()
    .superRefine((value, ctx) => {
      if (value == null) return;
      const problem = rangeProblem(value, kind);
      if (problem) ctx.addIssue({ code: "custom", message: `{name}의 ${kind}: ${problem}` });
    })
    .optional();

// 문구 하나. 글자로 적거나 { text, type } 으로 풀어 적는다
const message = z.preprocess(
  // 배열은 칸이 없는 표로 읽던 것과 같게 빈 표로
  (item) => (typeof item === "string" ? { text: item } : Array.isArray(item) ? {} : item),
  z.object(
    {
      text: z
        .string({ error: "{where}: 빈 문구가 있습니다." })
        .refine((text) => text.trim(), { error: "{where}: 빈 문구가 있습니다." })
        // 빈 문구면 길이는 따지지 않는다(한 문구에 하나만 알린다)
        .refine((text) => !text.trim() || text.length <= MAX_TEXT, { error: (issue) => `{where}: 문구가 ${MAX_TEXT}자를 넘습니다. "${issue.input.slice(0, 20)}…"` }),
      // 종류를 잘못 적으면 조용히 "듣는 중"이 된다. 오타가 말을 안 해 주는 종류라 여기서 잡는다
      type: present(
        (type) => ACTIVITY_TYPES.includes(type),
        (issue) => `{where}: "${issue.input}"은 쓸 수 없는 활동 종류입니다(${ACTIVITY_TYPES.join(" · ")}).`,
      ),
    },
    { error: "{where}: 문구는 글자로 적거나 text/type으로 풀어 적어야 합니다." },
  ),
);

const messages = z.array(message, { error: "{where}: 문구가 하나는 있어야 합니다." }).min(1, { error: "{where}: 문구가 하나는 있어야 합니다." });

const entry = z
  .object({ date: range("date"), lunar: range("lunar"), time: range("time"), messages }, { error: "{name}: 내용이 비었습니다." })
  // 조건이 하나도 없으면 항상 맞아서 아래 항목이 전부 죽는다. 손으로 고치다 범위만 지우면 밟는다
  .superRefine((one, ctx) => {
    if (!one || typeof one !== "object" || Array.isArray(one)) return; // 표가 아니면 위에서 이미 알렸다
    if (!["date", "lunar", "time"].some((k) => one[k] != null)) ctx.addIssue({ code: "custom", message: "{name}: date · lunar · time 중 하나는 있어야 합니다(없으면 항상 이 문구만 나옵니다)." });
  }, ALWAYS);

const special = z
  .record(z.string(), entry, { error: "special은 이름을 붙인 목록이어야 합니다." })
  .superRefine((all, ctx) => {
    if (!all || typeof all !== "object" || Array.isArray(all)) return; // 표가 아니면 위에서 이미 알렸다
    for (const name of Object.keys(all)) {
      if (["true", "false", "", "null"].includes(name)) ctx.addIssue({ code: "custom", message: `"${name || "null"}"는 이름으로 쓸 수 없습니다(YAML이 값으로 읽습니다).` });
      if (NUMERIC_NAME.test(name)) ctx.addIssue({ code: "custom", message: `"${name}": 숫자만으로 된 이름은 차례가 어긋납니다. "${name}년"처럼 글자를 붙여 주세요.` });
    }
  }, ALWAYS)
  .nullish();

const statusFile = z.preprocess(
  plain,
  z.object({
    interval: present((v) => Number(v) >= 10, "interval은 10 이상이어야 합니다(초)."),
    messages,
    special,
  }),
);

/** 상태 설정의 문제 목록. 없으면 빈 배열 */
function statusProblems(data) {
  // messages 는 평소 문구거나 special 아래 이름의 문구다
  return problemsOf(statusFile, data, (path) => {
    const name = path[0] === "special" ? path[1] : undefined;
    return { name, where: name ?? "평소 문구" };
  });
}

const exported = { statusProblems, ACTIVITY_TYPES };
export default exported;
export { exported as "module.exports" };
