import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import logger from "./log/logger.ts";
import { currentGuild, currentJob } from "./guild-context.ts";
import type { Job } from "./process-job.ts";
const log = logger.child({ category: "proc" });

const IS_WIN = process.platform === "win32";
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * yt-dlp / ffmpeg 프로세스 레지스트리. 봇이 내려갈 때 자손까지 함께 죽인다.
 *
 * yt-dlp가 다운로드를 ffmpeg에 넘기므로 ffmpeg는 손자 프로세스다. 그냥 두면 봇을 내려도 남아서
 * 파일을 물고 방송을 계속 받아쓴다. Windows는 `taskkill /T`로, POSIX는 detached로 실행한
 * 프로세스 그룹(-pid)에 시그널을 보내 정리한다. exit 훅에서도 돌아야 해서 전부 동기로 구현한다.
 *
 * 시그널 전에 두 가지를 확인한다. 빠뜨리면 무관한 프로세스를 죽인다.
 *  1. pid > 1 인 정수. pid 0이면 `-0`이 되어 우리 자신의 프로세스 그룹이 죽는다.
 *  2. 이미 종료한 자식은 건너뛴다. OS가 PID를 재사용한다.
 *
 * 기동이 persistTo 로 기록 파일을 켜면 등록 · 해제마다 지금 목록을 적는다. 강제 종료 · 충돌로 이 정리를 못 하고 나가면
 * 다음 기동이 그 파일로 남은 자식을 찾아 종료한다(infra/leftover-children).
 */

// spawn 된 프로세스(ChildProcess)나 pid 를 가진 래퍼. 살아 있는지 보는 필드와 실행한 실행 파일
type Tracked = { pid?: number; exitCode?: number | null; signalCode?: string | null; spawnfile?: string };
/** guildId · job: 실행한 문맥의 서버와 일(infra/guild-context). 봇 상태 탭이 "어느 서버의 무슨 일"로 보인다 */
type Entry = { pid: number; label: string; group: boolean; child: Tracked; startedAt: number; guildId: string | null; job: Job | null };
/** 기록 파일의 모양. owner: 적은 봇 프로세스(pid · 시작 시각), children: 그때 살아 있던 자식(image: 실행 파일 이름) */
type Record = { owner: { pid: number; startedAt: number }; children: Array<{ pid: number; label: string; image: string | null; group: boolean; startedAt: number }> };

const active = new Map<number, Entry>();
let hooksInstalled = false;
let recordFile: string | null = null;

/** 실행 파일 이름(경로 · .exe 를 뗀 소문자) */
const imageOf = (file: string | undefined) =>
  file
    ? path
        .basename(file)
        .replace(/\.exe$/i, "")
        .toLowerCase()
    : null;

