// 자식 프로세스마다의 메모리(MB). Windows 는 작업 집합(tasklist), 그 밖은 RSS(ps).
// 프로그램을 하나 실행해 읽으므로 비싸다. 봇 상태 탭은 15초마다 모아 둔 값을 준다

import { execFile, type ExecFileException } from "node:child_process";
import logger from "./log/logger.ts";
const log = logger.child({ category: "proc" });

const IS_WIN = process.platform === "win32";
// 바쁜 기계에서는 tasklist 가 몇 초씩 걸린다. 구간마다 하나만 돌므로 넉넉히
const TIMEOUT_MS = 30_000;

// 출력. 실패하면 null
function run(file: string, args: string[]): Promise<string | null> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "buffer", windowsHide: true, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      // 15초마다 돈다. ps 는 고른 pid 가 다 끝났으면 1 로 끝난다
      if (error) log.trace(`자식 프로세스 메모리 읽기 실패(${file}, ${Date.now() - started}ms): ${failure(error, stderr)}`);
      resolve(error ? null : stdout.toString("utf8"));
    });
  });
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

// 상한을 넘겨 끊었는지, 스스로 실패하고 끝났으면 종료 코드와 stderr
function failure(error: ExecFileException, stderr: Buffer) {
  if (error.killed) return `${TIMEOUT_MS / 1000}초를 넘겨 끊음(${error.signal ?? "신호 모름"})`;
  // 실행조차 못 했다(ENOENT 등)
  if (typeof error.code !== "number") return error.message;
  let said: string;
  try {
    said = strictUtf8.decode(stderr).trim();
  } catch {
    said = `UTF-8 이 아닌 ${stderr.length}바이트(콘솔 코드 페이지)`; // 한국어 Windows 의 tasklist 는 cp949 로 쓴다
  }
  return `종료 코드 ${error.code}${said ? ` · ${said}` : ""}`;
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

/** 이 pid 들의 메모리(MB). 못 읽은 것은 빠진다. 프로그램이 실패하면 null(목록을 읽지 못했다) */
async function processMemory(pids: number[]): Promise<Map<number, number> | null> {
  if (pids.length === 0) return new Map();
  const wanted = new Set(pids);
  const out = IS_WIN ? await run("tasklist", ["/FO", "CSV", "/NH"]) : await run("ps", ["-o", "pid=,rss=", "-p", pids.join(",")]);
  if (out === null) return null;
  return IS_WIN ? parseTasklist(out, wanted) : parsePs(out, wanted);
}

export { processMemory, parseTasklist, parsePs };
export const _internals = { TIMEOUT_MS, failure };
