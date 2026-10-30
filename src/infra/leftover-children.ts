// 이전 실행이 남긴 자식 프로세스(POToken 서버 · ffmpeg · yt-dlp)를 기동 시 종료한다.
// 정리는 종료 핸들러와 exit 훅이 하지만, 창을 그냥 닫거나 강제로 끄거나 네이티브 충돌로 죽으면 그 둘이 돌지 않는다.
// Windows 는 Node 가 직접 자식을 부모와 함께 끝나는 잡에 넣어 주지만 손자(yt-dlp.exe 의 안쪽 프로세스 · 그가 띄운 ffmpeg)는 빠지고,
// Linux 는 그런 장치가 없다. 그래서 기록의 자식과 그 손자를 찾아 내린다.
//
// 기록은 실행마다 파일 하나(infra/process-registry). 파일마다 기록을 남긴 봇이 끝났을 때만, 지금도 살아 있고 실행 파일 이름과 시작 시각이
// 기록과 맞는 것만 트리째 종료한다(OS 가 pid 를 다른 프로그램에 다시 줬으면 건드리지 않는다).
// 프로세스 목록을 읽지 못하면 아무것도 내리지 않고 파일을 둔다(다음 기동이 다시 본다).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import logger from "./log/logger.ts";
import { codeOf, messageOf } from "./error-text.ts";
import { consoleText } from "./console-text.ts";
import { snapshotProcesses, sameImage, type Proc } from "./process-snapshot.ts";
import type { ChildRecord, ProcessIdentity } from "./process-registry.ts";
const log = logger.child({ category: "proc" });

const IS_WIN = process.platform === "win32";
// 기록의 시작 시각과 OS 가 아는 시작 시각의 허용 차(등록은 실행 직후라 보통 1초 안이다)
const START_SLACK_MS = 10_000;
// 프로세스 목록을 읽지 못하는 일이 이어져도 이보다 오래된 실행의 기록은 지운다(파일이 쌓이지 않게)
const GIVE_UP_MS = 7 * 24 * 60 * 60_000;
// 기록하지 않은 손자로 내리는 것. 기록한 자식의 이름도 더한다
const DESCENDANT_IMAGES = ["yt-dlp", "ffmpeg", "ffprobe", "conhost"];

/** 외부 경계. 생략하면 실제 구현 */
type Boundary = {
  /** 폴더의 기록 파일 이름들 */
  list(dir: string): string[];
  read(file: string): string | null;
  write(file: string, text: string): void;
  remove(file: string): void;
  /** 지금 프로세스 전부. 읽지 못하면 null */
  snapshot(): Proc[] | null;
  /** 트리째 강제로 종료한다. group: POSIX 에서 자체 프로세스 그룹으로 실행했다. 내렸거나 이미 없으면 true */
  killTree(pid: number, group: boolean): boolean;
  self: { pid: number; ppid: number };
  now(): number;
};

function realKillTree(pid: number, group: boolean): boolean {
  if (IS_WIN) {
    // 128: 그 사이에 끝났다
    const { error, status, stderr } = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    if (!error && (status === 0 || status === 128)) return true;
    log.warn(`pid ${pid} 종료 실패: ${error ? error.message : `taskkill 종료 코드 ${String(status)} · ${consoleText(stderr).trim()}`}`);
    return false;
  }
  try {
    process.kill(group ? -pid : pid, "SIGKILL");
    return true;
  } catch (error) {
    // ESRCH: 그 사이에 끝났다
    if (codeOf(error) === "ESRCH") return true;
    log.warn(`pid ${pid} 종료 실패: ${messageOf(error)}`);
    return false;
  }
}

const REAL: Boundary = {
  list: (dir) => {
    try {
      return fs.readdirSync(dir);
    } catch (error) {
      // 없는 것은 첫 기동이다
      if (codeOf(error) !== "ENOENT") log.debug(`자식 프로세스 기록 폴더를 읽지 못했습니다: ${messageOf(error)}`);
      return [];
    }
  },
  read: (file) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (error) {
      log.debug(`자식 프로세스 기록 읽기 실패: ${messageOf(error)}`);
      return null;
    }
  },
  write: (file, text) => {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, file);
  },
  remove: (file) => fs.rmSync(file, { force: true }),
  snapshot: () => snapshotProcesses(),
  killTree: realKillTree,
  self: { pid: process.pid, ppid: process.ppid },
  now: () => Date.now(),
};

/** 그 프로세스가 기록의 그것인가: 이름이 같고, 시작 시각이 맞다(둘 다 시계와 상관없는 표지가 있으면 그것으로) */
function same(proc: Proc | undefined, who: ProcessIdentity): proc is Proc {
  if (!proc || !sameImage(proc.image, who.image)) return false;
  if (proc.startKey && who.startKey) return proc.startKey === who.startKey;
  return Math.abs(proc.startedAt - who.startedAt) <= START_SLACK_MS;
}

// 기록 파일의 내용. 읽지 못하거나 모양이 틀리면 null
function parse(text: string | null): ChildRecord | null {
  if (text === null) return null;
  try {
    const record = JSON.parse(text) as ChildRecord;
    return record && typeof record.owner?.pid === "number" && Array.isArray(record.children) ? record : null;
  } catch {
    return null;
  }
}

type Target = { pid: number; group: boolean; label: string };

