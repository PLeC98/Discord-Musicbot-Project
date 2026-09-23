// 봇 활동 문구 설정(status.yaml).
//
// 틀린 파일은 쓰지 않는다. 기동 때 틀렸으면 장르처럼 문제를 전부 알리고 기동을 멈춘다(index.js).
// 돌던 중에 손으로 고친 파일이 틀렸으면 멈출 수 없으니(이 함수는 setInterval 안에서 불린다) 문제를 알리고
// 직전에 맞던 설정으로 계속 돈다. 고치면 다음 회전부터 새 설정이 들어간다.

import logger from "../infra/log/logger.js";
const log = logger.child({ category: "config" });
import yamlStore from "./yamlStore.js";
const { load } = yamlStore;
import statusModule from "./schema/status.js";
const { statusProblems, ACTIVITY_TYPES } = statusModule;

const validateStatus = statusProblems;

let lastGood = null;
// 같은 말을 되풀이하지 않는다. 상태는 회전 주기마다 읽히기 때문이다
let reported = "";

/** 검사를 통과한 설정. 틀렸으면 문제를 한 줄씩 적은 CONFIG_INVALID 로 던진다 */
function checkedStatus() {
  const data = load("status");
  const problems = validateStatus(data);
  if (problems.length) {
    throw Object.assign(new Error(["config/status.yaml 을 읽을 수 없습니다:", ...problems.map((p) => `   ${p}`)].join("\n")), { code: "CONFIG_INVALID" });
  }
  return data;
}

/** 활동 문구 설정. 기동 때 틀렸으면 던지고, 돌던 중에 틀리면 알리고 직전에 맞던 설정을 돌려준다 */
function status() {
  try {
    lastGood = checkedStatus();
    reported = "";
    return lastGood;
  } catch (error) {
    if (error.code !== "CONFIG_INVALID" || !lastGood) throw error;
    if (error.message !== reported) log.error(`${error.message}\n   고칠 때까지 직전에 맞던 설정으로 돕니다.`);
    reported = error.message;
    return lastGood;
  }
}

const exported = { status, validateStatus, ACTIVITY_TYPES, _reset: () => ((lastGood = null), (reported = "")) };
export default exported;
export { exported as "module.exports" };
