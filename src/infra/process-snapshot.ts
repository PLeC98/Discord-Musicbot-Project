// OS의 프로세스 목록을 한 번에 읽는다. 남은 자식 정리(infra/leftover-children)와 기록(infra/process-registry)이 쓴다.
// Windows는 CIM, Linux는 /proc을 직접(셸 없이, BusyBox, slim 이미지에도 있다), 그 밖은 ps.
// 읽지 못하면 null이다. 빈 목록("조회했는데 없다")과 구분하는 것이 이 모듈이 하는 일이다

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import logger from "./log/logger.ts";
import { consoleText } from "./console-text.ts";
const log = logger.child({ category: "proc" });

/**
 * OS가 아는 프로세스. image: 실행 파일 이름(경로, .exe를 뗀 소문자).
 * startedAt: 시작 시각(ms, 벽시계). startKey: 시계와 상관없는 시작 키(Linux: 부팅 id와 부팅 뒤 클럭 틱). 없으면 null.
 * pgid: 프로세스 그룹(POSIX). Windows는 null
 */
type Proc = { pid: number; ppid: number; pgid: number | null; image: string; startedAt: number; startKey: string | null };

const QUERY_TIMEOUT_MS = 15_000;

const imageName = (name: string) => name.replace(/\.exe$/i, "").toLowerCase();

// Linux의 comm은 15자에서 잘린다. 기록한 이름과 비교할 때 같은 길이로 맞춘다
const sameImage = (a: string | null, b: string | null) => !!a && !!b && (process.platform === "linux" ? a.slice(0, 15) === b.slice(0, 15) : a === b);

// ── Linux: /proc ──

let bootId: string | null | undefined;
function linuxBootId() {
  if (bootId === undefined) bootId = readText("/proc/sys/kernel/random/boot_id")?.trim() || null;
  return bootId;
}

let bootMs: number | null | undefined;
function linuxBootMs() {
  if (bootMs === undefined) {
    const btime = /^btime (\d+)$/m.exec(readText("/proc/stat") ?? "");
    bootMs = btime ? Number(btime[1]) * 1000 : null;
  }
  return bootMs;
}

function readText(file: string) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// /proc의 클럭 틱 단위(USER_HZ). 커널이 사용자 공간에 늘 100으로 보인다
const TICKS_PER_SECOND = 100;

/** /proc/<pid>/stat 한 줄. comm은 괄호 안이고 공백, 괄호가 들어갈 수 있어 마지막 ")" 뒤부터 나눈다 */
function parseStat(pid: number, text: string): Proc | null {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const rest = text.slice(close + 2).split(" ");
  // rest[0]이 3번째 필드(state). ppid 4, pgrp 5, starttime 22
  const ppid = Number(rest[1]);
  const pgid = Number(rest[2]);
  const ticks = rest[19];
  if (!Number.isInteger(ppid) || !Number.isInteger(pgid) || !/^\d+$/.test(ticks ?? "")) return null;
  const boot = linuxBootMs();
  return {
    pid,
    ppid,
    pgid,
    image: imageName(text.slice(open + 1, close)),
    startedAt: boot === null ? 0 : boot + Math.round((Number(ticks) * 1000) / TICKS_PER_SECOND),
    startKey: `${linuxBootId() ?? "?"}:${ticks}`,
  };
}

// Node 는 메인 스레드 이름을 MainThread 로 바꿔(uv_thread_setname) comm 이 실행 파일 이름이 아니다. 그때만 실행 파일 경로에서 읽는다.
// 늘 경로로 읽지 않는 것은 shebang 스크립트(yt-dlp)의 경로가 인터프리터라서다
const RENAMED_MAIN_THREAD = "mainthread";
function exeImage(pid: number) {
  try {
    return imageName(path.basename(fs.readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, "")));
  } catch {
    return null;
  }
}

function linuxSnapshot(): Proc[] | null {
  let names: string[];
  try {
    names = fs.readdirSync("/proc");
  } catch (error) {
    log.warn(`프로세스 목록을 읽지 못했습니다(/proc): ${String(error)}`);
    return null;
  }
  const out: Proc[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    // 읽는 사이 끝난 프로세스는 없다고 본다
    const text = readText(`/proc/${name}/stat`);
    const proc = text && parseStat(Number(name), text);
    if (!proc) continue;
    if (proc.image === RENAMED_MAIN_THREAD) proc.image = exeImage(proc.pid) ?? proc.image;
    out.push(proc);
  }
  return out;
}

// ── Windows: CIM ──

function windowsSnapshot(): Proc[] | null {
  const script = `Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: QUERY_TIMEOUT_MS });
  if (!succeeded("powershell", result)) return null;
  const out: Proc[] = [];
  for (const line of consoleText(result.stdout).split(/\r?\n/)) {
    const [pid, ppid, name, at] = line.split("|");
    // 시스템 프로세스는 생성 시각이 비어 있다
    if (!/^\d+$/.test(pid ?? "") || !/^\d+$/.test(ppid ?? "") || !name || !/^\d+$/.test(at ?? "")) continue;
    out.push({ pid: Number(pid), ppid: Number(ppid), pgid: null, image: imageName(name), startedAt: Number(at), startKey: null });
  }
  return out.length ? out : null;
}

// ── 그 밖(macOS 등): ps ──

function psSnapshot(): Proc[] | null {
  const result = spawnSync("ps", ["-A", "-o", "pid=,ppid=,pgid=,lstart=,comm="], { timeout: QUERY_TIMEOUT_MS });
  if (!succeeded("ps", result)) return null;
  const out: Proc[] = [];
  for (const line of consoleText(result.stdout).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/.exec(line);
    if (!m) continue;
    const startedAt = new Date(m[4]).getTime();
    if (!Number.isFinite(startedAt)) continue;
    out.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), image: imageName(m[5].trim().split("/").at(-1) ?? ""), startedAt, startKey: null });
  }
  return out.length ? out : null;
}

// 실행하지 못했거나, 시간을 넘겼거나, 0이 아닌 코드로 끝났으면 읽지 못한 것이다
function succeeded(what: string, result: { error?: Error; status: number | null; stderr?: Buffer | null }) {
  if (result.error) log.warn(`프로세스 목록을 읽지 못했습니다(${what}): ${result.error.message}`);
  else if (result.status !== 0) {
    const stderr = result.stderr ? consoleText(result.stderr).trim() : "";
    log.warn(`프로세스 목록을 읽지 못했습니다(${what} 종료 코드 ${String(result.status)})${stderr ? `: ${stderr}` : ""}`);
  }
  return !result.error && result.status === 0;
}

/** 지금 프로세스 전부. 읽지 못하면 null */
function snapshotProcesses(platform: NodeJS.Platform = process.platform): Proc[] | null {
  if (platform === "win32") return windowsSnapshot();
  if (platform === "linux" && fs.existsSync("/proc/self/stat")) return linuxSnapshot();
  return psSnapshot();
}

/** 그 프로세스의 시계와 상관없는 시작 키(Linux). 다른 OS, 읽지 못하면 null */
function startKeyOf(pid: number): string | null {
  if (process.platform !== "linux") return null;
  const text = readText(`/proc/${pid}/stat`);
  return (text && parseStat(pid, text)?.startKey) || null;
}

export { snapshotProcesses, startKeyOf, sameImage, imageName, parseStat };
export type { Proc };
