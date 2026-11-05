// 봇 상태 탭의 자식 프로세스 정렬(열 하나와 방향). Node 를 부르지 않아 더미 대시보드의 가짜 서버도 쓴다

import type { ProcessRow, ProcessSort } from "../contract/admin.ts";
import type { Job } from "../../infra/process-job.ts";

// 작업 순서: 서버 이름 있는 작업 → 나간 서버의 작업 → 서버 밖 작업 → 봇 헬퍼. 서버 이름(가나다) 다음은 작업(재생, 다음 곡, 곡 찾기, 없음), 헬퍼는 이 순서.
// 화면 글(헬퍼 이름, "나간 서버")은 화면 언어를 따르므로 그 글로 정렬하지 않는다
const TASKS: Array<Job | null> = ["play", "prefetch", "lookup", null];
const HELPERS: Job[] = ["pot-server", "ytdlp-update", "login-background", "net-stats"];
const collator = new Intl.Collator("ko");
function jobKey(p: ProcessRow): [number, string, number] {
  if (p.job && HELPERS.includes(p.job)) return [3, "", HELPERS.indexOf(p.job)];
  const task = TASKS.indexOf(p.job);
  if (!p.guildId) return [2, "", task];
  return p.guildName ? [0, p.guildName, task] : [1, "", task];
}
function byJob(a: ProcessRow, b: ProcessRow) {
  const [x, y] = [jobKey(a), jobKey(b)];
  return x[0] - y[0] || collator.compare(x[1], y[1]) || x[2] - y[2];
}
const ORDER: Record<ProcessSort, (a: ProcessRow, b: ProcessRow) => number> = {
  pid: (a, b) => a.pid - b.pid,
  label: (a, b) => collator.compare(a.label, b.label),
  job: byJob,
  age: (a, b) => a.ageMs - b.ageMs,
  // 못 잰 것은 가장 작게
  mem: (a, b) => (a.memMb ?? -1) - (b.memMb ?? -1),
};
// 같은 값끼리는 방향과 상관없이 오래된 것부터
const oldestFirst = (a: ProcessRow, b: ProcessRow) => b.ageMs - a.ageMs || a.pid - b.pid;
/** 정렬(제자리). 방향은 선택한 열에만 걸린다 */
function sortProcesses(rows: ProcessRow[], sort: ProcessSort, desc: boolean) {
  const order = ORDER[sort];
  const sign = desc ? -1 : 1;
  return rows.sort((a, b) => sign * order(a, b) || oldestFirst(a, b));
}

export { sortProcesses, oldestFirst };
