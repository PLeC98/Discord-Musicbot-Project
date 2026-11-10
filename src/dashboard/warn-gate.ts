// 요청이 일으키는 경고 로그의 상한. 같은 키는 구간마다 한 번, 구간마다 상한까지. 상한에 닿으면 그 구간에 한 번 알린다(막는 것은 그대로)

/** 구간 길이와 구간마다의 상한 */
const WARN_WINDOW_MS = 60 * 60_000;
const WARN_MAX = 32;

/** key마다 "warn"(남긴다), "cap"(상한에 닿았다고 한 번 남긴다), "skip"(남기지 않는다) */
function warnGate(now = () => Date.now()) {
  let windowStart = now();
  const seen = new Set<string>();
  let capped = false;
  return (key: string): "warn" | "cap" | "skip" => {
    if (now() - windowStart >= WARN_WINDOW_MS) {
      windowStart = now();
      seen.clear();
      capped = false;
    }
    if (seen.has(key)) return "skip";
    if (seen.size < WARN_MAX) {
      seen.add(key);
      return "warn";
    }
    if (capped) return "skip";
    capped = true;
    return "cap";
  };
}

export { warnGate, WARN_MAX, WARN_WINDOW_MS };