// 지금 목록을 기록 파일에. 읽다 만 파일이 남지 않게 옆에 쓰고 옮긴다. 실패해도 등록 · 정리는 그대로 간다
function save() {
  if (!recordFile) return;
  const record: Record = {
    owner: { pid: process.pid, startedAt: Math.round(Date.now() - process.uptime() * 1000) },
    children: [...active.values()].map((e) => ({ pid: e.pid, label: e.label, image: imageOf(e.child.spawnfile), group: e.group, startedAt: e.startedAt })),
  };
  try {
    const temp = `${recordFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(record));
    fs.renameSync(temp, recordFile);
  } catch (error) {
    log.debug(`자식 프로세스 기록 실패: ${reasonOf(error)}`);
  }
}

/** 기록 파일을 켠다. 기동이 남은 자식을 정리한 뒤 한 번 부른다(테스트 · 스크립트는 켜지 않는다) */
function persistTo(file: string) {
  recordFile = file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  save();
}

/**
 * exit 훅 설치. 첫 register 때 한 번만.
 * SIGINT/SIGTERM/SIGHUP은 app/shutdown.ts 의 종료 처리가 killAll을 직접 부르고, 여기는 그 밖의 경로용 백스톱이다.
 */
function install() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on("exit", () => {
    const killed = killAll();
    if (killed.length) log.warn(`종료 처리를 거치지 않고 나가며 외부 프로세스 ${killed.length}개 정리: ${killed.map(({ label, pid }) => `${label}#${pid}`).join(", ")}`);
  });
}

/**
 * 자식 프로세스를 등록하고 등록 해제 함수를 돌려준다.
 * label 은 로그용 이름, group=true 면 detached 로 실행해 자체 프로세스 그룹을 가진 경우.
 * 서버 · 일은 지금 문맥에서 읽는다. job 을 주면 문맥보다 앞선다.
 * 돌려주는 것은 등록 해제 함수다. 프로세스가 정상 종료하면 반드시 호출할 것
 */
function register(child: Tracked | null | undefined, label = "child", { group = false, job }: { group?: boolean; job?: Job } = {}): () => void {
  const pid = child?.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1 || !child)
    return () => {
      /* 등록하지 않았으니 풀 것도 없다 */
    };
  install();
  active.set(pid, { pid, label, group, child, startedAt: Date.now(), guildId: currentGuild(), job: job ?? currentJob() });
  save();
  return () => {
    if (active.delete(pid)) save();
  };
}

/** 자식이 아직 살아있는가. 종료했으면 PID 재사용 위험이 있으므로 시그널을 보내면 안 된다. */
function _isAlive(child: Tracked | null | undefined): boolean {
  if (!child) return false;
  // ChildProcess는 종료 시 exitCode 또는 signalCode 중 하나가 채워진다(그 전엔 둘 다 null).
  return child.exitCode === null && child.signalCode === null;
}

/**
 * 프로세스와 그 자손을 강제 종료. 이미 종료된 프로세스는 건드리지 않는다.
 * 돌려주는 것은 실제로 kill 을 시도했는가
 */
function killTree(entry: Entry): boolean {
  const { pid, group, child } = entry;
  if (!Number.isInteger(pid) || pid <= 1) return false; // pid 0 → -0 = 자기 그룹 자살 방지
  if (!_isAlive(child)) return false; // PID 재사용된 남의 프로세스 보호

  if (IS_WIN) {
    // /T = 자손 포함, /F = 강제. yt-dlp가 실행한 ffmpeg는 이 경로에서만 잡힌다. 128: 그 사이에 끝났다
    const { error, status } = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    if (error || (status !== 0 && status !== 128)) log.debug(`${entry.label}#${pid} 종료 실패: ${error ? error.message : `taskkill 종료 코드 ${String(status)}`}`);
    return true;
  }

  try {
    // detached로 실행했으면 그룹 전체(-pid). 손자 ffmpeg까지 같이 죽는다.
    process.kill(group ? -pid : pid, "SIGKILL");
  } catch {
    // ESRCH(이미 종료) 또는 그룹이 없는 경우. 직접 pid로 한 번 더.
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") log.debug(`${entry.label}#${pid} 종료 실패: ${reasonOf(error)}`);
    }
  }
  return true;
}

/** 등록한 자식 하나를 트리째 종료한다(시간 한도를 넘긴 것 등). 등록돼 있지 않거나 이미 끝났으면 false */
function kill(child: Tracked): boolean {
  const entry = typeof child.pid === "number" ? active.get(child.pid) : undefined;
  if (!entry || entry.child !== child) return false;
  active.delete(entry.pid);
  save();
  return killTree(entry);
}

/**
 * 등록된 모든 프로세스를 트리째 종료한다. 멱등. 두 번 불러도 안전하다.
 * 돌려주는 것은 실제로 종료를 시도한 프로세스. 줄은 부르는 쪽이 남긴다(종료 처리는 info, 그 밖의 길로 나가면 warn)
 */
function killAll(): Array<{ label: string; pid: number }> {
  if (active.size === 0) return [];
  const entries = [...active.values()];
  active.clear();
  save();

  const killed = [];
  for (const entry of entries) {
    try {
      if (killTree(entry)) killed.push({ label: entry.label, pid: entry.pid });
    } catch (error) {
      // 종료 경로에서는 실패해도 더 할 수 있는 일이 없다
      log.debug(`${entry.label}#${entry.pid} 종료 실패: ${reasonOf(error)}`);
    }
  }
  return killed;
}

/** 현재 추적 중인 프로세스 수 */
function size() {
  return active.size;
}

/**
 * 지금 살아 있는 자식 프로세스 목록. 운영자 패널 모니터링용. 오래된 것부터.
 * 오래 살아 있는 항목이 곧 새는 신호다(재생 ffmpeg는 곡 길이를 넘기지 않아야 한다).
 * program: 실행 파일 이름(모르면 label)
 */
function list() {
  const now = Date.now();
  return [...active.values()]
    .filter((e) => _isAlive(e.child))
    .map((e) => ({ pid: e.pid, label: e.label, program: imageOf(e.child.spawnfile) ?? e.label, ageMs: now - e.startedAt, guildId: e.guildId, job: e.job }))
    .sort((a, b) => b.ageMs - a.ageMs);
}

export { register, kill, killAll, size, list, install, persistTo, imageOf };
export type { Record as ChildRecord };
export const _internals = { active, killTree, _isAlive };
