import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import logger from "./log/logger.ts";
import { codeOf, messageOf } from "./error-text.ts";
import { consoleText } from "./console-text.ts";
import { currentGuild, currentJob } from "./guild-context.ts";
import { startKeyOf } from "./process-snapshot.ts";
import type { Job } from "./process-job.ts";
const log = logger.child({ category: "proc" });

const IS_WIN = process.platform === "win32";

/**
 * 자식 프로세스(yt-dlp, ffmpeg 등) 레지스트리. 봇이 내려갈 때 자손까지 함께 죽인다.
 *
 * yt-dlp가 다운로드를 ffmpeg에 넘기므로 ffmpeg는 손자 프로세스다. 그냥 두면 봇을 내려도 남아서
 * 파일을 물고 방송을 계속 받아쓴다. Windows는 `taskkill /T`로, POSIX는 detached로 실행한
 * 프로세스 그룹(-pid)에 시그널을 보내 정리한다. exit 훅에서도 돌아야 해서 전부 동기로 구현한다.
 *
 * 시그널 전에 두 가지를 확인한다. 빠뜨리면 무관한 프로세스를 죽인다.
 *  1. pid > 1 인 정수. pid 0이면 `-0`이 되어 우리 자신의 프로세스 그룹이 죽는다.
 *  2. 이미 종료한 자식은 건너뛴다. OS가 PID를 재사용한다.
 *
 * 기동이 persistTo로 기록을 켜면 등록, 해제마다 지금 목록을 이 실행의 파일(<폴더>/<pid>-<시작 시각>.json)에 적는다.
 * 실행마다 파일이 따로라 다른 실행의 기록을 덮지 않는다. 강제 종료, 충돌로 이 정리를 못 하고 나가면
 * 다음 기동이 그 파일로 남은 자식을 찾아 종료한다(infra/leftover-children). 내리지 못한 자식은 기록에 남긴다.
 */

// spawn 된 프로세스(ChildProcess)나 pid 를 가진 래퍼. 살아 있는지 보는 필드와 실행한 실행 파일
type Tracked = { pid?: number; exitCode?: number | null; signalCode?: string | null; spawnfile?: string };
/** guildId, job: 실행한 문맥의 서버와 일(infra/guild-context). 봇 상태 탭이 "어느 서버의 무슨 일"로 보인다 */
type Entry = { pid: number; label: string; group: boolean; child: Tracked; startedAt: number; startKey: string | null; guildId: string | null; job: Job | null };
/**
 * 기록 파일의 모양. owner: 적은 봇 프로세스, children: 그때 살아 있던 자식.
 * image: 실행 파일 이름, startedAt: 시작 시각(ms), startKey: 시계와 상관없는 시작 키(Linux, 없으면 null)
 */
type Identity = { pid: number; image: string | null; startedAt: number; startKey: string | null };
type Record = { owner: Identity; children: Array<Identity & { label: string; group: boolean }> };

const active = new Map<number, Entry>();
let hooksInstalled = false;
let recordFile: string | null = null;

/** 실행 파일 이름(경로, .exe 를 뗀 소문자) */
const imageOf = (file: string | undefined) =>
  file
    ? path
        .basename(file)
        .replace(/\.exe$/i, "")
        .toLowerCase()
    : null;

// 이 프로세스(봇). 기록 파일 이름에도 쓴다
const SELF: Identity = { pid: process.pid, image: imageOf(process.execPath), startedAt: Math.round(Date.now() - process.uptime() * 1000), startKey: startKeyOf(process.pid) };

