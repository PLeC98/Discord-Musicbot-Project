// 봇 활동 문구 설정(status.yaml).
//
// 틀린 파일은 쓰지 않는다. 기동 때 틀렸으면 장르처럼 문제를 전부 알리고 기동을 멈춘다(index.ts).
// 돌던 중에 손으로 고친 파일이 틀렸으면 멈출 수 없으니(이 함수는 setInterval 안에서 불린다) 문제를 알리고
// 직전에 맞던 설정으로 계속 돈다. 고치면 다음 회전부터 새 설정이 들어간다.

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
import { load } from "./yamlStore.ts";
import { codeOf, messageOf } from "../rules/errorKind.ts";
import { statusProblems, ACTIVITY_TYPES } from "./schema/status.ts";

const validateStatus = statusProblems;

/** 문구 하나. 글자로 적거나 { text, type } 으로 풀어 적는다 */
type ActivityMessage = string | { text: string; type?: string };
/** 때가 맞으면 평소 문구 대신 나오는 문구. 범위는 "MM-DD ~ MM-DD" · "HH:MM ~ HH:MM" */
type StatusEntry = { date?: string; lunar?: string; time?: string; messages: ActivityMessage[] };
// 검사를 지난 모양. interval 은 글자로 적어도 통과한다(읽는 쪽이 Number 로)
type StatusConfig = { interval?: unknown; messages: ActivityMessage[]; special?: Record<string, StatusEntry> | null };

let lastGood: StatusConfig | null = null;
// 같은 말을 되풀이하지 않는다. 상태는 회전 주기마다 읽히기 때문이다
let reported = "";

/** 검사를 통과한 설정. 틀렸으면 문제를 한 줄씩 적은 CONFIG_INVALID 로 던진다 */
function checkedStatus(): StatusConfig {
  const data = load("status");
  const problems = validateStatus(data);
  if (problems.length) {
    throw Object.assign(new Error(["config/status.yaml 을 읽을 수 없습니다:", ...problems.map((p) => `   ${p}`)].join("\n")), { code: "CONFIG_INVALID" });
  }
  return data as StatusConfig;
}

/** 활동 문구 설정. 기동 때 틀렸으면 던지고, 돌던 중에 틀리면 알리고 직전에 맞던 설정을 돌려준다 */
function status(): StatusConfig {
  try {
    lastGood = checkedStatus();
    reported = "";
    return lastGood;
  } catch (error) {
    if (codeOf(error) !== "CONFIG_INVALID" || !lastGood) throw error;
    const message = messageOf(error);
    if (message !== reported) log.error(`${message}\n   고칠 때까지 직전에 맞던 설정으로 돕니다.`);
    reported = message;
    return lastGood;
  }
}

export { status, validateStatus, ACTIVITY_TYPES };
export const _reset = () => ((lastGood = null), (reported = ""));
export type { ActivityMessage, StatusEntry, StatusConfig };