/**
 * 기록한 자식 하나에서 내릴 것. 살아 있으면 그 트리째. 이미 끝났으면 남은 손자:
 * Windows 는 부모 pid 를 따라(부모가 끝나도 그대로 남는다), POSIX 는 그 자식이 만든 프로세스 그룹으로(고아는 부모가 init 으로 바뀐다)
 */
function targetsOf(child: ChildRecord["children"][number], procs: Proc[], byPid: Map<number, Proc>, isWin: boolean): Target[] {
  if (same(byPid.get(child.pid), child)) return [{ pid: child.pid, group: child.group, label: `${child.label}#${child.pid}` }];
  const images = new Set([...DESCENDANT_IMAGES, child.image].filter((one): one is string => !!one));
  const later = (proc: Proc) => proc.startedAt >= child.startedAt - START_SLACK_MS && [...images].some((image) => sameImage(proc.image, image));
  if (!isWin) {
    if (!child.group) return [];
    return procs.some((proc) => proc.pgid === child.pid && later(proc)) ? [{ pid: child.pid, group: true, label: `${child.label}#${child.pid}의 그룹` }] : [];
  }
  // Windows: 끝난 자식의 바로 아래 손자들. 손자의 트리는 taskkill /T 가 함께 내린다
  return procs.filter((proc) => proc.ppid === child.pid && later(proc)).map((proc) => ({ pid: proc.pid, group: false, label: `${child.label}#${child.pid}의 ${proc.image}#${proc.pid}` }));
}

/**
 * 폴더의 다른 실행이 남긴 기록을 보고 남은 자식을 종료한다. 돌려주는 것은 종료한 것의 라벨.
 * 기록을 남긴 봇이 아직 돌면 그 파일은 건드리지 않는다. 내리지 못한 자식은 파일에 남기고, 다 내렸으면 파일을 지운다
 */
type Found = { file: string; record: ChildRecord };

// 폴더의 기록들. 쓰는 중의 임시 파일(*.tmp)은 읽지 않고, 읽지 못하는 기록은 지운다(내릴 대상을 알 수 없다)
function readRecords(dir: string, io: Boundary): Found[] {
  const found: Found[] = [];
  for (const name of io.list(dir)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    const record = parse(io.read(file));
    if (record) found.push({ file, record });
    else {
      log.debug(`자식 프로세스 기록을 읽지 못해 삭제합니다: ${name}`);
      io.remove(file);
    }
  }
  return found;
}

// 기록 하나: 맞는 자식과 그 손자를 내리고, 내리지 못한 자식만 남긴다(다 내렸으면 파일을 지운다)
function sweepRecord({ file, record }: Found, procs: Proc[], byPid: Map<number, Proc>, io: Boundary, isWin: boolean): string[] {
  const killed: string[] = [];
  const kept: ChildRecord["children"] = [];
  const mine = (pid: number) => Number.isInteger(pid) && pid > 1 && pid !== io.self.pid && pid !== io.self.ppid;
  for (const child of record.children.filter((one) => mine(one.pid))) {
    const targets = targetsOf(child, procs, byPid, isWin);
    const failed = targets.filter((target) => !io.killTree(target.pid, target.group));
    killed.push(...targets.filter((target) => !failed.includes(target)).map((target) => target.label));
    if (failed.length) kept.push(child);
  }
  if (kept.length) io.write(file, JSON.stringify({ ...record, children: kept }));
  else io.remove(file);
  return killed;
}

/**
 * 폴더의 다른 실행이 남긴 기록을 보고 남은 자식을 종료한다. 돌려주는 것은 종료한 것의 라벨.
 * 기록을 남긴 봇이 아직 돌면 그 파일은 건드리지 않는다. 내리지 못한 자식은 파일에 남기고, 다 내렸으면 파일을 지운다
 */
function sweepLeftoverChildren(dir: string, boundary: Partial<Boundary> = {}, isWin = IS_WIN): string[] {
  const io = { ...REAL, ...boundary };
  const records = readRecords(dir, io);
  if (!records.length) return [];

  const procs = io.snapshot();
  if (!procs) {
    const old = records.filter(({ record }) => io.now() - record.owner.startedAt > GIVE_UP_MS);
    for (const { file } of old) io.remove(file);
    log.warn(`잔류 자식 프로세스를 확인하지 못해 기록 ${records.length - old.length}개를 두고 다음 기동에서 다시 확인합니다${old.length ? `(7일 넘은 기록 ${old.length}개는 삭제)` : ""}`);
    return [];
  }

  const byPid = new Map(procs.map((proc) => [proc.pid, proc]));
  const killed: string[] = [];
  for (const found of records) {
    const { owner } = found.record;
    if (owner.pid !== io.self.pid && same(byPid.get(owner.pid), owner)) {
      log.warn(`기록을 남긴 봇 프로세스(pid ${owner.pid})가 아직 실행 중이어서 그 기록의 잔류 자식 프로세스 정리를 건너뜁니다. 봇이 중복 실행 중인지 확인하세요`);
      continue;
    }
    killed.push(...sweepRecord(found, procs, byPid, io, isWin));
  }
  if (killed.length) log.warn(`이전 실행의 잔류 자식 프로세스 ${killed.length}개를 종료했습니다: ${killed.join(", ")}`);
  return killed;
}

export { sweepLeftoverChildren };
