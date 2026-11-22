// 화면 오른쪽 위의 작은 알림. 저장, 보내기 같은 조작의 결과(됨, 실패)와 거절된 이유를 몇 초 보여 준다.
// 뜬 알림은 알림함(위 막대 오른쪽 끝의 종)에도 남는다. 페이지를 새로 열면 비는 이 탭만의 기록이다
// 떠 있는 알림과 알림함은 같은 서랍(shell/NoticeDrawer)에, 같은 카드(components/NoticeCard)로 그린다
// 어느 입력란이 틀렸는지 표시하는 검사(장르 이름 겹침, 곡 주소 형식 등)는 그 입력란 옆에 두고 여기로 보내지 않는다

import { computed, reactive, ref } from "vue";
import { problemNotice, type ProblemNotice } from "../utils/problem.ts";
import { failureKind, statusOf, problemCodeOf, replyOf } from "../utils/request.ts";
import type { IconName } from "../icons.ts";

// 됨은 읽을 것이 적어 짧게(M3 스낵바 4초), 안내, 실패, 경고는 읽을 수 있게 길게
const SHOW_MS = { success: 4000, info: 6000, warning: 6000, error: 6000 };
const MAX = 3;
const INBOX_MAX = 50;

/** 알림 종류. 봇이 보내는 오류, 경고에 화면에서만 쓰는 됨, 안내(새 버전 있음 등)를 더한다 */
type Severity = ProblemNotice["severity"] | "success" | "info";
/**
 * 알림 카드 아래 버튼 하나. 셋 중 하나를 준다.
 * to: 누르면 그 화면으로(라우터 경로, 알림함도 닫는다), href: 새 탭으로 여는 주소, run: 그 밖의 동작
 */
type ToastAction = { label: string; icon?: IconName; to?: string; href?: string; run?: () => void };
/** 떠 있는 알림 하나 */
// at: 일어난 때(같은 알림이 다시 오면 그때로), ms: 떠 있는 시간(아래 띠가 이만큼 걸려 찬다), round: 시간을 처음부터 다시 잴 때마다 하나씩(띠를 처음부터 다시 채운다),
// due: 사라질 때, paused: 마우스를 올려 멈춘 동안 남은 시간(멈추지 않았으면 null)
type Toast = Omit<ProblemNotice, "severity"> & { severity: Severity; actions: ToastAction[]; id: number; timer: ReturnType<typeof setTimeout>; at: number; ms: number; round: number; due: number; paused: number | null };

export const toasts = reactive<Toast[]>([]);
let nextId = 1;

/** 알림함의 한 항목. 떠 있는 알림이 사라져도 남는다. 새 것이 맨 위 */
type InboxItem = Omit<Toast, "timer" | "ms" | "round" | "due" | "paused"> & { read: boolean };
export const inbox = reactive<InboxItem[]>([]);
export const unread = computed(() => inbox.filter((one) => !one.read).length);

// ── 알림함 열고 닫기(위 막대의 종이 열고, 서랍이 그린다) ──
export const inboxOpen = ref(false);
export function openInbox(): void {
  markAllRead();
  inboxOpen.value = true;
}
export function closeInbox(): void {
  inboxOpen.value = false;
  // 열어 둔 동안 온 것도 봤으니 읽음으로
  markAllRead();
}

// 알림함에 넣는다. 같은 알림이 다시 왔으면 그 항목을 맨 위로 올리고 다시 안 읽음으로(열어 둔 동안이면 보고 있으니 읽음으로)
function keep({ id, title, body, detail, codeLine, severity, reportUrl, actions, at }: Toast) {
  const old = inbox.findIndex((one) => one.id === id);
  if (old >= 0) inbox.splice(old, 1);
  inbox.unshift({ id, title, body, detail, codeLine, severity, reportUrl, actions, at, read: inboxOpen.value });
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

/** 알림 하나. 새 것이 맨 위다. 같은 글이 떠 있으면 새로 쌓지 않고 그것의 시간을 다시 잰다. 알림의 id(같은 글이면 떠 있던 것의 id)를 돌려준다 */
export function notify({ title, body = "", detail = "", codeLine = "", severity = "error", reportUrl = "", actions = [] }: Pick<Toast, "title"> & Partial<Omit<Toast, "id" | "timer" | "at" | "ms" | "round" | "due" | "paused">>): number {
  const same = toasts.find((one) => one.title === title && one.body === body && one.codeLine === codeLine);
  if (same) {
    // 멈춰 둔 동안이면 남은 시간만 처음으로 돌리고 멈춘 채로 둔다
    if (same.paused !== null) same.paused = same.ms;
    else {
      clearTimeout(same.timer);
      same.timer = setTimeout(() => dismiss(same.id), same.ms);
      same.due = Date.now() + same.ms;
    }
    same.at = Date.now();
    same.round++;
    keep(same);
    return same.id;
  }
  const id = nextId++;
  const ms = SHOW_MS[severity];
  toasts.unshift({ id, title, body, detail, codeLine, severity, reportUrl, actions, timer: setTimeout(() => dismiss(id), ms), at: Date.now(), ms, round: 0, due: Date.now() + ms, paused: null });
  keep(toasts[0]);
  while (toasts.length > MAX) dismiss(toasts[toasts.length - 1].id);
  return id;
}

/** 떠 있는 동안 시간을 멈추고(마우스를 올렸을 때), 멈춘 자리부터 이어 잰다(뗐을 때) */
export function holdToast(id: number, held: boolean): void {
  const one = toasts.find((t) => t.id === id);
  if (!one || held === (one.paused !== null)) return;
  if (held) {
    clearTimeout(one.timer);
    one.paused = Math.max(0, one.due - Date.now());
    return;
  }
  const left = one.paused ?? one.ms;
  one.paused = null;
  one.due = Date.now() + left;
  one.timer = setTimeout(() => dismiss(id), left);
}

/** 조작이 된 알림(저장했어요 등) */
export function notifyDone(title: string, body = ""): void {
  notify({ title, body, severity: "success" });
}

/** 요청 오류의 알림. 세션 끝(401), 다시 로그인, 연결 안 됨은 SessionNotice가 이미 알리고, 화면이 끊은 요청(페이지를 떠남)은 알릴 것이 없다 */
export function notifyProblem(error: unknown, fallback: string, detailLine?: (line: string) => string): void {
  const kind = failureKind(error);
  // 세션 만료, 재로그인, 계정 변경은 대화상자와 상단 배너로 알린다
  const code = problemCodeOf(replyOf(error));
  if (statusOf(error) === 401 || code === "reauth-required" || code === "account-changed" || kind === "aborted" || kind === "offline") return;
  notify(problemNotice(error, fallback, detailLine));
}

export type { Toast, Severity, InboxItem, ToastAction };
