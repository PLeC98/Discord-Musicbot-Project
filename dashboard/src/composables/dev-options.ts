// 운영자 패널의 개발자 옵션 탭을 보일지. 안드로이드처럼 봇 정보 탭의 Version을 여러 번 눌러 켜고, 그 탭 맨 위 스위치로 끈다.
// 화면 정리용이라 브라우저마다 따로 기억한다(권한과 상관없다. 패널과 API는 원래 운영자만 쓴다)

import { ref } from "vue";
import { readStored, removeStored, writeStored } from "../utils/storage.ts";

const KEY = "admin:dev-options";

export const devOptions = ref(readStored(KEY) === "on");

export function setDevOptions(on: boolean): void {
  devOptions.value = on;
  if (on) writeStored(KEY, "on");
  else removeStored(KEY);
}

/** 켜기까지 누르는 횟수 */
export const TAPS_TO_UNLOCK = 7;
// 남은 횟수가 이 값 이하일 때부터 알린다(안드로이드처럼 처음 두 번은 조용히)
const SHOW_LEFT_FROM = 4;

/** Version을 누른 결과. taps: 지금까지 누른 횟수(켜져 있을 때는 세지 않는다). quiet: 알리지 않는다 */
export function tapOutcome(taps: number, on: boolean): { kind: "already" } | { kind: "unlocked" } | { kind: "left"; left: number } | { kind: "quiet" } {
  if (on) return { kind: "already" };
  const left = TAPS_TO_UNLOCK - taps;
  if (left <= 0) return { kind: "unlocked" };
  return left <= SHOW_LEFT_FROM ? { kind: "left", left } : { kind: "quiet" };
}
