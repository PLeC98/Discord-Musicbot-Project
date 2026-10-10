// 화면 오른쪽 위의 작은 알림. 저장 · 보내기 같은 조작의 결과(됨 · 실패)와 거절된 까닭을 몇 초 보여 준다.
// 뜬 알림은 알림함(위 막대 오른쪽 끝의 종)에도 남는다. 페이지를 새로 열면 비는 이 탭만의 기록이다
// 어느 칸이 틀렸는지 짚는 검사(장르 이름 겹침, 곡 주소 형식 등)는 그 칸 옆에 두고 여기로 보내지 않는다

import { computed, reactive } from "vue";
import { problemNotice, type ProblemNotice } from "../utils/problem.ts";
import { failureKind, statusOf } from "../utils/request.ts";

// 됨은 읽을 것이 적어 짧게(M3 스낵바 4초), 실패 · 경고는 까닭을 읽게 길게
const SHOW_MS = { success: 4000, warning: 6000, error: 6000 };
const MAX = 3;
const INBOX_MAX = 50;

/** 알림 종류. 봇 안내의 오류 · 경고에 화면만의 됨을 더한다 */
type Severity = ProblemNotice["severity"] | "success";
/** 떠 있는 알림 하나 */
// at: 일어난 때(같은 알림이 다시 오면 그때로), ms: 떠 있는 시간(아래 띠가 이만큼 걸려 찬다), round: 시간을 다시 잴 때마다 하나씩(띠를 처음부터 다시 채운다)
type Toast = Omit<ProblemNotice, "severity"> & { severity: Severity; id: number; timer: ReturnType<typeof setTimeout>; at: number; ms: number; round: number };

export const toasts = reactive<Toast[]>([]);
let nextId = 1;

/** 알림함의 한 줄. 떠 있는 알림이 사라져도 남는다. 새 것이 맨 위 */
type InboxItem = Omit<Toast, "timer" | "ms" | "round"> & { read: boolean };
export const inbox = reactive<InboxItem[]>([]);
export const unread = computed(() => inbox.filter((one) => !one.read).length);

// 알림함에 넣는다. 같은 알림이 다시 왔으면 그 줄을 맨 위로 올리고 다시 안 읽음으로
function keep({ id, title, body, detail, codeLine, severity, reportUrl, at }: Toast) {
  const old = inbox.findIndex((one) => one.id === id);
  if (old >= 0) inbox.splice(old, 1);
  inbox.unshift({ id, title, body, detail, codeLine, severity, reportUrl, at, read: false });
  if (inbox.length > INBOX_MAX) inbox.splice(INBOX_MAX);
}

export function markAllRead(): void {
  for (const one of inbox) one.read = true;
}

export function removeFromInbox(id: number): void {
  const at = inbox.findIndex((one) => one.id === id);
  if (at >= 0) inbox.splice(at, 1);
}

export function dismiss(id: number): void {
  const at = toasts.findIndex((one) => one.id === id);
  if (at >= 0) {
    clearTimeout(toasts[at].timer);
    toasts.splice(at, 1);
  }
}

/** 알림 하나. 새 것이 맨 위다. 같은 글이 떠 있으면 새로 쌓지 않고 그것의 시간을 다시 잰다 */
export function notify({ title, body = "", detail = "", codeLine = "", severity = "error", reportUrl = "" }: Pick<Toast, "title"> & Partial<Omit<Toast, "id" | "timer" | "at" | "ms" | "round">>): void {
  const same = toasts.find((one) => one.title === title && one.body === body && one.codeLine === codeLine);
  if (same) {
    clearTimeout(same.timer);
    same.timer = setTimeout(() => dismiss(same.id), same.ms);
    same.at = Date.now();
    same.round++;
    keep(same);
    return;
  }
  const id = nextId++;
  const ms = SHOW_MS[severity];
  toasts.unshift({ id, title, body, detail, codeLine, severity, reportUrl, timer: setTimeout(() => dismiss(id), ms), at: Date.now(), ms, round: 0 });
  keep(toasts[0]);
  while (toasts.length > MAX) dismiss(toasts[toasts.length - 1].id);
}

/** 조작이 된 알림(저장했어요 등) */
export function notifyDone(title: string, body = ""): void {
  notify({ title, body, severity: "success" });
}

/** 요청 오류의 알림. 세션 끝(401) · 연결 안 됨은 SessionNotice 의 띠가 이미 알리고, 화면이 끊은 요청(페이지를 떠남)은 알릴 것이 없다 */
export function notifyProblem(error: unknown, fallback: string): void {
  const kind = failureKind(error);
  if (statusOf(error) === 401 || kind === "aborted" || kind === "offline") return;
  notify(problemNotice(error, fallback));
}

export type { Toast, Severity, InboxItem };
