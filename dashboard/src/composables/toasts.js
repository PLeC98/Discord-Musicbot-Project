// 화면 위의 작은 알림. 조작이 거절되거나 실패했을 때 까닭을 몇 초 보여 준다.
// 곡 넣기 · 부르기 · 설정처럼 입력 칸이 있는 곳은 그 칸 옆에 적고 여기로 보내지 않는다

import { reactive } from "vue";
import { problemNotice } from "../utils/problem.js";
import { failureKind } from "../utils/request.js";

const SHOW_MS = 6000;
const MAX = 3;

export const toasts = reactive([]);
let nextId = 1;

export function dismiss(id) {
  const at = toasts.findIndex((one) => one.id === id);
  if (at >= 0) {
    clearTimeout(toasts[at].timer);
    toasts.splice(at, 1);
  }
}

/** 알림 하나. 같은 글이 떠 있으면 새로 쌓지 않고 그것의 시간을 다시 잰다 */
export function notify({ title, body = "", detail = "", codeLine = "", severity = "error" }) {
  const same = toasts.find((one) => one.title === title && one.body === body && one.codeLine === codeLine);
  if (same) {
    clearTimeout(same.timer);
    same.timer = setTimeout(() => dismiss(same.id), SHOW_MS);
    return;
  }
  const id = nextId++;
  toasts.push({ id, title, body, detail, codeLine, severity, timer: setTimeout(() => dismiss(id), SHOW_MS) });
  while (toasts.length > MAX) dismiss(toasts[0].id);
}

/** 요청 오류의 알림. 세션 끝(401) · 연결 안 됨은 SessionNotice 의 띠가 이미 알리고, 화면이 끊은 요청(페이지를 떠남)은 알릴 것이 없다 */
export function notifyProblem(error, fallback) {
  if (error?.response?.status === 401 || ["aborted", "offline"].includes(failureKind(error))) return;
  notify(problemNotice(error, fallback));
}
