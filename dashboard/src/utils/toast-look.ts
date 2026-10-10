// 알림 종류마다의 모양(떠 있는 알림 · 알림함이 같이 쓴다): 됨은 주 색, 경고는 3차 색, 오류는 오류 색
import type { Severity } from "../composables/toasts.ts";

export const TOAST_LOOK: Record<Severity, { icon: string; badge: string; bar: string; ink: string }> = {
  success: { icon: "check_circle", badge: "bg-primary-container text-on-primary-container", bar: "bg-primary", ink: "text-primary" },
  warning: { icon: "warning", badge: "bg-tertiary-container text-on-tertiary-container", bar: "bg-tertiary", ink: "text-tertiary" },
  error: { icon: "error", badge: "bg-error-container text-on-error-container", bar: "bg-error", ink: "text-error" },
};

/** 일어난 때(실시간 로그와 같은 24시간 시:분:초) */
export const toastClock = (ms: number) => new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;

/** 알림함의 때: 오늘이면 시각, 지난 날이면 yyyy/mm/dd */
export const toastWhen = (ms: number, now = Date.now()) => (dayOf(new Date(ms)) === dayOf(new Date(now)) ? toastClock(ms) : dayOf(new Date(ms)));

/** 알림함 때의 툴팁: yyyy/mm/dd hh:mm:ss */
export const toastFull = (ms: number) => `${dayOf(new Date(ms))} ${toastClock(ms)}`;
