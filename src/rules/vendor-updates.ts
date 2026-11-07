// 따로 받는 도구(bgutil, ffmpeg)의 새 버전 판정. 주마다 도는 확인(scripts/check-vendor-updates)과 봇 상태 탭이 같이 쓴다

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
  if (!line.test(text)) throw new Error(`${name} 줄을 찾지 못함`);
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

/** gh issue list --json number,title,author,labels 의 한 항목(쓰는 필드만) */
type IssueRow = { number: number; title: string; author?: { login?: string } | null; labels?: ReadonlyArray<{ name: string }> | null };

/**
 * vendor-updates 워크플로가 갱신할 열린 이슈 번호(없으면 null). 라벨이 붙은 것이 먼저다(라벨은 triage 이상 권한이 있는 사람만 붙인다).
 * 라벨이 없으면 제목이 "bgutil "로 시작하고 작성자가 이 워크플로의 계정(설정한 GitHub App 은 app/<slug>, 또는 github-actions)인 것만 선택한다.
 * 공개 저장소라 사람이 같은 제목으로 연 이슈는 선택하지 않는다(선택하면 워크플로가 그 이슈에 라벨을 붙이고 제목과 본문을 덮어쓴다).
 */
function trackedIssue(issues: readonly IssueRow[], label: string, appSlug: string): number | null {
  const labeled = issues.find((issue) => issue.labels?.some((one) => one.name === label));
  if (labeled) return labeled.number;
  const ours = new Set(["app/github-actions", `app/${appSlug}`]);
  return issues.find((issue) => issue.title.startsWith("bgutil ") && ours.has(issue.author?.login ?? ""))?.number ?? null;
}

export { isMonthEndBuild, newerFfmpegRelease, compareVersions, newerRelease, rewriteConstant, auditCounts, trackedIssue };
export type { AuditCounts, IssueRow };
