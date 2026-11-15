// 봇 프로세스의 CPU 우선순위. Windows 에서는 기동 때 "보통보다 높음"으로 올린다. 보통이면 PC 가 바쁠 때 같은 우선순위의 스레드와
// CPU 시간을 나눠 쓰느라 재생이 끊긴다. Windows 는 보통보다 낮은 클래스만 자식에게 물려주므로 올린 뒤에 띄운 자식은 보통으로 뜬다

import os from "node:os";
import { messageOf } from "./error-text.ts";

const { PRIORITY_ABOVE_NORMAL, PRIORITY_NORMAL } = os.constants.priority;

type Os = Pick<typeof os, "getPriority" | "setPriority">;
/** before, after: 올리기 전과 뒤의 os.getPriority 값(값이 작을수록 우선순위가 높다). raised: 봇이 "보통보다 높음" 이상의 우선순위로 도는가 */
type Raise = { before: number; after: number; raised: boolean; error?: string };
type Line = { level: "info" | "warn"; text: string };

let raised = false;

/**
 * 기동 때 한 번, 자식 프로세스를 띄우기 전에 부른다. 우선순위를 올리기만 한다(더 높게 띄운 봇은 그대로 둔다). Windows 가 아니면 읽기만 한다.
 * 우선순위를 제한한 Job Object 안에서는 호출이 성공해도 값이 바뀌지 않으므로 다시 읽은 값으로 판단한다
 */
function raiseSelf(platform: NodeJS.Platform = process.platform, sys: Os = os): Raise {
  const before = sys.getPriority();
  let error: string | undefined;
  if (platform === "win32" && before > PRIORITY_ABOVE_NORMAL) {
    try {
      sys.setPriority(0, PRIORITY_ABOVE_NORMAL);
    } catch (thrown) {
      error = messageOf(thrown);
    }
  }
  const after = sys.getPriority();
  raised = platform === "win32" && after <= PRIORITY_ABOVE_NORMAL;
  return { before, after, raised, ...(error ? { error } : {}) };
}

/** 봇 우선순위가 올라 있는가. 올라 있으면 보통으로 띄운 자식보다 봇이 CPU 를 먼저 받는다 */
const selfRaised = () => raised;

// os.getPriority 가 Windows 에서 주는 값(우선순위 클래스마다 하나)
const WINDOWS_NAMES = new Map([
  [-20, "실시간"],
  [-14, "높음"],
  [-7, "보통보다 높음"],
  [0, "보통"],
  [10, "보통보다 낮음"],
  [19, "낮음"],
]);
const nameOf = (value: number, platform: NodeJS.Platform) => (platform === "win32" ? (WINDOWS_NAMES.get(value) ?? String(value)) : `nice ${value}`);

/** 기동 로그에 남길 줄 */
function describe({ before, after, raised: isRaised, error }: Raise, platform: NodeJS.Platform = process.platform): Line[] {
  const now = nameOf(after, platform);
  if (platform !== "win32") return [{ level: "info", text: `프로세스 우선순위: ${now}` }];
  if (!isRaised) return [{ level: "warn", text: `프로세스 우선순위를 올리지 못함(현재 ${now}${error ? `, ${error}` : ""}). PC가 바쁠 때 재생이 끊길 수 있음. 대신 yt-dlp 우선순위를 낮춰 실행` }];
  const lines: Line[] = [{ level: "info", text: before === after ? `프로세스 우선순위: ${now}` : `프로세스 우선순위: ${now}(${nameOf(before, platform)}에서 올림)` }];
  // 작업 스케줄러는 작업의 CPU("보통보다 낮음"), I/O, 메모리 우선순위를 모두 낮춰 띄운다. 봇이 올릴 수 있는 것은 CPU 우선순위뿐이다
  if (before > PRIORITY_NORMAL) lines.push({ level: "warn", text: "보통보다 낮은 우선순위로 시작됨. CPU 우선순위만 올렸고 I/O, 메모리 우선순위는 여전히 낮을 수 있음. 작업 스케줄러로 실행 중이면 작업 XML의 Priority를 4로 바꿔야 함" });
  return lines;
}

export { raiseSelf, selfRaised, describe };
export type { Raise };
