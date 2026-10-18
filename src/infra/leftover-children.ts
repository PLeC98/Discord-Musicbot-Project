// 직전 실행이 남긴 자식 프로세스(POToken 서버 · ffmpeg · yt-dlp)를 기동 때 종료한다.
// 정리는 종료 처리기와 exit 훅이 하지만, 창을 그냥 닫거나 강제로 끄거나 네이티브 충돌로 죽으면 그 둘이 돌지 않는다.
// 남은 POToken 서버가 4416 을 쥐면 새 서버가 실행되지 않으므로 POToken 서버를 실행하기 전에 부른다.
//
// 레지스트리(infra/process-registry)가 적어 둔 기록 파일을 읽어, 지금도 살아 있고 실행 파일 이름과 시작 시각이 기록과 맞는 것만 트리째 종료한다.
// OS 가 pid 를 다른 프로그램에 다시 줬으면 이름이나 시작 시각이 달라 건드리지 않는다. 기록을 적은 봇이 아직 돌고 있으면(봇이 둘) 아무것도 하지 않는다.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import logger from "./log/logger.ts";
import type { ChildRecord } from "./process-registry.ts";
const log = logger.child({ category: "proc" });

const IS_WIN = process.platform === "win32";
// 기록의 시작 시각과 OS 가 아는 시작 시각의 허용 차(등록은 실행 직후라 보통 1초 안이다)
const START_SLACK_MS = 10_000;

/** OS 가 아는 프로세스. image: 실행 파일 이름(경로 · .exe 를 뗀 소문자) */
type Seen = { pid: number; image: string; startedAt: number };

/** 외부 경계. 생략하면 진짜 */
type Boundary = {
  read(file: string): string | null;
  remove(file: string): void;
  /** 이 pid 들 가운데 살아 있는 것 */
  processes(pids: number[]): Seen[];
  /** 트리째 강제로 종료한다. group: POSIX 에서 자체 프로세스 그룹으로 실행했다 */
  killTree(pid: number, group: boolean): void;
  self: { pid: number; ppid: number };
};

const imageName = (name: string) => name.replace(/\.exe$/i, "").toLowerCase();

// Windows: CIM 에서 이름 · 만든 시각. POSIX: ps 의 이름 · 시작 시각
function realProcesses(pids: number[]): Seen[] {
  if (pids.length === 0) return [];
  if (IS_WIN) {
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(" OR ");
    const script = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { "$($_.ProcessId)|$($_.Name)|$(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }`;
    const out = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 15_000 }).stdout ?? "";
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split("|"))
      .map(([pid, name, at]) => ({ pid: Number(pid), image: imageName(name), startedAt: Number(at) }));
  }
  const out = spawnSync("ps", ["-o", "pid=,lstart=,comm=", "-p", pids.join(",")], { encoding: "utf8", timeout: 15_000 }).stdout ?? "";
  return out
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/.exec(line))
    .filter((m) => m !== null)
    .map(([, pid, at, name]) => ({ pid: Number(pid), image: imageName(name.trim()), startedAt: new Date(at).getTime() }));
}

function realKillTree(pid: number, group: boolean) {
  if (IS_WIN) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(group ? -pid : pid, "SIGKILL");
  } catch {
    /* 그 사이에 끝났다 */
  }
}

const REAL: Boundary = {
  read: (file) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
  remove: (file) => fs.rmSync(file, { force: true }),
  processes: realProcesses,
  killTree: realKillTree,
  self: { pid: process.pid, ppid: process.ppid },
};

const matches = (seen: Seen | undefined, image: string | null, startedAt: number) => !!seen && seen.image === image && Math.abs(seen.startedAt - startedAt) <= START_SLACK_MS;

// 살아 있고 기록의 그 자식인가. 살아 있지만 다른 프로그램이면 남겨 두는 까닭을 debug 로
function mine(child: ChildRecord["children"][number], seen: Seen | undefined) {
  if (!seen) return false;
  if (matches(seen, child.image, child.startedAt)) return true;
  log.debug(`pid ${child.pid} 는 기록의 ${child.label}(${child.image ?? "?"})이 아니라 두고 갑니다(지금 ${seen.image})`);
  return false;
}

// 기록 파일의 내용. 없거나 읽지 못하면 null
function parse(text: string | null): ChildRecord | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as ChildRecord;
  } catch {
    log.debug("자식 프로세스 기록을 읽지 못해 삭제합니다");
    return null;
  }
}

/**
 * 기록 파일의 남은 자식을 종료하고 파일을 삭제한다. 돌려주는 것은 종료한 자식의 라벨(label#pid).
 * 기록을 적은 봇이 아직 돌고 있으면 건드리지 않는다(null)
 */
function sweepLeftoverChildren(file: string, boundary: Partial<Boundary> = {}): string[] | null {
  const { read, remove, processes, killTree, self } = { ...REAL, ...boundary };
  const record = parse(read(file));
  const children = (record?.children ?? []).filter((c) => Number.isInteger(c.pid) && c.pid > 1 && c.pid !== self.pid && c.pid !== self.ppid);
  // 깨끗이 끝났으면 비어 있다. OS 에 묻지 않는다(Windows 는 묻는 데 1초쯤 든다). 기록이 없거나 읽지 못했으면 삭제하고 넘어간다
  if (!record || children.length === 0) {
    remove(file);
    return [];
  }
  // 기록을 적은 봇(이 프로세스가 아니면)
  const owner = record.owner && record.owner.pid !== self.pid ? record.owner : null;
  const alive = new Map(processes([...children.map((c) => c.pid), ...(owner ? [owner.pid] : [])]).map((p) => [p.pid, p]));

  if (owner && matches(alive.get(owner.pid), "node", owner.startedAt)) {
    log.warn(`기록을 적은 봇 프로세스(pid ${owner.pid})가 아직 돌고 있어 남은 자식 프로세스 정리를 건너뜁니다. 봇이 둘 실행 중인지 보세요`);
    return null;
  }

  const killed = children.filter((child) => mine(child, alive.get(child.pid))).map((child) => (killTree(child.pid, child.group), `${child.label}#${child.pid}`));
  remove(file);
  if (killed.length) log.warn(`직전 실행이 남긴 자식 프로세스 ${killed.length}개를 종료했습니다: ${killed.join(", ")}`);
  return killed;
}

export { sweepLeftoverChildren };
export type { Boundary as LeftoverBoundary, Seen as SeenProcess };
