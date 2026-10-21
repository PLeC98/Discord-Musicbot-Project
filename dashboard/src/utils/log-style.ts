// 로그 줄의 레벨 칩 · 색(실시간 로그와 로그 파일 보기가 같이 쓴다)

import type { LevelName } from "../../../src/infra/log/levels.ts";

// 레벨 필터는 여럿 켜기다(심각한 것부터). 봇은 지금 trace 를 남기지 않지만 LOG_LEVEL=trace 로 둘 수 있어 칩을 둔다
const LEVEL_CHIPS: Array<{ value: LevelName; label: string }> = [
  { value: "fatal", label: "FATAL" },
  { value: "error", label: "ERROR" },
  { value: "warn", label: "WARN" },
  { value: "info", label: "INFO" },
  { value: "debug", label: "DEBUG" },
  { value: "trace", label: "TRACE" },
];
// 레벨 색은 테마와 상관없이 고정(style.css --log-*). 이름은 레벨 색, 글은 trace · debug 는 흐리게(같은 색), info · warn 은 보통 글자색, error · fatal 은 레벨 색
const LEVEL_TONE: Record<LevelName, string> = { trace: "text-(--log-trace)", debug: "text-(--log-debug)", info: "text-(--log-info)", warn: "text-(--log-warn)", error: "text-(--log-error)", fatal: "text-(--log-fatal)" };
const TEXT_TONE: Record<LevelName, string> = { trace: "text-(--log-trace)", debug: "text-(--log-debug)", info: "text-on-surface", warn: "text-on-surface", error: "text-(--log-error)", fatal: "text-(--log-fatal) font-semibold" };

/** 카테고리 색: 이름에서 정한 고정 색(style.css --log-cat-1..8, 밝기마다 따로). 이름 글이 같이 있어 색은 보조다 */
function catColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `var(--log-cat-${(h % 8) + 1})`;
}

export { LEVEL_CHIPS, LEVEL_TONE, TEXT_TONE, catColor };
