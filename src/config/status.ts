// 봇 활동 문구 설정(settings.db 의 "status" 문서, config/documents).
//
// 틀린 문서는 쓰지 않는다. 문제를 전부 알리고 직전에 맞던 설정으로, 그것도 없으면(기동 때부터 틀림) 빈 설정(활동 문구 없음)으로 돈다.
// 기동을 멈추지 않는다. 고칠 대시보드가 실행돼야 한다(2차 16단계 "정한 것" 6). 고치면 다음 회전부터 새 설정이 들어간다.

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
import * as documents from "./documents.ts";
import { codeOf, messageOf } from "../rules/error-kind.ts";
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
  const data = documents.get("status");
  const problems = validateStatus(data);
  if (problems.length) {
    throw Object.assign(new Error(["활동 문구 설정을 읽을 수 없습니다:", ...problems.map((p) => `   ${p}`)].join("\n")), { code: "CONFIG_INVALID" });
  }
  return data as StatusConfig;
}

// 맞는 설정이 한 번도 없었을 때. 문구가 없으니 활동을 걸지 않는다
const EMPTY: StatusConfig = { messages: [] };

/** 활동 문구 설정. 틀리면 알리고 직전에 맞던 설정을, 그것도 없으면 빈 설정을 돌려준다 */
function status(): StatusConfig {
  try {
    lastGood = checkedStatus();
    reported = "";
    return lastGood;
  } catch (error) {
    if (codeOf(error) !== "CONFIG_INVALID") throw error;
    const message = messageOf(error);
    if (message !== reported) log.error(`${message}\n   ${lastGood ? "고칠 때까지 직전에 맞던 설정으로 돕니다." : "고칠 때까지 활동 문구를 걸지 않습니다. 운영자 패널의 상태 문구 탭에서 고치세요."}`);
    reported = message;
    return lastGood ?? EMPTY;
  }
}

export { status, validateStatus, ACTIVITY_TYPES };
export const _reset = () => ((lastGood = null), (reported = ""));
export type { ActivityMessage, StatusEntry, StatusConfig };
