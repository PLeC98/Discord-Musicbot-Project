// 알림 종류마다의 모양(떠 있는 알림, 알림함이 같이 쓴다): 됨은 primary 색, 안내는 secondary 색, 경고는 tertiary 색, 오류는 error 색
import type { Severity } from "../composables/toasts.ts";
import type { IconName } from "../icons.ts";
import { formatClock } from "./locale.ts";

export const TOAST_LOOK: Record<Severity, { icon: IconName; badge: string; bar: string; ink: string }> = {
  success: { icon: "check_circle", badge: "bg-primary-container text-on-primary-container", bar: "bg-primary", ink: "text-primary" },
  info: { icon: "info", badge: "bg-secondary-container text-on-secondary-container", bar: "bg-secondary", ink: "text-secondary" },
  warning: { icon: "warning", badge: "bg-tertiary-container text-on-tertiary-container", bar: "bg-tertiary", ink: "text-tertiary" },
  error: { icon: "error", badge: "bg-error-container text-on-error-container", bar: "bg-error", ink: "text-error" },
};

/** 일어난 때(실시간 로그와 같은 24시간 시:분:초) */
export const toastClock = (ms: number) => formatClock(ms, { seconds: true });

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;

/** 알림함의 때: 오늘이면 시각, 지난 날이면 yyyy/mm/dd */
export const toastWhen = (ms: number, now = Date.now()) => (dayOf(new Date(ms)) === dayOf(new Date(now)) ? toastClock(ms) : dayOf(new Date(ms)));

/** 카드의 때: 1분 안이면 지금, 한 시간 안이면 몇 분, 오늘 안이면 몇 시간, 지난 날이면 yyyy/mm/dd */
export const toastAgo = (ms: number, now = Date.now(), words: { now: string; minutes: (n: number) => string; hours: (n: number) => string }) => {
  const sec = Math.max(0, (now - ms) / 1000);
  if (sec < 60) return words.now;
  if (sec < 3600) return words.minutes(Math.floor(sec / 60));
  if (dayOf(new Date(ms)) === dayOf(new Date(now))) return words.hours(Math.floor(sec / 3600));
  return dayOf(new Date(ms));
};

/** 알림함 때의 툴팁: yyyy/mm/dd hh:mm:ss */
export const toastFull = (ms: number) => `${dayOf(new Date(ms))} ${toastClock(ms)}`;
