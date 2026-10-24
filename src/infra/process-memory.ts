// 자식 프로세스마다의 메모리(MB). Linux 는 /proc 의 VmRSS(프로그램을 실행하지 않는다), Windows 는 작업 집합(tasklist), 그 밖은 RSS(ps).
// 봇 상태 탭은 15초마다 모아 둔 값을 준다. 못 읽으면 처음 한 번 warn 으로 알리고, 다시 읽히면 info 한 줄

import { execFile, type ExecFileException } from "node:child_process";
import fs from "node:fs";
import logger from "./log/logger.ts";
import { codeOf, messageOf } from "./error-text.ts";
import { consoleText } from "./console-text.ts";
import { repeatingFailure } from "./repeating-failure.ts";
const log = logger.child({ category: "proc" });

const IS_WIN = process.platform === "win32";
const IS_LINUX = process.platform === "linux";
// 바쁜 기계에서는 tasklist 가 몇 초씩 걸린다. 구간마다 하나만 돌므로 넉넉히
const TIMEOUT_MS = 30_000;

const failures = repeatingFailure({ error: (line) => log.warn(line), info: (line) => log.info(line) }, "자식 프로세스 메모리 읽기");

// 출력. 실패하면 까닭. done: 실패가 아닌 종료 코드(ps 는 고른 pid 가 다 끝났으면 1 로 끝난다)
function run(file: string, args: string[], done: number[] = []): Promise<{ out: string } | { failed: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "buffer", windowsHide: true, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error && !(typeof error.code === "number" && done.includes(error.code))) return resolve({ failed: `${file}: ${failure(error, stderr)}` });
      resolve({ out: consoleText(stdout) });
    });
  });
}

// 상한을 넘겨 끊었는지, 스스로 실패하고 끝났으면 종료 코드와 stderr
function failure(error: ExecFileException, stderr: Buffer) {
  if (error.killed) return `${TIMEOUT_MS / 1000}초를 넘겨 끊음(${error.signal ?? "신호 모름"})`;
  // 실행조차 못 했다(ENOENT 등)
  if (typeof error.code !== "number") return error.message;
  const said = consoleText(stderr).trim();
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

/** /proc/<pid>/status 의 VmRSS(KB). 커널 스레드처럼 그 줄이 없으면 null */
function parseProcStatus(text: string) {
  const found = /^VmRSS:\s+(\d+)\s+kB/m.exec(text);
  return found ? Number(found[1]) : null;
}

// Linux: pid 마다 /proc 를 읽는다. 끝난 pid(ENOENT · ESRCH)는 빠진다
async function fromProc(pids: number[]): Promise<{ memory: Map<number, number> } | { failed: string }> {
  const memory = new Map<number, number>();
  let failed: string | null = null;
  await Promise.all(
    pids.map(async (pid) => {
      try {
        const kb = parseProcStatus(await fs.promises.readFile(`/proc/${pid}/status`, "utf8"));
        if (kb) memory.set(pid, Math.round(kb / 1024));
      } catch (error) {
        if (codeOf(error) !== "ENOENT" && codeOf(error) !== "ESRCH") failed ??= `/proc/${pid}/status: ${messageOf(error)}`;
      }
    }),
  );
  return failed ? { failed } : { memory };
}

async function read(pids: number[]): Promise<{ memory: Map<number, number> } | { failed: string }> {
  if (IS_LINUX) return fromProc(pids);
  const wanted = new Set(pids);
  const got = IS_WIN ? await run("tasklist", ["/FO", "CSV", "/NH"]) : await run("ps", ["-o", "pid=,rss=", "-p", pids.join(",")], [1]);
  if ("failed" in got) return got;
  return { memory: IS_WIN ? parseTasklist(got.out, wanted) : parsePs(got.out, wanted) };
}

/** 이 pid 들의 메모리(MB). 못 읽은 것은 빠진다. 목록을 읽지 못했으면 null */
async function processMemory(pids: number[]): Promise<Map<number, number> | null> {
  if (pids.length === 0) return new Map();
  const got = await read(pids);
  if ("failed" in got) {
    failures.fail(got.failed);
    return null;
  }
  failures.ok();
  return got.memory;
}

export { processMemory, parseTasklist, parsePs, parseProcStatus };
export const _internals = { TIMEOUT_MS, failure };