// 지금 목록을 기록 파일에. 읽다 만 파일이 남지 않게 옆에 쓰고 옮긴다(정리는 *.json만 읽는다). 실패해도 등록, 정리는 그대로 간다
function save() {
  if (!recordFile) return;
  const record: Record = {
    owner: SELF,
    children: [...active.values()].map((e) => ({ pid: e.pid, label: e.label, image: imageOf(e.child.spawnfile), group: e.group, startedAt: e.startedAt, startKey: e.startKey })),
  };
  try {
    const temp = `${recordFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(record));
    fs.renameSync(temp, recordFile);
  } catch (error) {
    log.debug(`자식 프로세스 기록 실패: ${messageOf(error)}`);
  }
}

/** 이 실행의 기록 파일 이름 */
const recordNameOf = (owner: Identity) => `${owner.pid}-${owner.startedAt}.json`;

/**
 * 기록을 켠다. 기동이 남은 자식을 정리한 뒤 한 번 부른다(테스트, 스크립트는 켜지 않는다). 돌려주는 것은 이 실행의 기록 파일.
 * 끝날 때 자식을 내리고 자기 파일을 삭제하는 exit 훅도 여기서 건다(자식을 한 번도 띄우지 않은 실행도 파일을 남기지 않게)
 */
function persistTo(dir: string): string {
  recordFile = path.join(dir, recordNameOf(SELF));
  fs.mkdirSync(dir, { recursive: true });
  install();
  save();
  return recordFile;
}

/**
 * exit 훅 설치. 첫 register 때 한 번만.
 * SIGINT/SIGTERM/SIGHUP은 app/shutdown 의 종료 처리가 killAll을 직접 부르고, 여기는 그 밖의 길로 나갈 때의 안전망이다.
 */
function install() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on("exit", () => {
    const killed = killAll();
    if (killed.length) log.warn(`종료 처리를 거치지 않고 나가며 외부 프로세스 ${killed.length}개 정리: ${killed.map(({ label, pid }) => `${label}#${pid}`).join(", ")}`);
    // 다 내렸으면 기록을 삭제한다. 내리지 못한 것이 있으면 그것만 남은 파일을 두어 다음 기동이 다시 본다
    if (recordFile && active.size === 0) fs.rmSync(recordFile, { force: true });
  });
}

/**
 * 자식 프로세스를 등록하고 등록 해제 함수를 돌려준다.
 * label 은 로그용 이름, group=true 면 detached 로 실행해 자체 프로세스 그룹을 가진 경우.
 * 서버, 일은 지금 문맥에서 읽는다. job 을 주면 문맥보다 앞선다.
 * 돌려주는 것은 등록 해제 함수다. 프로세스가 정상 종료하면 반드시 호출할 것
 */
function register(child: Tracked | null | undefined, label = "child", { group = false, job }: { group?: boolean; job?: Job } = {}): () => void {
  const pid = child?.pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1 || !child)
    return () => {
      /* 등록하지 않았으니 풀 것도 없다 */
    };
  install();
  active.set(pid, { pid, label, group, child, startedAt: Date.now(), startKey: startKeyOf(pid), guildId: currentGuild(), job: job ?? currentJob() });
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

// taskkill 한 번에 넘기는 PID 수(명령줄 길이 한도 안). 하나씩 부르면 재생이 많을 때 종료가 수십 초 걸린다
const TASKKILL_BATCH = 100;

/**
 * 프로세스들과 그 자손을 강제 종료. 이미 종료된 프로세스는 건드리지 않는다.
 * killed: 내렸거나 그 사이 끝난 것, failed: 내리지 못한 것(권한 등. 기록에 남긴다)
 */
function killTrees(entries: Entry[]): { killed: Entry[]; failed: Entry[] } {
  // pid 0 은 -0 이 되어 자기 그룹을 죽인다. 끝난 것은 PID 가 재사용된 남의 프로세스일 수 있다
  const live = entries.filter(({ pid, child }) => Number.isInteger(pid) && pid > 1 && _isAlive(child));
  const failed: Entry[] = [];
  if (!IS_WIN) {
    for (const entry of live) if (!killPosix(entry)) failed.push(entry);
    return { killed: live.filter((entry) => !failed.includes(entry)), failed };
  }
  for (let i = 0; i < live.length; i += TASKKILL_BATCH) {
    const batch = live.slice(i, i + TASKKILL_BATCH);
    // /T = 자손 포함, /F = 강제. yt-dlp가 실행한 ffmpeg는 이 경로에서만 잡힌다. 128: 그 사이에 끝난 것이 있다(나머지는 내린다)
    const { error, status, stderr } = spawnSync("taskkill", [...batch.flatMap(({ pid }) => ["/PID", String(pid)]), "/T", "/F"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    if (error || (status !== 0 && status !== 128)) {
      // 배치의 어느 것이 실패했는지 알 수 없어 배치 전체를 기록에 남긴다(다음 기동이 이름, 시작 시각을 맞춰 보고 다시 내린다)
      failed.push(...batch);
      log.warn(`${batch.map(({ label, pid }) => `${label}#${pid}`).join(", ")} 종료 실패: ${error ? error.message : `taskkill 종료 코드 ${String(status)} · ${consoleText(stderr).trim()}`}`);
    }
  }
  return { killed: live.filter((entry) => !failed.includes(entry)), failed };
}

function killTree(entry: Entry): boolean {
  return killTrees([entry]).killed.length > 0;
}

/** 내렸거나 이미 없으면 true */
function killPosix(entry: Entry): boolean {
  const { pid, group } = entry;
  try {
    // detached로 실행했으면 그룹 전체(-pid). 손자 ffmpeg까지 같이 죽는다.
    process.kill(group ? -pid : pid, "SIGKILL");
    return true;
  } catch {
    // ESRCH(이미 종료) 또는 그룹이 없는 경우. 직접 pid로 한 번 더.
    try {
      process.kill(pid, "SIGKILL");
      return true;
    } catch (error) {
      if (codeOf(error) === "ESRCH") return true;
      log.warn(`${entry.label}#${pid} 종료 실패: ${messageOf(error)}`);
      return false;
    }
  }
}

/** 등록한 자식 하나를 트리째 종료한다(시간 한도를 넘긴 것 등). 등록돼 있지 않거나 이미 끝났으면 false */
function kill(child: Tracked): boolean {
  const entry = typeof child.pid === "number" ? active.get(child.pid) : undefined;
  if (!entry || entry.child !== child) return false;
  const { killed, failed } = killTrees([entry]);
  // 내리지 못했으면 기록에 남긴다(끝나면 등록 해제가 뺀다)
  if (!failed.length) {
    active.delete(entry.pid);
    save();
  }
  return killed.length > 0;
}

/**
 * 등록된 모든 프로세스를 트리째 종료한다. 두 번 불러도 안전하다.
 * 돌려주는 것은 실제로 종료를 시도한 프로세스. 줄은 부르는 쪽이 남긴다(종료 처리는 info, 그 밖의 길로 나가면 warn)
 */
function killAll(): Array<{ label: string; pid: number }> {
  if (active.size === 0) return [];
  const entries = [...active.values()];
  let result: { killed: Entry[]; failed: Entry[] };
  try {
    result = killTrees(entries);
  } catch (error) {
    // 종료 경로에서는 실패해도 더 할 수 있는 일이 없다. 기록은 그대로 두어 다음 기동이 다시 본다
    log.debug(`자식 프로세스 종료 실패: ${messageOf(error)}`);
    return [];
  }
  // 내리지 못한 것만 기록에 남긴다
  for (const entry of entries) if (!result.failed.includes(entry)) active.delete(entry.pid);
  save();
  return result.killed.map(({ label, pid }) => ({ label, pid }));
}

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

export { register, kill, killAll, size, list, install, persistTo, imageOf, recordNameOf };
export type { Record as ChildRecord, Identity as ProcessIdentity };
export const _internals = { active, killTree, _isAlive };
