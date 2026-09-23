"use strict";

// 봇 활동 문구 설정(status.yaml).

const log = require("../infra/log/logger").child({ category: "config" });
const { load } = require("./yamlStore");
const { statusProblems, ACTIVITY_TYPES } = require("./schema/status");

const validateStatus = statusProblems;

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

module.exports = { status, validateStatus, ACTIVITY_TYPES };
