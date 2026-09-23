"use strict";

// 봇 활동 문구 설정(status.yaml).

const log = require("../infra/log/logger").child({ category: "config" });
const { load } = require("./yamlStore");
const { NUMERIC_NAME } = require("./genres");

/** 봇 상태 메시지 설정 */
// StatusManager의 TYPE_MAP과 같아야 한다(거기서 require하면 순환이 된다. 테스트로 어긋남을 막는다)
const ACTIVITY_TYPES = ["Playing", "Listening", "Watching", "Competing", "Custom"];

const MAX_TEXT = 128; // 디스코드 활동 문구 길이 상한

// 같은 말을 되풀이하지 않는다. 상태는 회전 주기마다 읽히기 때문이다
let warned = "";

function status() {
  const data = load("status");

  // 장르와 달리 여기서는 던지지 않는다. 이 함수는 setInterval 안에서 주기마다 불리므로,
  // 던지면 타이머에서 잡히지 않는 예외가 되어 상태가 틀린 것보다 나쁜 일이 벌어진다.
  // 대신 무엇이 잘못됐는지 남기고 그대로 돌려준다. 손으로 고친 파일이 조용히 어긋나지 않게.
  const problems = validateStatus(data);
  const key = problems.join("|");
  if (problems.length && key !== warned) log.warn(`status.yaml: ${problems.join(" / ")}`);
  warned = key;

  return data;
}

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

function messageProblems(list, where) {
  const problems = [];
  if (!Array.isArray(list) || list.length === 0) return [`${where}: 문구가 하나는 있어야 합니다.`];

  for (const item of list) {
    const message = typeof item === "string" ? { text: item } : item;
    if (!message || typeof message !== "object") {
      problems.push(`${where}: 문구는 글자로 적거나 text/type으로 풀어 적어야 합니다.`);
      continue;
    }
    if (typeof message.text !== "string" || !message.text.trim()) problems.push(`${where}: 빈 문구가 있습니다.`);
    else if (message.text.length > MAX_TEXT) problems.push(`${where}: 문구가 ${MAX_TEXT}자를 넘습니다. "${message.text.slice(0, 20)}…"`);
    // 종류를 잘못 적으면 조용히 "듣는 중"이 된다. 오타가 말을 안 해 주는 종류라 여기서 잡는다
    if (message.type != null && !ACTIVITY_TYPES.includes(message.type)) problems.push(`${where}: "${message.type}"은 쓸 수 없는 활동 종류입니다(${ACTIVITY_TYPES.join(" · ")}).`);
  }
  return problems;
}

function validateStatus(data) {
  const problems = [];

  if (data?.interval != null && !(Number(data.interval) >= 10)) problems.push("interval은 10 이상이어야 합니다(초).");
  problems.push(...messageProblems(data?.messages, "평소 문구"));

  const special = data?.special;
  if (special != null && (typeof special !== "object" || Array.isArray(special))) {
    problems.push("special은 이름을 붙인 목록이어야 합니다.");
    return problems;
  }

  for (const [name, entry] of Object.entries(special || {})) {
    if (name === "true" || name === "false" || name === "" || name === "null") problems.push(`"${name || "null"}"는 이름으로 쓸 수 없습니다(YAML이 값으로 읽습니다).`);
    if (NUMERIC_NAME.test(name)) problems.push(`"${name}": 숫자만으로 된 이름은 차례가 어긋납니다. "${name}년"처럼 글자를 붙여 주세요.`);

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${name}: 내용이 비었습니다.`);
      continue;
    }

    // 조건이 하나도 없으면 항상 맞아서 아래 항목이 전부 죽는다. 손으로 고치다 범위만 지우면 밟는다
    const kinds = ["date", "lunar", "time"].filter((k) => entry[k] != null);
    if (!kinds.length) problems.push(`${name}: date · lunar · time 중 하나는 있어야 합니다(없으면 항상 이 문구만 나옵니다).`);

    for (const kind of kinds) {
      const problem = rangeProblem(entry[kind], kind);
      if (problem) problems.push(`${name}의 ${kind}: ${problem}`);
    }

    problems.push(...messageProblems(entry.messages, name));
  }

  return problems;
}

module.exports = { status, validateStatus, ACTIVITY_TYPES };
