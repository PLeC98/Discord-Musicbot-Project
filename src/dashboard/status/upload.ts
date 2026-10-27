// 봇 상태 탭의 업로드: 봇(음성 · 대시보드)과 이 기계 전체. 15초 구간마다 누계의 차이로 잰다(다운로드처럼 지난 15초 평균).
// 시스템 누계는 Windows 에서 PowerShell 에 물어 받으므로 구간을 닫을 때 기다린다

import { uploadTotals } from "../../infra/upload-meter.ts";
import { sentBetween, systemSent, type Sent } from "../../infra/system-upload.ts";
import type { AdminStatus } from "../contract/admin.ts";

type Mark = { at: number; voice: number; dashboard: number; system: Sent | null };
type ReadSystem = () => Promise<Sent | null>;

let readSystem: ReadSystem = systemSent;
let mark: Mark | null = null;
let today = { day: "", bytes: 0 };
let view: AdminStatus["upload"] = { bot: 0, voice: 0, dashboard: 0, system: null, todayBytes: 0 };

// 봇 누계는 바로, 시스템 누계는 답을 받아서
async function markAt(at: number): Promise<Mark> {
  return { at, ...uploadTotals(), system: await readSystem() };
}

/** 처음 누계를 잡는다(첫 구간부터 속도가 나오게). read: 시스템 누계를 읽는 것(시험은 프로그램을 띄우지 않게 바꾼다) */
async function startUpload(read: ReadSystem = systemSent, at = Date.now()) {
  readSystem = read;
  // 받는 사이 구간이 먼저 닫혔으면 그쪽이 더 새 누계다
  const first = await markAt(at);
  mark ??= first;
}

/** 구간을 닫고 지난 구간의 속도를 낸다 */
async function closeUploadWindow(at = Date.now()) {
  const next = await markAt(at);
  const from = mark;
  mark = next;
  if (!from) return view;
  const seconds = (next.at - from.at) / 1000;
  const voice = next.voice - from.voice;
  const dashboard = next.dashboard - from.dashboard;
  const day = new Date(at).toDateString();
  today = today.day === day ? { day, bytes: today.bytes + voice + dashboard } : { day, bytes: voice + dashboard };
  const rate = (bytes: number) => (seconds > 0 ? Math.round(bytes / seconds) : 0);
  view = {
    bot: rate(voice + dashboard),
    voice: rate(voice),
    dashboard: rate(dashboard),
    system: from.system && next.system ? rate(sentBetween(from.system, next.system)) : null,
    todayBytes: today.bytes,
  };
  return view;
}

/** 지난 구간 값. todayBytes 는 이 기계의 자정부터 */
const uploadView = () => view;

/** 시험: 처음으로 */
function _reset() {
  mark = null;
  today = { day: "", bytes: 0 };
  view = { bot: 0, voice: 0, dashboard: 0, system: null, todayBytes: 0 };
}

export { startUpload, closeUploadWindow, uploadView, _reset };
export type { ReadSystem };
