// 따로 받는 도구(bgutil · ffmpeg)의 새 버전 판정. 주마다 도는 확인(scripts/check-vendor-updates)과 봇 상태 탭이 같이 쓴다

/** 월말 autobuild 태그인가(autobuild-YYYY-MM-DD-HH-MM 이고 그날이 그 달의 마지막 날). 그 외 autobuild 는 2주 뒤 지워진다 */
function isMonthEndBuild(tag: string) {
  const m = /^autobuild-(\d{4})-(\d{2})-(\d{2})-\d{2}-\d{2}$/.exec(tag);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return day === new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 지금 것보다 새 월말 태그 중 가장 새 것. 없으면 null. 태그는 시각 순으로 적혀 글자 차례가 곧 시간 차례다 */
function newerFfmpegRelease(tags: readonly string[], current: string) {
  const newest = tags.filter(isMonthEndBuild).sort().at(-1);
  return newest && newest > current ? newest : null;
}

/** "x.y.z"(앞의 v 는 무시) 끼리. 모양이 다르면 null */
function compareVersions(a: string, b: string) {
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())?.slice(1).map(Number) ?? null;
  const [x, y] = [parse(a), parse(b)];
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** latest 가 current 보다 새로우면 latest, 아니면(같거나 모양이 다르면) null */
function newerRelease(latest: string | null | undefined, current: string) {
  return latest && (compareVersions(latest, current) ?? 0) > 0 ? latest : null;
}

/** `const NAME = "값";` 한 줄의 값을 바꾼다. 그 줄이 없으면 던진다(파일 모양이 바뀌면 조용히 지나가지 않게) */
function rewriteConstant(text: string, name: string, value: string) {
  const line = new RegExp(`^const ${name} = "[^"\\n]*";$`, "m");
  if (!line.test(text)) throw new Error(`${name} 줄을 찾지 못했습니다`);
  return text.replace(line, `const ${name} = "${value}";`);
}

/** 심각도별 수 */
type AuditCounts = { total: number; critical: number; high: number; moderate: number; low: number };

/** `npm audit --json` 의 결과 → 심각도별 수. 모양이 다르면 null(읽지 못한 것을 0건으로 치지 않게) */
function auditCounts(json: unknown): AuditCounts | null {
  const v = (json as { metadata?: { vulnerabilities?: Record<string, unknown> } } | null)?.metadata?.vulnerabilities;
  if (!v || typeof v.total !== "number") return null;
  const n = (key: string) => (typeof v[key] === "number" ? (v[key] as number) : 0);
  return { total: v.total, critical: n("critical"), high: n("high"), moderate: n("moderate"), low: n("low") };
}

export { isMonthEndBuild, newerFfmpegRelease, compareVersions, newerRelease, rewriteConstant, auditCounts };
export type { AuditCounts };
