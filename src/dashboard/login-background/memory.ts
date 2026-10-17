// 로그인 배경의 메모리 관문: 크기 어림(약 1.4GB)과 굽기가 16GB 서버에서 함께 돌 수 있어, 무거운 ffmpeg 를 띄우기 전에 남은 메모리를 본다.
// AV1(SVT-AV1)은 병렬 단계(lp 1 ~ 5)마다 메모리가 크게 달라(4K 3.5 ~ 7.9GB, research §11.10) 지금 남은 메모리에 드는 가장 높은 단계로 굽는다.
// 단계 2 도 들지 않으면 기다리고(5초마다 본다), 30분을 기다려도 모자라면 드는 단계(없으면 1)로 굽는다(기기 메모리가 원래 작다).
// 나눠 굽기는 VP9 4K 가 시간을 잡아 AV1 을 3 으로 내려도 시간이 거의 같아 3(모자라면 2)으로 굽고, 2 도 들지 않으면 따로 굽는다

import os from "node:os";
import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "dashboard" });

const GB = 1024 ** 3;
/** 잰 값에 더하는 여유 */
const MARGIN = 1.1;
/** AV1 하나의 최대 메모리(GB, 병렬 단계 1 ~ 5 차례. 이 PC 에서 잼, research §11.10) */
const AV1_GB = { uhd: [3.5, 4.0, 5.0, 6.3, 7.9], fhd: [1.3, 1.5, 1.7, 2.0, 2.5] };
/** 나눠 굽기(AV1 · VP9 의 4K · 1080p 넷)의 최대 메모리(GB, 병렬 단계 2 · 3) */
const SPLIT_UHD_GB: Record<number, number> = { 2: 6.3, 3: 7.6 };
/** VP9 하나 · H.264 720p 하나 · 크기 어림(GB) */
const VP9_GB = { uhd: 1.6, fhd: 0.85 };
const LIGHT_GB = 1.4;

/** AV1 의 가장 높은 병렬 단계(그 위는 메모리만 늘고 빨라지지 않았다) */
const AV1_LP_MAX = 5;
/** 나눠 굽기의 병렬 단계(높은 것부터) */
const SPLIT_LPS = [3, 2];
/** 기다리기 전에 받아들이는 가장 낮은 단계(1 은 2 보다 3배 느리다) */
const AV1_LP_WAIT = 2;

const bytes = (gb: number) => gb * MARGIN * GB;

/** 일 하나의 대략의 최대 메모리(바이트). AV1 은 그 병렬 단계에서 */
function needOf(job: { codec: "av1" | "vp9" | "h264" | "probe"; uhd?: boolean; lp?: number }): number {
  const size = job.uhd ? "uhd" : "fhd";
  if (job.codec === "av1") return bytes(AV1_GB[size][(job.lp ?? AV1_LP_MAX) - 1]);
  if (job.codec === "vp9") return bytes(VP9_GB[size]);
  return bytes(LIGHT_GB);
}

/** 지금 남은 메모리(free)에 드는 AV1 의 가장 높은 병렬 단계(하나도 들지 않으면 null) */
function av1Lp(uhd: boolean, free = os.freemem()): number | null {
  for (let lp = AV1_LP_MAX; lp >= 1; lp--) if (needOf({ codec: "av1", uhd, lp }) <= free) return lp;
  return null;
}

/** 나눠 굽기의 병렬 단계(남은 메모리에 들지 않으면 null = 따로 굽는다). 4K 가 없으면 1080p 둘(AV1 · VP9)을 더한 값으로 */
function splitLp(uhd: boolean, free = os.freemem()): number | null {
  const need = (lp: number) => (uhd ? bytes(SPLIT_UHD_GB[lp]) : needOf({ codec: "av1", lp }) + needOf({ codec: "vp9" }));
  return SPLIT_LPS.find((lp) => need(lp) <= free) ?? null;
}

const POLL_MS = 5_000;
const WAIT_MAX_MS = 30 * 60_000;

/** 남은 메모리가 bytes 이상이 될 때까지 기다린다. 멈추면(signal) 바로 끝난다 */
async function enoughMemory(need: number, what: string, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  let told = false;
  while (os.freemem() < need && !signal.aborted && Date.now() - started < WAIT_MAX_MS) {
    if (!told) log.info({ sub: "admin" }, `로그인 배경 ${what}: 남은 메모리가 모자라 기다립니다(${(os.freemem() / GB).toFixed(1)}GB / ${(need / GB).toFixed(1)}GB)`);
    told = true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** AV1 하나를 구울 병렬 단계: 지금 드는 가장 높은 것. 2 도 들지 않으면 2 가 들 때까지 기다리고, 그래도 모자라면 드는 것(없으면 1) */
async function av1LpFor(uhd: boolean, what: string, signal: AbortSignal): Promise<number> {
  const now = av1Lp(uhd);
  if (now !== null && now >= AV1_LP_WAIT) return now;
  await enoughMemory(needOf({ codec: "av1", uhd, lp: AV1_LP_WAIT }), what, signal);
  return av1Lp(uhd) ?? 1;
}

export { needOf, av1Lp, splitLp, av1LpFor, enoughMemory, AV1_LP_MAX };
