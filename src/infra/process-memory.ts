// 자식 프로세스마다의 메모리(MB). Windows 는 작업 집합(tasklist), 그 밖은 RSS(ps).
// 프로그램을 하나 띄워 읽으므로 비싸다. 봇 상태 탭은 15초마다 모아 둔 값을 준다

import { execFile } from "node:child_process";

const IS_WIN = process.platform === "win32";
// 바쁜 기계에서는 tasklist 가 몇 초씩 걸린다. 칸마다 하나만 돌므로 넉넉히
const TIMEOUT_MS = 30_000;

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "utf8", windowsHide: true, timeout: TIMEOUT_MS }, (_error, stdout) => resolve(stdout ?? ""));
  });
}

/** tasklist /FO CSV /NH 의 줄: "이름","PID","세션 이름","세션#","메모리 사용"(예: "31,456 K", 자릿점은 로캘마다) */
function parseTasklist(out: string, pids: Set<number>) {
  const memory = new Map<number, number>();
  for (const line of out.split(/\r?\n/)) {
    const cells = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    const pid = Number(cells[1]);
    if (cells.length < 5 || !pids.has(pid)) continue;
    const kb = Number(cells[4].replace(/\D/g, ""));
    if (kb) memory.set(pid, Math.round(kb / 1024));
  }
  return memory;
}

/** ps -o pid=,rss= 의 줄: pid 와 RSS(KB) */
function parsePs(out: string, pids: Set<number>) {
  const memory = new Map<number, number>();
  for (const line of out.split("\n")) {
    const [pid, kb] = line.trim().split(/\s+/).map(Number);
    if (pids.has(pid) && kb) memory.set(pid, Math.round(kb / 1024));
  }
  return memory;
}

/** 이 pid 들의 메모리(MB). 못 읽은 것은 빠진다 */
async function processMemory(pids: number[]): Promise<Map<number, number>> {
  if (pids.length === 0) return new Map();
  const wanted = new Set(pids);
  if (IS_WIN) return parseTasklist(await run("tasklist", ["/FO", "CSV", "/NH"]), wanted);
  return parsePs(await run("ps", ["-o", "pid=,rss=", "-p", pids.join(",")]), wanted);
}

export { processMemory, parseTasklist, parsePs };
