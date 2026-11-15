// 봇 프로세스의 CPU 우선순위. 기동 때 한 단계(Windows 의 "보통보다 높음", 유닉스의 nice -7) 올린다. 보통이면 PC 가 바쁠 때
// 같은 우선순위의 스레드와 CPU 시간을 나눠 쓰느라 재생이 끊긴다. 올릴 권한이 없으면(유닉스의 기본) 그대로 돈다.
// 자식은 봇 우선순위를 올리기 전의 값으로 돌린다. Windows 는 보통보다 낮은 클래스만 자식에게 물려주므로 올린 뒤에 띄운 자식이 보통으로 뜨고,
// 유닉스는 올린 값을 자식이 물려받아서 띄운 뒤에 되돌린다

import os from "node:os";
import { codeOf, messageOf } from "./error-text.ts";

const { PRIORITY_ABOVE_NORMAL, PRIORITY_BELOW_NORMAL, PRIORITY_NORMAL } = os.constants.priority;

type Os = Pick<typeof os, "getPriority" | "setPriority">;
/** before, after: 올리기 전과 뒤의 os.getPriority 값(값이 작을수록 우선순위가 높다). raised: 봇이 한 단계 이상 높은 우선순위로 도는가 */
type Raise = { platform: NodeJS.Platform; before: number; after: number; raised: boolean; error?: string };
type Line = { level: "info" | "warn"; text: string };

let state: Raise = { platform: process.platform, before: PRIORITY_NORMAL, after: PRIORITY_NORMAL, raised: false };

/**
 * 기동 때 한 번, 자식 프로세스와 워커 스레드를 띄우기 전에 부른다(Linux 는 스레드마다 값이 따로라 그 뒤에 만든 스레드만 올린 값을 받는다).
 * 우선순위를 올리기만 한다(더 높게 띄운 봇은 그대로 둔다).
 * Windows 에서 우선순위를 제한한 Job Object 안에서는 호출이 성공해도 값이 바뀌지 않으므로 다시 읽은 값으로 판단한다
 */
function raiseSelf(platform: NodeJS.Platform = process.platform, sys: Os = os): Raise {
  const before = sys.getPriority();
  let error: string | undefined;
  if (before > PRIORITY_ABOVE_NORMAL) {
    try {
      sys.setPriority(0, PRIORITY_ABOVE_NORMAL);
    } catch (thrown) {
      // Node 는 시스템 오류의 코드를 info 에 싣는다
      const code = codeOf((thrown as { info?: unknown }).info) ?? codeOf(thrown);
      error = code === undefined ? messageOf(thrown) : String(code);
    }
  }
  const after = sys.getPriority();
  state = { platform, before, after, raised: after <= PRIORITY_ABOVE_NORMAL, ...(error ? { error } : {}) };
  return state;
}

/**
 * 방금 띄운 자식에게 줄 우선순위(os.setPriority 값). 그대로 두면 null.
 * low: 봇에게 양보해야 하는 자식(yt-dlp). 봇 우선순위가 올라 있는 Windows 에서는 낮추지 않는다: 효율 코어가 있으면 낮춘 프로세스가 효율 코어에 몰려 느려진다
 */
function childPriority(low: boolean): number | null {
  if (state.platform === "win32") return low && !state.raised ? PRIORITY_BELOW_NORMAL : null;
  const wanted = low ? Math.max(state.before, PRIORITY_BELOW_NORMAL) : state.before;
  return wanted === state.after ? null : wanted;
}

/** 방금 띄운 자식의 우선순위를 맞춘다. 낮추는 쪽이라 권한이 필요 없다. 실패하면 예외를 던진다 */
function settleChild(pid: number, low: boolean, sys: Os = os) {
  const priority = childPriority(low);
  if (priority !== null) sys.setPriority(pid, priority);
}

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
function describe({ platform, before, after, raised, error }: Raise): Line[] {
  const now = nameOf(after, platform);
  if (!raised) {
    // 유닉스는 권한 없이 올릴 수 없는 것이 기본이라 알리기만 한다
    if (platform !== "win32") return [{ level: "info", text: `프로세스 우선순위: ${now}${error ? `(올리지 못함, ${error})` : ""}` }];
    return [{ level: "warn", text: `프로세스 우선순위를 올리지 못함(현재 ${now}${error ? `, ${error}` : ""}). PC가 바쁠 때 재생이 끊길 수 있음. 대신 yt-dlp 우선순위를 낮춰 실행` }];
  }
  const lines: Line[] = [{ level: "info", text: before === after ? `프로세스 우선순위: ${now}` : `프로세스 우선순위: ${now}(${nameOf(before, platform)}에서 올림)` }];
  // 작업 스케줄러는 작업의 CPU("보통보다 낮음"), I/O, 메모리 우선순위를 모두 낮춰 띄운다. 봇이 올릴 수 있는 것은 CPU 우선순위뿐이다
  if (platform === "win32" && before > PRIORITY_NORMAL) lines.push({ level: "warn", text: "보통보다 낮은 우선순위로 시작됨. CPU 우선순위만 올렸고 I/O, 메모리 우선순위는 여전히 낮을 수 있음. 작업 스케줄러로 실행 중이면 작업 XML의 Priority를 4로 바꿔야 함" });
  return lines;
}

export { raiseSelf, childPriority, settleChild, describe };
export type { Raise };
