"use strict";

const { spawnSync } = require("node:child_process");
const log = require("./logger").child({ category: "proc" });

const IS_WIN = process.platform === "win32";

/**
 * yt-dlp / ffmpeg 프로세스 등록부. 봇이 내려갈 때 자손까지 함께 죽인다.
 *
 * yt-dlp가 다운로드를 ffmpeg에 넘기므로 ffmpeg는 손자 프로세스다. 그냥 두면 봇을 내려도 남아서
 * 파일을 물고 방송을 계속 받아쓴다. Windows는 `taskkill /T`로, POSIX는 detached로 띄운
 * 프로세스 그룹(-pid)에 시그널을 보내 정리한다. exit 훅에서도 돌아야 해서 전부 동기로 구현한다.
 *
 * 시그널 전에 두 가지를 확인한다. 빠뜨리면 무관한 프로세스를 죽인다.
 *  1. pid > 1 인 정수. pid 0이면 `-0`이 되어 우리 자신의 프로세스 그룹이 죽는다.
 *  2. 이미 종료한 자식은 건너뛴다. OS가 PID를 재사용한다.
 */

/** @type {Map<number, {pid:number, label:string, group:boolean, child:import("node:child_process").ChildProcess}>} */
const active = new Map();
let hooksInstalled = false;

/**
 * exit 훅 설치. 첫 register 때 한 번만.
 * SIGINT/SIGTERM/SIGHUP은 index.js의 gracefulShutdown이 killAll을 직접 부르고, 여기는 그 밖의 경로용 백스톱이다.
 */
function install() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on("exit", () => killAll("exit"));
}

/**
 * 자식 프로세스를 등록하고 등록 해제 함수를 돌려준다.
 * @param {import("node:child_process").ChildProcess|{pid?:number}} child spawn된 프로세스(또는 pid/kill을 가진 래퍼)
 * @param {string} label 로그용 이름
 * @param {{group?:boolean}} options group=true면 detached로 띄워 자체 프로세스 그룹을 가진 경우
 * @returns {() => void} 등록 해제 함수 — 프로세스가 정상 종료하면 반드시 호출할 것
 */
function register(child, label = "child", { group = false } = {}) {
  const pid = child && child.pid;
  if (!Number.isInteger(pid) || pid <= 1) return () => {};
  install();
  active.set(pid, { pid, label, group, child, startedAt: Date.now() });
  return () => active.delete(pid);
}

/** 자식이 아직 살아있는가 — 종료했으면 PID 재사용 위험이 있으므로 시그널을 보내면 안 된다. */
function _isAlive(child) {
  if (!child) return false;
  // ChildProcess는 종료 시 exitCode 또는 signalCode 중 하나가 채워진다(그 전엔 둘 다 null).
  return child.exitCode === null && child.signalCode === null;
}

/**
 * 프로세스와 그 자손을 강제 종료. 이미 종료된 프로세스는 건드리지 않는다.
 * @param {{pid:number, group:boolean, child:any}} entry
 * @returns {boolean} 실제로 kill을 시도했는가
 */
function killTree(entry) {
  const { pid, group, child } = entry;
  if (!Number.isInteger(pid) || pid <= 1) return false; // pid 0 → -0 = 자기 그룹 자살 방지
  if (!_isAlive(child)) return false; // PID 재사용된 남의 프로세스 보호

  if (IS_WIN) {
    // /T = 자손 포함, /F = 강제. yt-dlp가 띄운 ffmpeg는 이 경로에서만 잡힌다.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return true;
  }

  try {
    // detached로 띄웠으면 그룹 전체(-pid) — 손자 ffmpeg까지 같이 죽는다.
    process.kill(group ? -pid : pid, "SIGKILL");
  } catch {
    // ESRCH(이미 종료) 또는 그룹이 없는 경우 — 직접 pid로 한 번 더.
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* 이미 없음 */
    }
  }
  return true;
}

/**
 * 등록된 모든 프로세스를 트리째 종료한다. 멱등 — 두 번 불러도 안전하다.
 * @param {string} reason 로그용
 * @returns {number} 실제로 종료를 시도한 프로세스 수
 */
function killAll(reason = "shutdown") {
  if (active.size === 0) return 0;
  const entries = [...active.values()];
  active.clear();

  const killed = [];
  for (const entry of entries) {
    try {
      if (killTree(entry)) killed.push(`${entry.label}#${entry.pid}`);
    } catch {
      /* 종료 경로에서는 실패해도 더 할 수 있는 일이 없다 */
    }
  }
  if (killed.length) log.warn(`외부 프로세스 ${killed.length}개 정리 (${reason}): ${killed.join(", ")}`);
  return killed.length;
}

/** 현재 추적 중인 프로세스 수 */
function size() {
  return active.size;
}

/**
 * 지금 살아 있는 자식 프로세스 목록 — 운영자 패널 모니터링용.
 * 오래 살아 있는 항목이 곧 새는 신호다(재생 ffmpeg는 곡 길이를 넘기지 않아야 한다).
 * @returns {Array<{pid:number,label:string,ageMs:number}>} 오래된 것부터
 */
function list() {
  const now = Date.now();
  return [...active.values()]
    .filter((e) => _isAlive(e.child))
    .map((e) => ({ pid: e.pid, label: e.label, ageMs: now - e.startedAt }))
    .sort((a, b) => b.ageMs - a.ageMs);
}

module.exports = { register, killAll, size, list, install, _internals: { active, killTree, _isAlive } };
